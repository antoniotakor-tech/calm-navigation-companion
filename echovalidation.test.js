const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("./echovalidation.js");

test("isDurationValid: accepts the 2s-20s window, rejects outside it and non-numbers", () => {
  assert.equal(V.isDurationValid(2000), true);
  assert.equal(V.isDurationValid(20000), true);
  assert.equal(V.isDurationValid(1999), false);
  assert.equal(V.isDurationValid(20001), false);
  assert.equal(V.isDurationValid("5000"), false);
  assert.equal(V.isDurationValid(NaN), false);
});

test("isValidLatLon: rejects out-of-range and non-finite values", () => {
  assert.equal(V.isValidLatLon(52.37, 4.90), true);
  assert.equal(V.isValidLatLon(90, 180), true);
  assert.equal(V.isValidLatLon(-90, -180), true);
  assert.equal(V.isValidLatLon(90.1, 0), false);
  assert.equal(V.isValidLatLon(0, 180.1), false);
  assert.equal(V.isValidLatLon(NaN, 0), false);
  assert.equal(V.isValidLatLon(0, undefined), false);
});

test("validateMessage/validateNickname: empty is valid+null, over-length is rejected, valid text is trimmed", () => {
  assert.deepEqual(V.validateMessage(""), { valid: true, value: null });
  assert.equal(V.validateMessage("x".repeat(101)).valid, false);
  assert.equal(V.validateMessage("  hi  ").value, "hi");
  assert.equal(V.validateNickname("x".repeat(25)).valid, false);
  assert.deepEqual(V.validateNickname(null), { valid: true, value: null });
});

test("validateMelody: rejects a non-array, an empty array, and an over-long array", () => {
  assert.equal(V.validateMelody(null, 5000).valid, false);
  assert.equal(V.validateMelody([], 5000).valid, false);
  const tooMany = Array.from({ length: V.MAX_MELODY_EVENTS + 1 }, (_, i) => ({ t: i, tine: 0, v: 0.5 }));
  assert.equal(V.validateMelody(tooMany, 20000).valid, false);
});

test("validateMelody: rejects an event whose t exceeds the claimed durationMs", () => {
  const r = V.validateMelody([{ t: 6000, tine: 0, v: 0.5 }], 5000);
  assert.equal(r.valid, false);
});

test("validateMelody: rejects an out-of-range or non-integer tine index", () => {
  assert.equal(V.validateMelody([{ t: 0, tine: 11, v: 0.5 }], 5000).valid, false);
  assert.equal(V.validateMelody([{ t: 0, tine: -1, v: 0.5 }], 5000).valid, false);
  assert.equal(V.validateMelody([{ t: 0, tine: 1.5, v: 0.5 }], 5000).valid, false);
});

test("validateMelody: rejects a velocity outside 0..1", () => {
  assert.equal(V.validateMelody([{ t: 0, tine: 0, v: 1.5 }], 5000).valid, false);
  assert.equal(V.validateMelody([{ t: 0, tine: 0, v: -0.1 }], 5000).valid, false);
});

test("validateMelody: accepts a well-formed melody", () => {
  const r = V.validateMelody([{ t: 0, tine: 0, v: 0.5 }, { t: 1200, tine: 5, v: 0.9 }], 5000);
  assert.equal(r.valid, true);
});

test("validateEchoCreatePayload: happy path returns a normalized, trimmed value", () => {
  const r = V.validateEchoCreatePayload({
    lat: 52.37, lon: 4.90, durationMs: 5000,
    melody: [{ t: 0, tine: 0, v: 0.5 }],
    message: "  Take a deep breath.  ", nickname: "  Wanderer  ",
    creatorToken: "a-real-random-uuid-like-token",
  });
  assert.equal(r.valid, true);
  assert.equal(r.value.message, "Take a deep breath.");
  assert.equal(r.value.nickname, "Wanderer");
});

test("validateEchoCreatePayload: rejects a missing/malformed body, bad coordinates, or a missing creatorToken", () => {
  assert.equal(V.validateEchoCreatePayload(null).valid, false);
  assert.equal(V.validateEchoCreatePayload({ lat: 999, lon: 4.9, durationMs: 5000, melody: [{ t: 0, tine: 0, v: 0.5 }] }).valid, false);
  assert.equal(V.validateEchoCreatePayload({ lat: 52.37, lon: 4.9, durationMs: 5000, melody: [{ t: 0, tine: 0, v: 0.5 }] }).valid, false, "missing creatorToken must fail");
});

test("clampNearbyRadius: falls back to the default for invalid input, caps at the max, passes through a sane value", () => {
  assert.equal(V.clampNearbyRadius(undefined), V.DEFAULT_NEARBY_RADIUS_M);
  assert.equal(V.clampNearbyRadius(-5), V.DEFAULT_NEARBY_RADIUS_M);
  assert.equal(V.clampNearbyRadius("not-a-number"), V.DEFAULT_NEARBY_RADIUS_M);
  assert.equal(V.clampNearbyRadius(999999), V.MAX_NEARBY_RADIUS_M);
  assert.equal(V.clampNearbyRadius(300), 300);
});

test("fuzzLocation: with a fixed rng, offsets by a distance within [FUZZ_MIN_M, FUZZ_MAX_M)", () => {
  const rng = (() => {
    const values = [0.5, 0.25]; // distance fraction, bearing fraction
    let i = 0;
    return () => values[i++ % values.length];
  })();
  const result = V.fuzzLocation(52.3676, 4.9041, rng);
  const dLat = (result.lat - 52.3676) * (Math.PI / 180) * 6371000;
  const dLon = (result.lon - 4.9041) * (Math.PI / 180) * 6371000 * Math.cos(52.3676 * Math.PI / 180);
  const distanceM = Math.hypot(dLat, dLon);
  assert.ok(distanceM >= V.FUZZ_MIN_M - 0.01 && distanceM <= V.FUZZ_MAX_M + 0.01, `expected 10-20m offset, got ${distanceM}`);
});

test("fuzzLocation: never returns the exact original coordinates", () => {
  const result = V.fuzzLocation(52.3676, 4.9041, () => 0);
  assert.notEqual(result.lat, 52.3676);
});

test("boundingBox: produces a box that contains the center point and roughly the right span", () => {
  const box = V.boundingBox(52.3676, 4.9041, 500);
  assert.ok(box.minLat < 52.3676 && box.maxLat > 52.3676);
  assert.ok(box.minLon < 4.9041 && box.maxLon > 4.9041);
});

test("hashCreatorToken: deterministic, hex-encoded, and never equal to the raw input", async () => {
  const hash1 = await V.hashCreatorToken("my-device-token");
  const hash2 = await V.hashCreatorToken("my-device-token");
  assert.equal(hash1, hash2);
  assert.match(hash1, /^[0-9a-f]{64}$/);
  assert.notEqual(hash1, "my-device-token");
});

test("hashCreatorToken: different inputs hash to different outputs", async () => {
  const a = await V.hashCreatorToken("token-a");
  const b = await V.hashCreatorToken("token-b");
  assert.notEqual(a, b);
});

test("isRateLimited: true at/above the daily cap, false below it", () => {
  assert.equal(V.isRateLimited(0), false);
  assert.equal(V.isRateLimited(4), false);
  assert.equal(V.isRateLimited(5), true);
  assert.equal(V.isRateLimited(6), true);
});
