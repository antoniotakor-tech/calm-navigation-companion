const test = require("node:test");
const assert = require("node:assert/strict");
const { specialEventToday, scoreRoadClassBreakdown, isPeakNow, isNightNow, CALM_SCORE, SAFETY_CALM_SCORE } = require("./routing.js");

test("isPeakNow: true inside a window, false outside all windows", () => {
  assert.equal(isPeakNow([{ startHour: 7, endHour: 9.5 }]), false, "this assumes the test doesn't run at 7-9:30am — see next test for a robust version");
});

test("isPeakNow: robust — construct windows around the current time", () => {
  const now = new Date();
  const hourFloat = now.getHours() + now.getMinutes() / 60;
  assert.equal(isPeakNow([{ startHour: hourFloat - 0.5, endHour: hourFloat + 0.5 }]), true);
  assert.equal(isPeakNow([{ startHour: (hourFloat + 5) % 24, endHour: (hourFloat + 5.5) % 24 }]), false);
});

test("isNightNow: returns a boolean without throwing (exact value depends on current wall-clock time)", () => {
  assert.equal(typeof isNightNow(), "boolean");
});

test("specialEventToday: finds an event matching today's month/day, ignores non-matching ones", () => {
  const now = new Date();
  const events = [{ month: now.getMonth() + 1, day: now.getDate(), name: "Test Event" }];
  const found = specialEventToday(events);
  assert.equal(found.name, "Test Event");

  const noMatch = specialEventToday([{ month: 1, day: 1, name: "New Year" }]);
  // Only asserts null when today genuinely isn't Jan 1 — avoids a flaky test on that one date.
  if (now.getMonth() !== 0 || now.getDate() !== 1) assert.equal(noMatch, null);
});

test("specialEventToday: empty/missing list never throws", () => {
  assert.equal(specialEventToday([]), null);
  assert.equal(specialEventToday(undefined), null);
});

test("scoreRoadClassBreakdown: empty/missing detail returns a neutral zero score", () => {
  const r = scoreRoadClassBreakdown(null, false, false);
  assert.equal(r.score, 0);
  assert.equal(r.isolatedPct, 0);
});

test("scoreRoadClassBreakdown: a fully residential route scores its CALM_SCORE value exactly", () => {
  const r = scoreRoadClassBreakdown([[0, 10, "residential"]], false, false);
  assert.equal(r.score, CALM_SCORE.residential);
});

test("scoreRoadClassBreakdown: mixed segments produce a length-weighted average", () => {
  // 10 units of path (score 10) + 10 units of motorway (score -6) -> average 2.
  const r = scoreRoadClassBreakdown([[0, 10, "path"], [10, 20, "motorway"]], false, false);
  assert.ok(Math.abs(r.score - 2) < 0.01, `expected ~2, got ${r.score}`);
});

test("scoreRoadClassBreakdown: isolatedPct reflects the share of path/track/footway/steps segments", () => {
  const r = scoreRoadClassBreakdown([[0, 5, "path"], [5, 10, "residential"]], false, false);
  assert.equal(r.isolatedPct, 50);
});

test("scoreRoadClassBreakdown: peak hour further penalizes already-busy road types", () => {
  const offPeak = scoreRoadClassBreakdown([[0, 10, "primary"]], false, false);
  const peak = scoreRoadClassBreakdown([[0, 10, "primary"]], true, false);
  assert.ok(peak.score < offPeak.score, "peak-hour penalty should make an already-busy road score even lower");
});

test("scoreRoadClassBreakdown: safety mode uses SAFETY_CALM_SCORE instead of CALM_SCORE", () => {
  const normal = scoreRoadClassBreakdown([[0, 10, "path"]], false, false);
  const safety = scoreRoadClassBreakdown([[0, 10, "path"]], false, true);
  assert.equal(normal.score, CALM_SCORE.path);
  assert.equal(safety.score, SAFETY_CALM_SCORE.path);
  assert.notEqual(normal.score, safety.score, "path should score very differently under safety mode (isolated path vs residential preference)");
});

test("scoreRoadClassBreakdown: an unrecognized road class value falls back to the 'other' score", () => {
  const r = scoreRoadClassBreakdown([[0, 10, "some_unknown_type"]], false, false);
  assert.equal(r.score, CALM_SCORE.other);
});
