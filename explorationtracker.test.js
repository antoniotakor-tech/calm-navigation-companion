const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("./explorationtracker.js");

// Amsterdam-ish coordinates. Metres-per-degree-latitude derived from the
// same spherical earth radius navlogic.js's haversineM uses (R=6371000), so
// these test fixtures land on the exact distances asserted below rather than
// drifting off by the ~0.1% difference a different standard constant (e.g.
// WGS84's 111320) would introduce.
const BASE = { lat: 52.3676, lon: 4.9041 };
const METRES_PER_DEGREE = (2 * Math.PI * 6371000) / 360;
function north(fix, metres) {
  return { lat: fix.lat + metres / METRES_PER_DEGREE, lon: fix.lon };
}

test("computeSpeedMps: a duplicate fix (no movement, no time) is 0 m/s, not a divide-by-zero blowup", () => {
  const fix = { lat: BASE.lat, lon: BASE.lon, atMs: 1000 };
  assert.equal(E.computeSpeedMps(fix, fix), 0);
});

test("computeSpeedMps: real movement with zero/negative elapsed time is treated as infinitely fast (a teleport)", () => {
  const a = { lat: BASE.lat, lon: BASE.lon, atMs: 1000 };
  const b = { lat: north(BASE, 200).lat, lon: BASE.lon, atMs: 1000 };
  assert.equal(E.computeSpeedMps(a, b), Infinity);
});

test("computeSpeedMps: a normal walking pace computes a small, sane m/s value", () => {
  const a = { lat: BASE.lat, lon: BASE.lon, atMs: 0 };
  const b = { lat: north(BASE, 130).lat, lon: BASE.lon, atMs: 100000 }; // 130m in 100s ~= 1.3 m/s
  const speed = E.computeSpeedMps(a, b);
  assert.ok(speed > 1.2 && speed < 1.4, `expected ~1.3 m/s, got ${speed}`);
});

test("isPlausibleMovement: rejects an instantaneous cross-town jump", () => {
  const a = { lat: BASE.lat, lon: BASE.lon, atMs: 0 };
  const b = { lat: north(BASE, 5000).lat, lon: BASE.lon, atMs: 1000 }; // 5km in 1s
  assert.equal(E.isPlausibleMovement(a, b), false);
});

test("isPlausibleMovement: accepts brisk-but-real walking/cycling speed", () => {
  const a = { lat: BASE.lat, lon: BASE.lon, atMs: 0 };
  const b = { lat: north(BASE, 40).lat, lon: BASE.lon, atMs: 10000 }; // 4 m/s
  assert.equal(E.isPlausibleMovement(a, b), true);
});

test("applyFix: the very first fix only opens the session, contributes no distance", () => {
  let state = E.initialExplorationState();
  state = E.applyFix(state, BASE, 0);
  assert.equal(state.distanceM, 0);
  assert.equal(state.sessionStartedAt, 0);
  assert.equal(state.unlocked, false);
});

test("applyFix: accumulates real distance across several plausible fixes", () => {
  let state = E.initialExplorationState();
  state = E.applyFix(state, BASE, 0);
  state = E.applyFix(state, north(BASE, 100), 60000);
  state = E.applyFix(state, north(BASE, 250), 150000);
  assert.ok(Math.abs(state.distanceM - 250) < 1, `expected ~250m, got ${state.distanceM}`);
});

test("applyFix: an implausible jump is rejected — neither distance nor position updates from it", () => {
  let state = E.initialExplorationState();
  state = E.applyFix(state, BASE, 0);
  state = E.applyFix(state, north(BASE, 100), 60000);
  const beforeJump = state;
  state = E.applyFix(state, north(BASE, 5100), 61000); // 5000m in 1s — implausible
  assert.equal(state.distanceM, beforeJump.distanceM);
  assert.deepEqual(state.lastFix, beforeJump.lastFix);
  assert.equal(state.lastFixRejected, true);

  // And the next GENUINE fix is measured from the last good position, not the rejected one.
  state = E.applyFix(state, north(BASE, 200), 120000);
  assert.ok(Math.abs(state.distanceM - 200) < 1, `expected ~200m total, got ${state.distanceM}`);
});

test("applyFix: unlocks only once BOTH 500m walked AND 3 minutes elapsed are true", () => {
  let state = E.initialExplorationState();
  state = E.applyFix(state, BASE, 0);
  // 520m in 60s (~8.7 m/s, brisk jog — still under the plausibility cap) covers the distance well before the 3-minute dwell requirement.
  state = E.applyFix(state, north(BASE, 520), 60000);
  assert.equal(state.unlocked, false, "distance met but only if dwell time also met");
  assert.equal(state.distanceM >= E.UNLOCK_DISTANCE_M, true);
});

test("applyFix: unlocks once distance and dwell are both satisfied", () => {
  let state = E.initialExplorationState();
  state = E.applyFix(state, BASE, 0);
  state = E.applyFix(state, north(BASE, 550), 200000);
  assert.equal(state.unlocked, true);
});

test("applyFix: once unlocked, the state is latched — further fixes are ignored until consumeUnlock", () => {
  let state = E.initialExplorationState();
  state = E.applyFix(state, BASE, 0);
  state = E.applyFix(state, north(BASE, 550), 200000);
  assert.equal(state.unlocked, true);
  const latched = state;
  state = E.applyFix(state, north(BASE, 900), 400000);
  assert.deepEqual(state, latched);
});

test("consumeUnlock: resets distance/time for a fresh session, but keeps the last known position as continuity", () => {
  let state = E.initialExplorationState();
  state = E.applyFix(state, BASE, 0);
  state = E.applyFix(state, north(BASE, 550), 200000);
  assert.equal(state.unlocked, true);

  const consumed = E.consumeUnlock(state, 200001);
  assert.equal(consumed.unlocked, false);
  assert.equal(consumed.distanceM, 0);
  assert.equal(consumed.sessionStartedAt, 200001);
  assert.deepEqual(consumed.lastFix, state.lastFix);
});

test("consumeUnlock: is a no-op when nothing is actually unlocked yet", () => {
  const state = E.initialExplorationState();
  assert.deepEqual(E.consumeUnlock(state, 500), state);
});

test("unlockProgress: reports remaining distance/time, both clamped at zero", () => {
  let state = E.initialExplorationState();
  state = E.applyFix(state, BASE, 0);
  state = E.applyFix(state, north(BASE, 400), 60000);
  const progress = E.unlockProgress(state, 60000);
  assert.ok(Math.abs(progress.distanceRemainingM - 100) < 1);
  assert.ok(progress.dwellRemainingMs > 0);
  assert.equal(progress.unlocked, false);
});

test("progressMessage: matches the spec's own wording pattern when distance is the binding constraint", () => {
  let state = E.initialExplorationState();
  state = E.applyFix(state, BASE, 0);
  state = E.applyFix(state, north(BASE, 360), 60000);
  const msg = E.progressMessage(state, 60000);
  assert.match(msg, /^Walk another \d+ metres? before leaving your musical gift\.$/);
});

test("progressMessage: switches to a time-based message once distance is already satisfied", () => {
  let state = E.initialExplorationState();
  state = E.applyFix(state, BASE, 0);
  state = E.applyFix(state, north(BASE, 550), 60000); // 550m in 60s (~9.2 m/s, plausible), distance met but dwell not yet
  const msg = E.progressMessage(state, 60000);
  assert.match(msg, /minute/);
});

test("progressMessage: shows the unlock CTA text once both conditions are met", () => {
  let state = E.initialExplorationState();
  state = E.applyFix(state, BASE, 0);
  state = E.applyFix(state, north(BASE, 550), 200000);
  assert.equal(E.progressMessage(state, 200000), "✨ Leave a Calm Echo");
});
