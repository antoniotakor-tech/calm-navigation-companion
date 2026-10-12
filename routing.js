// ---------------------------------------------------------------------------
// Calm Routing pillar
// Scores GraphHopper alternative routes by how "calm" their road classification
// is, rather than by speed. Falls back to a demo route with simulated road-class
// data when no API key is configured, so the app is fully testable without one.
// ---------------------------------------------------------------------------

const CALM_SCORE = {
  // Higher = calmer. Values are GraphHopper road_class strings (lowercased).
  path: 10,
  track: 9,
  pedestrian: 9,
  living_street: 8,
  cycleway: 7,
  footway: 9,
  steps: 6,
  residential: 6,
  unclassified: 5,
  service: 4,
  tertiary: 2,
  secondary: 1,
  primary: 0,
  trunk: -3,
  motorway: -6,
  other: 4,
};

// Safety-aware variant: real feedback flagged that pure sensory-calm routing
// (favoring empty paths, tracks, parks) can trade personal safety for quiet —
// isolated, likely-unlit route types score lower here, and populated-but-calm
// types (residential, living_street) score relatively higher. This does not
// use any real lighting/population data (not available on the free tier) —
// it's a stated, named heuristic, same honesty convention as the peak-hour one.
const SAFETY_CALM_SCORE = {
  path: 3,
  track: 2,
  pedestrian: 5,
  living_street: 7,
  cycleway: 4,
  footway: 4,
  steps: 2,
  residential: 7,
  unclassified: 4,
  service: 3,
  tertiary: 4,
  secondary: 2,
  primary: 0,
  trunk: -3,
  motorway: -6,
  other: 4,
};

// Road types treated as "isolated" for the purpose of surfacing a safety note —
// the kind of quiet-but-empty segment (a park path, a track) that's calm by this
// app's own metric but may be poorly lit or unpopulated, unlike a quiet
// residential street.
const ISOLATED_TYPES = ["path", "track", "footway", "steps"];

const REQUEST_TIMEOUT_MS = 12000;

// A hung request (bad network, stalled proxy) previously left the caller
// awaiting fetch() forever with no way to recover — this bounds every
// GraphHopper call so the UI can fall back to a demo route or a clear error
// instead of an indefinite loading state.
function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms || REQUEST_TIMEOUT_MS);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

function isPeakNow(peakWindows, now = new Date()) {
  const hourFloat = now.getHours() + now.getMinutes() / 60;
  return peakWindows.some((w) => hourFloat >= w.startHour && hourFloat <= w.endHour);
}

// Simple, stated heuristic — not real sunset data, which isn't available on
// the free tier either. Flagged as a heuristic in the UI, same as peak hours.
function isNightNow() {
  const h = new Date().getHours();
  return h >= 19 || h < 7;
}

// Named annual/special-event dates (King's Day, NYE, etc.) where the normal
// peak-hour/road-class heuristics stop meaning anything — a residential street
// during King's Day's vrijmarkt street parties is the opposite of calm, and no
// free-tier data source knows that. Rather than silently giving a confidently
// wrong "calm route" on those specific days, this checks a small, honestly
// partial, manually-maintained list and says so directly instead.
function specialEventToday(specialEvents) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  return (specialEvents || []).find((e) => e.month === month && e.day === day) || null;
}

const EARTH_RADIUS_M = 6371000;

// Real great-circle distance between two [lon, lat] points, in meters.
function haversineM(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Real distance in meters covered by route points [from..to] (inclusive),
// summing consecutive-point haversine legs. Returns null if coordinates
// aren't available for that range, so the caller can fall back cleanly.
function segmentDistanceM(coordinates, from, to) {
  if (!coordinates || !coordinates.length) return null;
  const start = Math.max(0, Math.min(from, coordinates.length - 1));
  const end = Math.max(0, Math.min(to, coordinates.length - 1));
  if (end <= start) return null;
  let dist = 0;
  for (let i = start; i < end; i++) dist += haversineM(coordinates[i], coordinates[i + 1]);
  return dist;
}

// details.road_class is [[fromIdx, toIdx, value], ...] over the route's point
// array. Each segment is weighted by its REAL distance in meters (haversine
// over `coordinates`, the same [lon,lat] array GraphHopper returns the route
// geometry in) — not by point-index span. Point density along a GraphHopper
// route isn't uniform (winding minor streets get more points per meter than
// long straight arterials, since points follow OSM way vertices), so index
// span was systematically over/under-weighting segments relative to how much
// of the actual walk they represent. `coordinates` is optional so demo mode
// and pre-existing unit tests (which pass synthetic [from,to] ranges with no
// real geometry) still get a sane approximation via the old index-span math.
function scoreRoadClassBreakdown(roadClassDetail, peak, safetyMode, coordinates) {
  if (!roadClassDetail || !roadClassDetail.length) return { score: 0, breakdown: {}, isolatedPct: 0 };
  let total = 0;
  let weightedSum = 0;
  let isolatedSpan = 0;
  const breakdown = {};
  const table = safetyMode ? SAFETY_CALM_SCORE : CALM_SCORE;

  roadClassDetail.forEach(([from, to, value]) => {
    const key = String(value || "other").toLowerCase();
    const realDistM = coordinates ? segmentDistanceM(coordinates, from, to) : null;
    const span = realDistM != null ? realDistM : Math.max(1, to - from);
    let calm = table[key] !== undefined ? table[key] : table.other;
    // Peak-hour heuristic: penalize busy road types further when we're inside a
    // stated peak window, since we have no live crowd data to check directly.
    if (peak && calm <= 2) calm -= 2;
    weightedSum += calm * span;
    total += span;
    breakdown[key] = (breakdown[key] || 0) + span;
    if (ISOLATED_TYPES.includes(key)) isolatedSpan += span;
  });

  return {
    score: total ? weightedSum / total : 0,
    breakdown,
    total,
    isolatedPct: total ? Math.round((isolatedSpan / total) * 100) : 0,
  };
}

function pctBreakdown(breakdown, total) {
  const out = {};
  Object.keys(breakdown).forEach((k) => {
    out[k] = Math.round((breakdown[k] / total) * 100);
  });
  return out;
}

// Smallest bbox (in degrees, unpadded) covering every point across every
// candidate path — so one green-space request covers the calm route, the
// fastest route, and any alternates, instead of one request per path.
// Returns null if there are no coordinates at all (shouldn't happen with a
// real GraphHopper response, but keeps this honestly defensive).
function unionBboxDeg(coordinatesList, paddingDeg) {
  let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
  (coordinatesList || []).forEach((coords) => {
    (coords || []).forEach(([lon, lat]) => {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    });
  });
  if (!Number.isFinite(minLat)) return null;
  return {
    minLat: minLat - paddingDeg, minLon: minLon - paddingDeg,
    maxLat: maxLat + paddingDeg, maxLon: maxLon + paddingDeg,
  };
}

// ~100m margin so a park just off the route's own edge still counts —
// GraphHopper's route line runs along the path/sidewalk, not through the
// green space next to it.
const GREEN_BBOX_PADDING_DEG = 0.001;

// Fetches real green-space geometry (park/wood/water/forest ways) covering
// every candidate path, via the same-origin Overpass proxy
// (functions/api/greenspace.js — same key-free, server-capped proxy pattern
// as /api/pois). Fails toward an empty list on any error: a missing or
// broken green-space signal must never invent a calm bonus, only skip it.
async function fetchGreenWays(coordinatesList, endpointBase, requestTimeoutMs) {
  const bbox = unionBboxDeg(coordinatesList, GREEN_BBOX_PADDING_DEG);
  if (!bbox) return [];
  const url = new URL((endpointBase || "") + "/api/greenspace", typeof location !== "undefined" ? location.origin : "http://localhost");
  url.searchParams.set("bbox", `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`);
  try {
    const resp = await fetchWithTimeout(url.toString(), requestTimeoutMs);
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data.ways) ? data.ways : [];
  } catch (e) {
    console.warn("Green-space request failed — routing without a measured green bonus.", e);
    return [];
  }
}

async function fetchCalmRoute({ start, end, peakWindows, safetyMode, specialEvents, ghProfile, requestTimeoutMs, endpointBase }) {
  const peak = isPeakNow(peakWindows);
  const night = isNightNow();
  const specialEvent = specialEventToday(specialEvents);

  // Same-origin proxy (functions/api/route.js) — the GraphHopper key lives
  // server-side only, injected there from a Cloudflare Pages secret. If this
  // deployment has no key configured (or is running on a plain static server
  // with no Functions runtime at all, e.g. local `python -m http.server`),
  // the request below resolves with a non-ok/404 response and falls through
  // to the same demo-route fallback as any other routing failure.
  const url = new URL((endpointBase || "") + "/api/route", typeof location !== "undefined" ? location.origin : "http://localhost");
  url.searchParams.append("point", `${start.lat},${start.lon}`);
  url.searchParams.append("point", `${end.lat},${end.lon}`);
  // Driving is deliberately not offered: this app's whole premise (calm,
  // sensory-aware public-space walking) doesn't transfer to a car — "foot"
  // and "bike" are the two profiles GraphHopper needs different road-class
  // weighting for anyway. Defaults to foot for callers that don't specify.
  url.searchParams.set("profile", ghProfile || "foot");
  url.searchParams.set("algorithm", "alternative_route");
  url.searchParams.set("max_paths", "3");
  url.searchParams.set("max_weight_factor", "2.0");
  url.searchParams.set("max_share_factor", "0.7");
  url.searchParams.append("details", "road_class");
  url.searchParams.set("points_encoded", "false");
  url.searchParams.set("locale", "en");

  let resp;
  try {
    resp = await fetchWithTimeout(url.toString(), requestTimeoutMs);
  } catch (e) {
    const reason = e && e.name === "AbortError"
      ? "Routing service took too long to respond — showing a demo route instead."
      : "Couldn't reach the routing service — showing a demo route instead.";
    console.warn("GraphHopper request failed, falling back to demo route.", e);
    return buildDemoRoute(start, end, peak, night, safetyMode, reason, specialEvent);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.warn("GraphHopper error", resp.status, text);
    return buildDemoRoute(start, end, peak, night, safetyMode, "Routing service returned an error — showing a demo route instead.", specialEvent);
  }
  const data = await resp.json();
  if (!data.paths || !data.paths.length) {
    return buildDemoRoute(start, end, peak, night, safetyMode, "No route found — showing a demo route instead.", specialEvent);
  }

  const scored = data.paths.map((path) => {
    const rc = path.details && path.details.road_class;
    const coordinates = path.points.coordinates; // [lon, lat] pairs
    const { score, breakdown, total, isolatedPct } = scoreRoadClassBreakdown(rc, peak, safetyMode, coordinates);
    return {
      coordinates, // [lon, lat] pairs
      distanceM: path.distance,
      timeMs: path.time,
      // roadClassScore: the road-classification heuristic alone (path vs.
      // motorway etc.) — unchanged meaning from before. calmScore starts
      // equal to it and gets a real, measured green-space bonus blended in
      // just below, once actual OSM park/wood/water data comes back.
      roadClassScore: score,
      calmScore: score,
      greenPct: null,
      breakdownPct: total ? pctBreakdown(breakdown, total) : {},
      isolatedPct,
      // Raw [fromIdx, toIdx, roadClass] segments, same index space as
      // `coordinates` — lets the audio layer look up "what kind of street is
      // the user on right now" from their nearest route-point index, instead
      // of only having the route-wide breakdown summary above.
      roadClassSegments: rc || [],
      steps: (path.instructions || []).map((instr) => ({
        text: instr.text,
        distanceM: instr.distance,
        sign: instr.sign,
        streetName: instr.street_name || "",
        interval: instr.interval || null,
      })),
    };
  });

  // Real measured signal, not another heuristic: fetch actual OSM green-space
  // geometry once for the whole search (all candidate paths share one bbox,
  // one Overpass request) and blend a bounded bonus into each path's
  // calmScore based on how much of it actually runs near mapped parks/woods/
  // water. If GreenScore isn't loaded (shouldn't happen in the real app —
  // only relevant to isolated unit tests that require routing.js on its own)
  // or the fetch fails for any reason, every path just keeps its road-class
  // score unchanged — this never invents a green bonus it can't measure.
  if (typeof GreenScore !== "undefined") {
    const greenWays = await fetchGreenWays(scored.map((p) => p.coordinates), endpointBase, requestTimeoutMs);
    if (greenWays.length) {
      scored.forEach((path) => {
        const { greenPct } = GreenScore.computeGreenCoverage(path.coordinates, greenWays);
        path.greenPct = greenPct;
        path.calmScore = path.roadClassScore + GreenScore.greenBonus(greenPct);
      });
    }
  }

  const fastest = scored.reduce((a, b) => (a.timeMs < b.timeMs ? a : b));
  const calmest = scored.reduce((a, b) => (a.calmScore > b.calmScore ? a : b));

  return {
    mode: "live",
    peak,
    night,
    safetyMode: !!safetyMode,
    specialEvent,
    calm: calmest,
    fastest,
    extraMinutes: Math.max(0, Math.round((calmest.timeMs - fastest.timeMs) / 60000)),
    note: null,
  };
}

// Simulated route + plausible road-class mix, used until a real API key is set,
// or if the live request fails. Coordinates trace a simple curve between the two
// points so the map still shows something sensible.
function buildDemoRoute(start, end, peak, night, safetyMode, note, specialEvent) {
  const steps = 24;
  const coords = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lon = start.lon + (end.lon - start.lon) * t + Math.sin(t * Math.PI) * 0.004;
    const lat = start.lat + (end.lat - start.lat) * t + Math.cos(t * Math.PI * 0.7) * 0.003;
    coords.push([lon, lat]);
  }
  // Safety mode swaps the demo calm route toward residential/living_street and
  // away from isolated path/track, mirroring what the real scoring does.
  const demoBreakdownCalm = safetyMode
    ? { residential: 55, living_street: 20, tertiary: 15, primary: 10 }
    : { residential: 45, path: 30, living_street: 15, primary: 10 };
  const demoBreakdownFast = { primary: 55, secondary: 25, residential: 20 };
  const isolatedPct = safetyMode ? 0 : 30;
  const demoStepsCalm = [
    { text: "Head south on the quiet route", distanceM: 200, sign: 0, streetName: "", interval: [0, 5] },
    { text: "Turn left onto a residential street", distanceM: 450, sign: -2, streetName: "demo street", interval: [5, 10] },
    { text: "Continue straight past the park", distanceM: 600, sign: 0, streetName: "", interval: [10, 15] },
    { text: "Turn right toward the destination", distanceM: 380, sign: 2, streetName: "demo street", interval: [15, 20] },
    { text: "Arrive at destination", distanceM: 0, sign: 4, streetName: "", interval: [20, 24] },
  ];
  const demoStepsFast = [
    { text: "Head south on the main road", distanceM: 300, sign: 0, streetName: "", interval: [0, 6] },
    { text: "Turn right onto the arterial road", distanceM: 700, sign: 2, streetName: "demo avenue", interval: [6, 12] },
    { text: "Turn left toward the destination", distanceM: 450, sign: -2, streetName: "demo avenue", interval: [12, 18] },
    { text: "Arrive at destination", distanceM: 0, sign: 4, streetName: "", interval: [18, 24] },
  ];

  return {
    mode: "demo",
    peak,
    night,
    safetyMode: !!safetyMode,
    specialEvent,
    calm: {
      coordinates: coords,
      distanceM: 2100,
      timeMs: 26 * 60000,
      roadClassScore: safetyMode ? 5.4 : 6.1,
      calmScore: safetyMode ? 5.4 : 6.1,
      // Demo mode never calls the real Overpass-backed greenspace endpoint —
      // null (not a fabricated percentage) so the UI's "measured" badge
      // honestly hides itself instead of showing a number nothing measured.
      greenPct: null,
      breakdownPct: demoBreakdownCalm,
      isolatedPct,
      steps: demoStepsCalm,
      roadClassSegments: safetyMode
        ? [[0, 14, "residential"], [14, 20, "living_street"], [20, 24, "tertiary"]]
        : [[0, 11, "residential"], [11, 18, "path"], [18, 24, "living_street"]],
    },
    fastest: {
      coordinates: coords.map(([lon, lat], i) => [lon + (i % 3 === 0 ? 0.0006 : -0.0003), lat]),
      distanceM: 1750,
      timeMs: 21 * 60000,
      roadClassScore: -0.8,
      calmScore: -0.8,
      greenPct: null,
      breakdownPct: demoBreakdownFast,
      isolatedPct: 0,
      steps: demoStepsFast,
      roadClassSegments: [[0, 13, "primary"], [13, 19, "secondary"], [19, 24, "residential"]],
    },
    extraMinutes: 5,
    note: note || "Demo mode — live routing isn't configured on this deployment.",
  };
}

// Node-only export for unit tests (routing.test.js). Never runs in the
// browser: `module` is undefined there, so this whole branch is skipped and
// every function above still just lives on the global scope as before.
if (typeof module === "object" && module.exports) {
  module.exports = {
    fetchCalmRoute, geocode, specialEventToday, scoreRoadClassBreakdown,
    isPeakNow, isNightNow, CALM_SCORE, SAFETY_CALM_SCORE,
    haversineM, segmentDistanceM, unionBboxDeg, fetchGreenWays, buildDemoRoute,
  };
}

async function geocode(query, endpointBase) {
  if (!query) return null;
  // Same smart search + ranking as the suggestions list (exact house numbers,
  // the city you typed), when those modules are loaded (browser).
  if (typeof forwardGeocode === "function" && typeof rankHits === "function") {
    try {
      const { hits } = await forwardGeocode({ query, limit: 10, endpointBase });
      const best = rankHits(hits, { queryText: query })[0];
      if (best) return { label: best.primary + (best.secondary ? ", " + best.secondary : ""), lat: best.lat, lon: best.lon };
    } catch (e) { /* fall back to the single-hit lookup below */ }
  }
  const url = new URL((endpointBase || "") + "/api/geocode", typeof location !== "undefined" ? location.origin : "http://localhost");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "1");
  try {
    const resp = await fetchWithTimeout(url.toString());
    if (!resp.ok) return null;
    const data = await resp.json();
    const hit = data.hits && data.hits[0];
    if (!hit) return null;
    return { label: hit.name + (hit.city ? ", " + hit.city : ""), lat: hit.point.lat, lon: hit.point.lng };
  } catch (e) {
    return null;
  }
}
