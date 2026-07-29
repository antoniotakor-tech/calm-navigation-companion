// ---------------------------------------------------------------------------
// PatternLibrary — named vibration patterns as plain millisecond arrays
// (the same shape navigator.vibrate() takes), plus intensity scaling. Pure
// data + pure functions, no navigator/device access — that's HapticManager's
// job, this file is just "what are the patterns and how do we scale them".
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PatternLibrary = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Fidget-surface patterns (spec names, kept as literal single durations
  // where a "pulse" reads better than a multi-beat pattern).
  const PATTERNS = {
    softTap: [16],
    doubleTap: [14, 60, 14],
    heartbeat: [30, 90, 18, 320],
    wavePulse: [10, 40, 20, 40, 30, 40, 40, 40, 50],
    slowPulse: [60, 400, 60, 400],
    breathingPulse: [110, 850, 110, 850],
    ripple: [8, 30, 8, 30, 8],
    gentleBuzz: [220],
    textureSimulation: [4, 8, 4, 8, 4, 8, 4, 8, 4, 8, 4, 8],
    rollingPulse: [20, 20, 30, 20, 40, 20, 50, 20, 40, 20, 30, 20, 20],
  };

  // Navigation-linked patterns — deliberately distinct rhythms, not just
  // different lengths, so they're recognizable without looking: left and
  // right are mirror-image beat shapes, off-route is a longer, heavier,
  // unmistakably different feel from every turn cue.
  const NAV_PATTERNS = {
    turnLeft: [40, 40, 90],
    turnRight: [90, 40, 40],
    continueStraight: [22],
    roundabout: [20, 40, 20, 40, 20, 40, 20, 40],
    arrival: [30, 60, 30, 60, 30, 220],
    offRoute: [110, 90, 110, 90, 110],
    recalculating: [16, 120, 16, 120, 16],
  };

  function scale(pattern, intensity01, floorMs) {
    const i = Math.max(0, Math.min(1, intensity01 == null ? 1 : intensity01));
    const floor = floorMs || 2;
    return pattern.map((ms) => Math.max(floor, Math.round(ms * i)));
  }

  // Low-battery degrade: keep only every other beat and shorten what's left,
  // so a pattern is still recognizable but costs less. Never used unless the
  // caller has real battery info (see hapticmanager.js) — this function
  // itself is just the pure transform, easy to unit test on its own.
  function degradeForLowBattery(pattern) {
    const kept = pattern.filter((_, i) => i % 2 === 0);
    return kept.map((ms) => Math.max(2, Math.round(ms * 0.6)));
  }

  return { PATTERNS, NAV_PATTERNS, scale, degradeForLowBattery };
});
