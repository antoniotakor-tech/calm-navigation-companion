// ---------------------------------------------------------------------------
// ExplorationTracker — pure logic for the Calm Echoes "unlock" rule: walk
// >=500m and spend ~3 minutes in the walking session before "✨ Leave a Calm
// Echo" becomes available. No DOM, no geolocation API calls — this module
// only reduces a stream of {lat, lon} fixes the caller already has (app.js
// already runs a geolocation watch for live navigation; this reuses that
// same fix stream rather than opening a second one).
//
// Reuses navlogic.js's haversineM rather than re-deriving distance math —
// same convention as everywhere else in this project (one source of truth
// per calculation).
//
// "Remain in the area ~3min" is interpreted here as continuous wall-clock
// time since the current walking session started, not a fuzzy geofenced
// dwell-region — a session resets (see consumeUnlock) each time an Echo is
// left, so the NEXT unlock requires a fresh 500m/3min of walking, which is
// what "remain in the area" is actually trying to prevent (instantly
// re-triggering the CTA without having gone anywhere or spent any time).
// A true per-place dwell concept would need clustering fixes into visited
// "areas," which the spec doesn't otherwise require and which adds
// complexity for the same practical outcome.
//
// Fake-GPS detection: "movement must be genuine GPS (fake GPS should not
// unlock)" is a real requirement this module honestly cannot fully satisfy
// on the web platform — reliable mock-location detection needs native OS
// APIs (e.g. Android's Location.isFromMockProvider(), unavailable to a
// browser or WebView). What IS implemented is a speed-plausibility check:
// any two consecutive fixes implying faster-than-MAX_PLAUSIBLE_SPEED_MPS
// travel are rejected outright (neither their distance nor their position is
// trusted), which does catch the common case of a mock-location app
// "teleporting" the pin across the city. It will NOT catch a sophisticated
// spoofer replaying a slow, physically-plausible fake walk. This limitation
// must be stated in CALM_ECHOES.md, not hidden.
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./navlogic.js").haversineM);
  else root.ExplorationTrackerLib = factory(root.NavLogic.haversineM);
})(typeof self !== "undefined" ? self : this, function (haversineM) {
  "use strict";

  const UNLOCK_DISTANCE_M = 500;
  const UNLOCK_DWELL_MS = 3 * 60 * 1000; // ~3 minutes
  // ~54 km/h — comfortably above brisk walking (spec's own domain) and even
  // fast e-bike/cycling speeds a person could plausibly reach on a route
  // this app also serves, while still catching an instantaneous mock-location
  // jump across town. See file header for what this can/can't actually catch.
  const MAX_PLAUSIBLE_SPEED_MPS = 15;

  /** Speed implied by two fixes, in m/s. Returns Infinity for a non-positive time delta with real movement (a "teleport", by definition infinitely fast) and 0 for a non-positive time delta with no movement (a harmless duplicate/re-emitted fix). */
  function computeSpeedMps(prevFix, nextFix) {
    const dtMs = nextFix.atMs - prevFix.atMs;
    const distanceM = haversineM(prevFix.lat, prevFix.lon, nextFix.lat, nextFix.lon);
    if (dtMs <= 0) return distanceM > 0.5 ? Infinity : 0;
    return distanceM / (dtMs / 1000);
  }

  function isPlausibleMovement(prevFix, nextFix, maxSpeedMps) {
    const limit = maxSpeedMps == null ? MAX_PLAUSIBLE_SPEED_MPS : maxSpeedMps;
    return computeSpeedMps(prevFix, nextFix) <= limit;
  }

  function initialExplorationState() {
    return { sessionStartedAt: null, distanceM: 0, lastFix: null, unlocked: false, lastFixRejected: false };
  }

  /**
   * Folds one new GPS fix into the tracker's state.
   * @param {object} state from initialExplorationState()/a prior applyFix() call
   * @param {{lat:number, lon:number}} fix
   * @param {number} nowMs wall-clock time of this fix (injected, not Date.now(), so this stays pure/testable)
   * @param {number} [maxSpeedMps] override for tests
   */
  function applyFix(state, fix, nowMs, maxSpeedMps) {
    if (state.unlocked) return state; // latched — frozen until consumeUnlock()

    if (state.sessionStartedAt == null) {
      return { ...state, sessionStartedAt: nowMs, lastFix: { lat: fix.lat, lon: fix.lon, atMs: nowMs }, lastFixRejected: false };
    }

    const nextFix = { lat: fix.lat, lon: fix.lon, atMs: nowMs };
    if (!isPlausibleMovement(state.lastFix, nextFix, maxSpeedMps)) {
      // Neither the distance nor the position is trusted — keep the last
      // good fix as the baseline so one bad reading can't corrupt every
      // distance calculation that follows it.
      return { ...state, lastFixRejected: true };
    }

    const distanceM = state.distanceM + haversineM(state.lastFix.lat, state.lastFix.lon, nextFix.lat, nextFix.lon);
    const elapsedMs = nowMs - state.sessionStartedAt;
    const unlocked = distanceM >= UNLOCK_DISTANCE_M && elapsedMs >= UNLOCK_DWELL_MS;

    return { ...state, distanceM, lastFix: nextFix, unlocked, lastFixRejected: false };
  }

  /** Call once the user actually opens the Kalimba to leave an Echo — starts a fresh session so the NEXT Echo needs its own 500m/3min, per the file header's "remain in the area" interpretation. */
  function consumeUnlock(state, nowMs) {
    if (!state.unlocked) return state;
    return { sessionStartedAt: nowMs, distanceM: 0, lastFix: state.lastFix, unlocked: false, lastFixRejected: false };
  }

  function unlockProgress(state, nowMs) {
    const elapsedMs = state.sessionStartedAt == null ? 0 : nowMs - state.sessionStartedAt;
    return {
      unlocked: state.unlocked,
      distanceRemainingM: Math.max(0, UNLOCK_DISTANCE_M - state.distanceM),
      dwellRemainingMs: Math.max(0, UNLOCK_DWELL_MS - elapsedMs),
    };
  }

  /**
   * The user-facing progress line for the exploration CTA. Mirrors the
   * spec's own example wording exactly when distance is the binding
   * constraint ("Walk another 140 metres before leaving your musical
   * gift."); falls back to a time-based message once distance is already
   * satisfied, and to the unlock CTA itself once both are met.
   */
  function progressMessage(state, nowMs) {
    const progress = unlockProgress(state, nowMs);
    if (progress.unlocked) return "✨ Leave a Calm Echo";
    if (progress.distanceRemainingM > 0) {
      const metres = Math.ceil(progress.distanceRemainingM);
      return `Walk another ${metres} metre${metres === 1 ? "" : "s"} before leaving your musical gift.`;
    }
    const minutes = Math.ceil(progress.dwellRemainingMs / 60000);
    return `Stay in the area a little longer — about ${minutes} minute${minutes === 1 ? "" : "s"} to go.`;
  }

  const api = {
    UNLOCK_DISTANCE_M, UNLOCK_DWELL_MS, MAX_PLAUSIBLE_SPEED_MPS,
    computeSpeedMps, isPlausibleMovement,
    initialExplorationState, applyFix, consumeUnlock, unlockProgress, progressMessage,
  };
  return api;
});

if (typeof window !== "undefined" && typeof window.ExplorationTrackerLib !== "undefined") {
  window.ExplorationTracker = window.ExplorationTrackerLib;
}
