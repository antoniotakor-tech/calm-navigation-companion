// ---------------------------------------------------------------------------
// GreenScore — pure logic for measuring how much of a route runs near real,
// mapped green space (parks/woods/water/forest from OpenStreetMap), instead
// of inferring "calm" purely from road classification. This is the
// "calm-by-measurement" half of routing: routing.js's CALM_SCORE table is a
// road-type heuristic; this file scores route points against ACTUAL green-
// space geometry a caller already fetched from OpenStreetMap via
// functions/api/greenspace.js. No DOM, no network, no state of its own — same
// unit-testable-with-node--test convention as routing.js/audioregulation.js.
// ---------------------------------------------------------------------------
(function (root) {
  "use strict";

  const EARTH_RADIUS_M = 6371000;

  // Real great-circle distance between two [lon, lat] points, in meters.
  // Duplicated locally rather than imported from routing.js — every pure-
  // logic module in this project (navlogic.js, searchranking.js,
  // echovalidation.js, explorationtracker.js) keeps its own copy of this
  // exact math so each file stays independently loadable/testable without
  // depending on <script> load order.
  function haversineM(a, b) {
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b[1] - a[1]);
    const dLon = toRad(b[0] - a[0]);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  // Flat equirectangular projection centered on `origin` — accurate to well
  // under a meter of error at the neighborhood/city scale this ever runs at
  // (walking routes, tens of meters of green-space proximity), and far
  // cheaper than true geodesic point-to-segment math for what's ultimately
  // just a "close to a park boundary or not" check.
  function toLocalXY(point, origin) {
    const latRad = (origin[1] * Math.PI) / 180;
    const mPerDegLat = 111320;
    const mPerDegLon = 111320 * Math.cos(latRad);
    return [(point[0] - origin[0]) * mPerDegLon, (point[1] - origin[1]) * mPerDegLat];
  }

  // Shortest distance in meters from `point` to the line segment a-b.
  function pointToSegmentM(point, a, b) {
    const p = toLocalXY(point, point);
    const pa = toLocalXY(a, point);
    const pb = toLocalXY(b, point);
    const dx = pb[0] - pa[0];
    const dy = pb[1] - pa[1];
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? ((p[0] - pa[0]) * dx + (p[1] - pa[1]) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const projX = pa[0] + t * dx;
    const projY = pa[1] + t * dy;
    const ex = p[0] - projX;
    const ey = p[1] - projY;
    return Math.sqrt(ex * ex + ey * ey);
  }

  // Evenly resample a route by REAL distance (not point index — raw
  // GraphHopper route points aren't evenly spaced, the same reason
  // routing.js's scoreRoadClassBreakdown moved off index-span weighting)
  // into `count` sample points spanning the whole route.
  function sampleRouteEvenly(coordinates, count) {
    if (!coordinates || coordinates.length < 1 || count < 1) return [];
    if (coordinates.length === 1 || count === 1) return [coordinates[0]];
    const legLengths = [];
    let total = 0;
    for (let i = 0; i < coordinates.length - 1; i++) {
      const d = haversineM(coordinates[i], coordinates[i + 1]);
      legLengths.push(d);
      total += d;
    }
    if (total === 0) return [coordinates[0]];
    const samples = [];
    for (let s = 0; s < count; s++) {
      const targetDist = (total * s) / (count - 1);
      let acc = 0;
      let idx = 0;
      while (idx < legLengths.length && acc + legLengths[idx] < targetDist) {
        acc += legLengths[idx];
        idx++;
      }
      if (idx >= legLengths.length) {
        samples.push(coordinates[coordinates.length - 1]);
        continue;
      }
      const legT = legLengths[idx] > 0 ? (targetDist - acc) / legLengths[idx] : 0;
      const a = coordinates[idx];
      const b = coordinates[idx + 1];
      samples.push([a[0] + (b[0] - a[0]) * legT, a[1] + (b[1] - a[1]) * legT]);
    }
    return samples;
  }

  // Ray-casting point-in-polygon test, in the same local flat projection as
  // pointToSegmentM. A way only counts as a polygon here if it's a closed
  // ring (first point == last point) — exactly how Overpass's `out geom`
  // returns an OSM area way (leisure=park, natural=wood, etc.); an open way
  // (a riverbank line, an unclosed boundary fragment) is never treated as
  // having an interior.
  function isClosedRing(way) {
    if (way.length < 4) return false;
    const first = way[0];
    const last = way[way.length - 1];
    return Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9;
  }

  function pointInPolygon(point, ring) {
    const p = toLocalXY(point, point);
    let inside = false;
    for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
      const vi = toLocalXY(ring[i], point);
      const vj = toLocalXY(ring[j], point);
      const intersects = (vi[1] > p[1]) !== (vj[1] > p[1])
        && p[0] < ((vj[0] - vi[0]) * (p[1] - vi[1])) / (vj[1] - vi[1]) + vi[0];
      if (intersects) inside = !inside;
    }
    return inside;
  }

  // Nearest distance (meters) from `point` to any way in `greenWays` — each
  // way is a plain array of [lon,lat] coordinates (a park/wood/water
  // boundary or open way, as returned by functions/api/greenspace.js). A
  // point standing inside a closed park/wood/water ring is distance 0 —
  // otherwise a route walking through the middle of a large park would
  // score as "far from green" just because it's far from the *boundary*,
  // which is the wrong answer for the thing this is actually trying to
  // measure (is the walker surrounded by green space right now).
  function nearestGreenDistanceM(point, greenWays) {
    let best = Infinity;
    (greenWays || []).some((way) => {
      if (!way || !way.length) return false;
      if (way.length === 1) {
        const d = haversineM(point, way[0]);
        if (d < best) best = d;
        return false;
      }
      if (isClosedRing(way) && pointInPolygon(point, way)) {
        best = 0;
        return true; // can't get closer than inside — stop scanning remaining ways
      }
      for (let i = 0; i < way.length - 1; i++) {
        const d = pointToSegmentM(point, way[i], way[i + 1]);
        if (d < best) best = d;
      }
      return false;
    });
    return best;
  }

  const DEFAULT_SAMPLE_COUNT = 20;
  const DEFAULT_THRESHOLD_M = 40; // "near green space" — about a building's width off the route.

  // The real, measured signal: what share of the route's evenly-resampled
  // points fall within `thresholdM` of actual mapped green space. Fails
  // toward 0 (no data -> no measured bonus) rather than ever inventing a
  // calm number when there's nothing to measure against.
  function computeGreenCoverage(coordinates, greenWays, opts) {
    const sampleCount = (opts && opts.sampleCount) || DEFAULT_SAMPLE_COUNT;
    const thresholdM = (opts && opts.thresholdM) || DEFAULT_THRESHOLD_M;
    if (!coordinates || coordinates.length < 2 || !greenWays || !greenWays.length) {
      return { greenPct: 0, sampleCount: 0 };
    }
    const samples = sampleRouteEvenly(coordinates, sampleCount);
    let near = 0;
    samples.forEach((p) => {
      if (nearestGreenDistanceM(p, greenWays) <= thresholdM) near++;
    });
    return { greenPct: Math.round((near / samples.length) * 100), sampleCount: samples.length };
  }

  // Bounded additive bonus blended into routing.js's road-class calmScore —
  // capped so measured green coverage can meaningfully influence ranking
  // (and break close ties toward the actually-greener route) without ever
  // letting it override a genuinely worse road-class base. A "path" through
  // a park is still scored as isolated by SAFETY_CALM_SCORE regardless of
  // how green it is — this bonus rides on top, it doesn't replace that.
  const GREEN_BONUS_MAX = 2.5;
  function greenBonus(greenPct) {
    return (Math.max(0, Math.min(100, greenPct)) / 100) * GREEN_BONUS_MAX;
  }

  const api = {
    haversineM,
    pointToSegmentM,
    isClosedRing,
    pointInPolygon,
    sampleRouteEvenly,
    nearestGreenDistanceM,
    computeGreenCoverage,
    greenBonus,
    GREEN_BONUS_MAX,
    DEFAULT_SAMPLE_COUNT,
    DEFAULT_THRESHOLD_M,
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.GreenScore = api;
})(typeof window !== "undefined" ? window : this);
