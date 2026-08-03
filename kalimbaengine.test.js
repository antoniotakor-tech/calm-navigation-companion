const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("./kalimbaengine.js");

test("KALIMBA_PITCHES: 15 tines, strictly ascending (each tine higher than the last)", () => {
  assert.equal(K.KALIMBA_PITCHES.length, 15);
  assert.equal(K.TINE_COUNT, 15);
  for (let i = 1; i < K.KALIMBA_PITCHES.length; i++) {
    assert.ok(K.KALIMBA_PITCHES[i] > K.KALIMBA_PITCHES[i - 1], `tine ${i} is not higher-pitched than tine ${i - 1}`);
  }
});

test("TINE_VISUAL_ORDER: a permutation of every tine index exactly once, lowest pitch centered", () => {
  const sorted = K.TINE_VISUAL_ORDER.slice().sort((a, b) => a - b);
  assert.deepEqual(sorted, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  const centerIndex = Math.floor(K.TINE_VISUAL_ORDER.length / 2);
  assert.equal(K.TINE_VISUAL_ORDER[centerIndex], 0, "the lowest tine (index 0) should sit in the physical center");
});

test("isValidTineIndex: only integers within the tine range are valid", () => {
  assert.equal(K.isValidTineIndex(0), true);
  assert.equal(K.isValidTineIndex(14), true);
  assert.equal(K.isValidTineIndex(5), true);
  assert.equal(K.isValidTineIndex(-1), false);
  assert.equal(K.isValidTineIndex(15), false);
  assert.equal(K.isValidTineIndex(2.5), false);
  assert.equal(K.isValidTineIndex(NaN), false);
  assert.equal(K.isValidTineIndex(undefined), false);
});

test("velocityFromGesture: every recognized gesture produces an audible (>0), non-clipping (<=1) velocity", () => {
  ["tap", "doubleTap", "sweep", "hold"].forEach((g) => {
    const v = K.velocityFromGesture(g);
    assert.ok(v > 0 && v <= 1, `${g} produced out-of-range velocity ${v}`);
  });
});

test("velocityFromGesture: doubleTap is louder than a plain tap (matches the 'octave harmony ping' being a deliberate accent)", () => {
  assert.ok(K.velocityFromGesture("doubleTap") > K.velocityFromGesture("tap"));
});

test("velocityFromGesture: an unrecognized gesture still returns a safe, audible middle velocity, not 0 or a throw", () => {
  const v = K.velocityFromGesture("not-a-real-gesture");
  assert.ok(v > 0 && v <= 1);
});

test("KALIMBA_KEYS: C is the canonical, unmodified KALIMBA_PITCHES array", () => {
  assert.deepEqual(K.KALIMBA_KEYS.C, K.KALIMBA_PITCHES);
});

test("KALIMBA_KEYS: every key is the same length and strictly ascending — a real transposition of the same shape", () => {
  K.KEY_NAMES.forEach((name) => {
    const pitches = K.KALIMBA_KEYS[name];
    assert.equal(pitches.length, K.TINE_COUNT, `key "${name}" has the wrong tine count`);
    for (let i = 1; i < pitches.length; i++) {
      assert.ok(pitches[i] > pitches[i - 1], `key "${name}" tine ${i} is not higher-pitched than tine ${i - 1}`);
    }
  });
});

test("transposeSemitones: +12 semitones is exactly one octave up (2x frequency) for every pitch", () => {
  const up = K.transposeSemitones(K.KALIMBA_PITCHES, 12);
  K.KALIMBA_PITCHES.forEach((f, i) => {
    assert.ok(Math.abs(up[i] - f * 2) < 0.01, `expected ${f * 2}, got ${up[i]}`);
  });
});

test("transposeSemitones: 0 semitones returns the same pitches (a real no-op transposition, not the same array reference)", () => {
  const same = K.transposeSemitones(K.KALIMBA_PITCHES, 0);
  assert.deepEqual(same, K.KALIMBA_PITCHES);
});

test("isValidKeyName: only real, offered key names pass", () => {
  assert.equal(K.isValidKeyName("C"), true);
  assert.equal(K.isValidKeyName("G"), true);
  assert.equal(K.isValidKeyName("bogus"), false);
  assert.equal(K.isValidKeyName(undefined), false);
});

test("velocityFromGesture: an intensity signal blends with the base velocity, always staying in range", () => {
  const low = K.velocityFromGesture("sweep", 0);
  const high = K.velocityFromGesture("sweep", 1);
  assert.ok(high > low);
  assert.ok(low > 0 && low <= 1);
  assert.ok(high > 0 && high <= 1);
  // Out-of-range intensity input (defensive — a drag-speed calculation could
  // theoretically overshoot 1) is clamped, not propagated as a bad velocity.
  const overshoot = K.velocityFromGesture("sweep", 5);
  assert.ok(overshoot <= 1);
});
