// ---------------------------------------------------------------------------
// calmscore.js (2026-10-13) — weighted 0–10 calmness score for a route.
//
// Five factors, each scored 0 (stressful) … 10 (calm):
//   noise         traffic/noise exposure — road class, speed limit, lanes, tunnels
//   crowd         busyness — road class (+ rush-hour penalty)
//   smoothness    continuous, separated, even paths — surface, dedicated
//                 foot/cycle ways vs mixed traffic, and how often the road
//                 type changes along the way
//   intersections stops and crossings — traffic lights / crossings per km and
//                 turns per km
//   sensory       visual/sensory complexity — big-road crossings and arterial
//                 exposure, softened by measured green space (parks, water)
//
// Missing data is NEVER guessed: if a factor can't be computed for a stretch
// of road (e.g. no road class), that factor is left out for that stretch and
// the remaining weights are scaled up proportionally. Every gap is counted
// and reported in `dataGaps` (and logged) so you can see how often it happens.
//
// Data per stretch comes from GraphHopper path details (road_class, surface,
// max_speed, lanes, road_environment, crossing) — all real map data (OSM).
// Not available from routing data: proximity to schools / busy squares (only
// "pedestrian" streets hint at squares) — documented, not invented.
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CalmScore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ==== TUNE HERE ===========================================================
  const CALM_WEIGHTS = { noise: 0.25, crowd: 0.20, smoothness: 0.20, intersections: 0.15, sensory: 0.20 };
  // "Prefer well-lit, busier streets": multiply the weights (then renormalise).
  // Lower noise/crowd/sensory weights = busier streets aren't punished much;
  // plus an extra "isolation" factor so empty paths/parks score lower at night.
  const SAFETY_WEIGHT_MULTIPLIERS = { noise: 0.6, crowd: 0.4, smoothness: 1.1, intersections: 1.0, sensory: 0.6, isolation: 1 };
  const SAFETY_ISOLATION_WEIGHT = 0.25; // weight given to "isolation" in safety mode (0 otherwise)

  // Per road class, 0–10. Unknown classes are treated as MISSING, not average.
  const NOISE_BY_CLASS = { path: 10, track: 10, footway: 9.5, pedestrian: 8, steps: 9, cycleway: 8.5, living_street: 8.5, residential: 7, service: 6.5, unclassified: 6, tertiary: 4, secondary: 2.5, primary: 1, trunk: 0, motorway: 0 };
  const CROWD_BY_CLASS = { path: 9.5, track: 10, footway: 8, pedestrian: 4, steps: 7, cycleway: 8, living_street: 7.5, residential: 8, service: 7, unclassified: 7, tertiary: 5, secondary: 3.5, primary: 2.5, trunk: 3, motorway: 3 };
  const SEPARATION_BY_CLASS = { path: 9, track: 7, footway: 9.5, pedestrian: 9, steps: 5, cycleway: 9.5, living_street: 7.5, residential: 6.5, service: 6, unclassified: 5.5, tertiary: 4, secondary: 2.5, primary: 1.5, trunk: 0, motorway: 0 };
  const SURFACE_SCORE = { asphalt: 9.5, paved: 9, concrete: 9, paving_stones: 8, compacted: 7, fine_gravel: 6.5, wood: 7, sett: 5, cobblestone: 4, gravel: 4.5, unpaved: 4, ground: 4, dirt: 3.5, grass: 3, sand: 2, mud: 1 };
  const SENSORY_BY_CLASS = { path: 9.5, track: 9, footway: 8.5, pedestrian: 5.5, steps: 8, cycleway: 8, living_street: 8, residential: 7.5, service: 7, unclassified: 6.5, tertiary: 4.5, secondary: 3, primary: 1.5, trunk: 0.5, motorway: 0.5 };
  const ISOLATION_BY_CLASS = { path: 3, track: 2, footway: 4, steps: 3, cycleway: 5, pedestrian: 8, living_street: 8, residential: 8.5, service: 6, unclassified: 6, tertiary: 7, secondary: 6.5, primary: 6, trunk: 4, motorway: 3 };
  const BIG_ROADS = new Set(["primary", "secondary", "trunk", "motorway"]);
  const CROSSING_COST = { traffic_signals: 1.5, marked: 0.6, unmarked: 0.5, railway: 0.9, uncontrolled: 0.5, informal: 0.4 };
  const PEAK_CROWD_PENALTY = 1.5; // applied to busy road types during rush hour
  const INTERSECTION_COST_PER_KM = 0.8; // points lost per (weighted) crossing per km
  const TURN_COST_PER_KM = 0.25;        // points lost per turn per km
  // ==========================================================================

  const has = (v) => v !== undefined && v !== null && v !== "missing" && v !== "None" && v !== "";

  function weightsFor(safetyMode) {
    const w = { ...CALM_WEIGHTS, isolation: 0 };
    if (safetyMode) {
      Object.keys(SAFETY_WEIGHT_MULTIPLIERS).forEach((k) => { if (k in w) w[k] *= SAFETY_WEIGHT_MULTIPLIERS[k]; });
      w.isolation = SAFETY_ISOLATION_WEIGHT;
    }
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    Object.keys(w).forEach((k) => { w[k] /= sum; });
    return w;
  }

  function hav(a, b) {
    const R = 6371000, r = (x) => (x * Math.PI) / 180;
    const h = Math.sin(r(b[1] - a[1]) / 2) ** 2 + Math.cos(r(a[1])) * Math.cos(r(b[1])) * Math.sin(r(b[0] - a[0]) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /** Turns GraphHopper's [[from,to,value],…] interval lists into a per-edge lookup. */
  function perEdge(detail, edges) {
    const out = new Array(edges).fill(undefined);
    (detail || []).forEach(([from, to, value]) => { for (let i = from; i < to && i < edges; i++) out[i] = value; });
    return out;
  }

  function clamp(x) { return Math.max(0, Math.min(10, x)); }

  /**
   * path: { coordinates: [[lon,lat],…], details: {road_class, surface, max_speed,
   *   lanes, road_environment, crossing}, steps: [{sign}], greenPct?: number }
   * ctx: { safetyMode, peak }
   * → { score (0–10), factors: {name: 0–10|null}, dataGaps: {name: % of distance}, weights }
   */
  function scoreRoute(path, ctx) {
    ctx = ctx || {};
    const coords = path.coordinates || [];
    const edges = Math.max(0, coords.length - 1);
    const d = path.details || {};
    const rc = perEdge(d.road_class, edges), surf = perEdge(d.surface, edges), spd = perEdge(d.max_speed, edges);
    const lanes = perEdge(d.lanes, edges), env = perEdge(d.road_environment, edges);
    const len = []; let total = 0;
    for (let i = 0; i < edges; i++) { const l = hav(coords[i], coords[i + 1]); len.push(l); total += l; }
    const km = Math.max(0.05, total / 1000);
    const w = weightsFor(ctx.safetyMode);

    // ---- route-level factors (same value along the whole route) ----
    // intersections: crossings + turns per km
    let intersections = null, crossingCost = 0, bigCrossings = 0;
    if (Array.isArray(d.crossing)) {
      d.crossing.forEach(([from, , value]) => {
        if (!has(value) || value === "no") return;
        crossingCost += CROSSING_COST[value] || 0.5;
        if (BIG_ROADS.has(String(rc[Math.max(0, from - 1)] || rc[from] || "").toLowerCase())) bigCrossings++;
      });
    }
    const turns = (path.steps || []).filter((s) => s && s.sign != null && s.sign !== 0 && s.sign !== 4 && s.sign !== 5).length;
    if (Array.isArray(d.crossing) || (path.steps && path.steps.length)) {
      // Calibrated on real city walks (≈5 crossings/km in central Amsterdam → ~4/10;
      // ≈1–2/km on quiet routes → 8–9/10).
      intersections = clamp(10 - (crossingCost / km) * INTERSECTION_COST_PER_KM - (turns / km) * TURN_COST_PER_KM);
    }
    // smoothness: how often the road type changes (continuity)
    let changes = 0;
    for (let i = 1; i < edges; i++) if (has(rc[i]) && has(rc[i - 1]) && rc[i] !== rc[i - 1]) changes++;
    const continuityPenalty = Math.min(3, (changes / km) * 0.35);
    // sensory: big-road crossings per km + green space bonus
    const greenBonus = typeof path.greenPct === "number" ? Math.min(2, path.greenPct / 25) : 0;
    const bigCrossPenalty = Math.min(4, (bigCrossings / km) * 1.2);

    // ---- per-stretch scores, missing factors excluded + reweighted ----
    const gapLen = { noise: 0, crowd: 0, smoothness: 0, intersections: 0, sensory: 0, isolation: 0 };
    const sumF = { noise: 0, crowd: 0, smoothness: 0, intersections: 0, sensory: 0, isolation: 0 };
    const lenF = { noise: 0, crowd: 0, smoothness: 0, intersections: 0, sensory: 0, isolation: 0 };
    let composite = 0, compositeLen = 0;
    for (let i = 0; i < edges; i++) {
      const cls = has(rc[i]) ? String(rc[i]).toLowerCase() : null;
      const known = cls && NOISE_BY_CLASS[cls] !== undefined ? cls : null;
      const f = {};
      // noise
      if (known || has(spd[i])) {
        let s = known ? NOISE_BY_CLASS[known] : 6;
        const sp = Number(spd[i]);
        if (has(spd[i]) && Number.isFinite(sp)) s += sp >= 70 ? -3 : sp >= 50 ? -1.5 : sp <= 30 ? 1 : 0;
        const ln = Number(lanes[i]);
        if (has(lanes[i]) && Number.isFinite(ln)) s -= ln >= 3 ? 1.5 : ln === 2 ? 0.5 : 0;
        if (env[i] === "tunnel") s -= 2;
        f.noise = clamp(s);
      }
      // crowd
      if (known) {
        let s = CROWD_BY_CLASS[known];
        if (ctx.peak && s <= 5) s -= PEAK_CROWD_PENALTY;
        f.crowd = clamp(s);
      }
      // smoothness: surface + separation from traffic, minus route continuity penalty
      const parts = [];
      if (has(surf[i]) && SURFACE_SCORE[String(surf[i]).toLowerCase()] !== undefined) parts.push(SURFACE_SCORE[String(surf[i]).toLowerCase()]);
      if (known) parts.push(SEPARATION_BY_CLASS[known]);
      if (parts.length) f.smoothness = clamp(parts.reduce((a, b) => a + b, 0) / parts.length - continuityPenalty);
      // intersections (route-level)
      if (intersections !== null) f.intersections = intersections;
      // sensory
      if (known) f.sensory = clamp(SENSORY_BY_CLASS[known] - bigCrossPenalty + greenBonus);
      // isolation (safety mode only)
      if (w.isolation > 0 && known) f.isolation = ISOLATION_BY_CLASS[known];

      let num = 0, den = 0;
      Object.keys(w).forEach((k) => {
        if (w[k] <= 0) return;
        if (f[k] === undefined) { gapLen[k] += len[i]; return; }
        num += w[k] * f[k]; den += w[k];
        sumF[k] += f[k] * len[i]; lenF[k] += len[i];
      });
      if (den > 0) { composite += (num / den) * len[i]; compositeLen += len[i]; }
    }

    const factors = {}, dataGaps = {};
    Object.keys(w).forEach((k) => {
      if (w[k] <= 0) return;
      factors[k] = lenF[k] ? Math.round((sumF[k] / lenF[k]) * 10) / 10 : null;
      dataGaps[k] = total ? Math.round((gapLen[k] / total) * 100) : 100;
    });
    const score = compositeLen ? Math.round((composite / compositeLen) * 10) / 10 : null;
    return { score, factors, dataGaps, weights: w, km: Math.round(km * 100) / 100 };
  }

  /** Logs any factor that had missing data on part of the route. */
  function logGaps(label, result) {
    const gaps = Object.entries(result.dataGaps || {}).filter(([, pct]) => pct > 0);
    if (gaps.length && typeof console !== "undefined") {
      console.info(`[calmscore] ${label}: missing data → ` + gaps.map(([k, pct]) => `${k} on ${pct}% of the route`).join(", ") + " (excluded and reweighted)");
    }
  }

  return { CALM_WEIGHTS, SAFETY_WEIGHT_MULTIPLIERS, SAFETY_ISOLATION_WEIGHT, weightsFor, scoreRoute, logGaps };
});
