const test = require("node:test");
const assert = require("node:assert/strict");
const { tineIndexForPosition, shouldRegisterSweepPluck, isDoubleTap, octaveHarmonyTine } = require("./kalimbacontroller.js");
const { TINE_VISUAL_ORDER, TINE_COUNT } = require("./kalimbaengine.js");

test("tineIndexForPosition: the leftmost strip maps to the first visual-order entry, the rightmost to the last", () => {
  assert.equal(tineIndexForPosition(0, TINE_VISUAL_ORDER), TINE_VISUAL_ORDER[0]);
  assert.equal(tineIndexForPosition(0.999, TINE_VISUAL_ORDER), TINE_VISUAL_ORDER[TINE_VISUAL_ORDER.length - 1]);
});

test("tineIndexForPosition: the exact center strip is the lowest-pitched tine (matches a real kalimba's layout)", () => {
  const centerFraction = 0.5 + 1 / (TINE_VISUAL_ORDER.length * 4); // safely inside the center strip
  assert.equal(tineIndexForPosition(centerFraction, TINE_VISUAL_ORDER), 0);
});

test("tineIndexForPosition: out-of-canvas input (negative, >=1, null) is 'no tine', not a clamp to an edge tine", () => {
  assert.equal(tineIndexForPosition(-0.1, TINE_VISUAL_ORDER), null);
  assert.equal(tineIndexForPosition(1, TINE_VISUAL_ORDER), null);
  assert.equal(tineIndexForPosition(1.2, TINE_VISUAL_ORDER), null);
  assert.equal(tineIndexForPosition(null, TINE_VISUAL_ORDER), null);
});

test("tineIndexForPosition: every strip across the full width resolves to a valid, in-range tine", () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const idx = tineIndexForPosition(i / 1000, TINE_VISUAL_ORDER);
    assert.ok(idx >= 0 && idx < TINE_COUNT);
    seen.add(idx);
  }
  assert.equal(seen.size, TINE_COUNT, "a full sweep across the canvas should touch every tine at least once");
});

test("shouldRegisterSweepPluck: only fires when the pointer enters a genuinely different tine", () => {
  assert.equal(shouldRegisterSweepPluck(3, 3), false, "staying on the same tine must not re-pluck every pointermove");
  assert.equal(shouldRegisterSweepPluck(3, 4), true);
  assert.equal(shouldRegisterSweepPluck(null, 4), true, "entering the instrument for the first time during a drag should pluck");
  assert.equal(shouldRegisterSweepPluck(3, null), false, "sliding off the instrument entirely must not pluck 'nothing'");
});

test("isDoubleTap: a quick second tap on the SAME tine within the window counts", () => {
  const lastTap = { tineIndex: 5, t: 1000 };
  assert.equal(isDoubleTap(lastTap, 5, 1200), true);
});

test("isDoubleTap: a quick tap on a DIFFERENT tine is two single notes, not a double tap", () => {
  const lastTap = { tineIndex: 5, t: 1000 };
  assert.equal(isDoubleTap(lastTap, 6, 1200), false);
});

test("isDoubleTap: too much time between taps does not count, even on the same tine", () => {
  const lastTap = { tineIndex: 5, t: 1000 };
  assert.equal(isDoubleTap(lastTap, 5, 1000 + 5000), false);
});

test("isDoubleTap: no prior tap at all is never a double tap", () => {
  assert.equal(isDoubleTap(null, 5, 1000), false);
});

test("octaveHarmonyTine: adds the accent tine five positions up when the instrument has room", () => {
  assert.equal(octaveHarmonyTine(0, TINE_COUNT), 5);
  assert.equal(octaveHarmonyTine(5, TINE_COUNT), 10);
});

test("octaveHarmonyTine: returns null instead of an out-of-range tine when there's no room left to add the accent", () => {
  assert.equal(octaveHarmonyTine(6, TINE_COUNT), null);
  assert.equal(octaveHarmonyTine(10, TINE_COUNT), null);
});
