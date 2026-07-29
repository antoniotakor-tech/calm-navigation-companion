// ---------------------------------------------------------------------------
// Route data transfer — builds the compact, validated structure handed to
// the native background-navigation plugin when a session starts (or a
// reroute produces a new route), and validates it on the way in. Pure
// functions, no DOM/network/native calls — the actual handoff (native/
// nativeLocationProvider.js et al.) just calls these.
//
// Field names/units are deliberately explicit (lat/lon as separate named
// numbers, not [lon,lat] tuples like routing.js's internal `coordinates`)
// because this crosses a JS→Swift/Kotlin boundary where a silent
// order-swap bug would be far more costly than the extra verbosity here.
//
// Thresholds are copied from navlogic.js's THRESHOLDS at payload-build time
// (not re-declared independently) specifically so the native engine mirrors
// the same on-screen behavior — see IOS_/ANDROID_BACKGROUND_NAVIGATION.md
// for how the native side re-implements the actual state machine using
// these numbers.
// ---------------------------------------------------------------------------

const PAYLOAD_VERSION = 1;

// route: one of routing.js's fetchCalmRoute() result's `.calm`/`.fastest`
// entries — {coordinates:[[lon,lat],...], distanceM, timeMs, steps:[...], roadClassSegments}
// destination: {label, lat, lon}
function buildNavRoutePayload({ route, destination, travelMode, safetyMode, thresholds }) {
  const geometry = (route.coordinates || []).map(([lon, lat]) => ({ lat, lon }));
  const maneuvers = (route.steps || []).map((step, i) => {
    const idx = step.interval ? step.interval[1] : geometry.length - 1;
    const point = geometry[idx] || geometry[geometry.length - 1] || { lat: destination.lat, lon: destination.lon };
    return {
      index: idx,
      lat: point.lat,
      lon: point.lon,
      text: step.text || "",
      distanceM: step.distanceM || 0,
      sign: typeof step.sign === "number" ? step.sign : 0,
      streetName: step.streetName || "",
      isFinal: i === (route.steps || []).length - 1,
    };
  });

  return {
    version: PAYLOAD_VERSION,
    createdAtMs: Date.now(),
    travelMode: travelMode === "bike" ? "bike" : "walk",
    safetyMode: !!safetyMode,
    destination: {
      label: String(destination.label || "Destination"),
      lat: destination.lat,
      lon: destination.lon,
    },
    distanceM: route.distanceM || 0,
    durationMs: route.timeMs || 0,
    geometry,
    maneuvers,
    // Optional — only used to keep the ambient-audio "calm vs busy road"
    // suggestion working in the background; safe to omit if large.
    roadClassSegments: Array.isArray(route.roadClassSegments) ? route.roadClassSegments : [],
    thresholds: {
      arriveStepM: thresholds.ARRIVE_STEP_M,
      arriveDestM: thresholds.ARRIVE_DEST_M,
      offRouteM: thresholds.OFF_ROUTE_M,
      offRouteStreakNeeded: thresholds.OFF_ROUTE_STREAK_NEEDED,
      headingMinSpeedMps: thresholds.HEADING_MIN_SPEED_MPS,
    },
  };
}

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function isValidLatLon(lat, lon) {
  return isFiniteNumber(lat) && isFiniteNumber(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

// Validates a payload before it's handed to native code (or, on the native
// side conceptually, before it's trusted) — malformed input here should
// fail loudly and early rather than crash a background service with no user
// watching.
function validateNavRoutePayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object") return { valid: false, errors: ["payload is not an object"] };
  if (payload.version !== PAYLOAD_VERSION) errors.push(`unsupported version: ${payload.version}`);
  if (payload.travelMode !== "walk" && payload.travelMode !== "bike") errors.push(`invalid travelMode: ${payload.travelMode}`);
  if (!payload.destination || !isValidLatLon(payload.destination.lat, payload.destination.lon)) {
    errors.push("invalid destination lat/lon");
  }
  if (!Array.isArray(payload.geometry) || payload.geometry.length < 2) {
    errors.push("geometry must have at least 2 points");
  } else if (!payload.geometry.every((p) => isValidLatLon(p.lat, p.lon))) {
    errors.push("geometry contains an invalid lat/lon");
  }
  if (!Array.isArray(payload.maneuvers) || payload.maneuvers.length < 1) {
    errors.push("maneuvers must have at least 1 entry (the arrival step)");
  } else if (!payload.maneuvers.every((m) => isValidLatLon(m.lat, m.lon) && isFiniteNumber(m.index))) {
    errors.push("maneuvers contains an invalid entry");
  }
  const t = payload.thresholds || {};
  ["arriveStepM", "arriveDestM", "offRouteM", "offRouteStreakNeeded", "headingMinSpeedMps"].forEach((k) => {
    if (!isFiniteNumber(t[k]) || t[k] < 0) errors.push(`invalid threshold: ${k}`);
  });
  return { valid: errors.length === 0, errors };
}

// Rough JSON-serialized size, used only to keep an eye on "unnecessarily
// large" transfers (e.g. logging a warning above a few hundred KB) — not a
// hard limit enforced here, since a genuinely long cross-city bike route is
// legitimately larger and shouldn't be truncated.
function estimatePayloadBytes(payload) {
  return JSON.stringify(payload).length;
}

if (typeof module === "object" && module.exports) {
  module.exports = { PAYLOAD_VERSION, buildNavRoutePayload, validateNavRoutePayload, estimatePayloadBytes };
}
