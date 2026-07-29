const test = require("node:test");
const assert = require("node:assert/strict");
const { clusterEchoes } = require("./echomarkerclustering.js");

test("empty/missing input produces no clusters", () => {
  assert.deepEqual(clusterEchoes([]), []);
  assert.deepEqual(clusterEchoes(null), []);
});

test("a single echo produces a single cluster of count 1 at its own coordinates", () => {
  const result = clusterEchoes([{ id: "a", lat: 52.3676, lon: 4.9041 }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].count, 1);
  assert.equal(result[0].lat, 52.3676);
  assert.equal(result[0].lon, 4.9041);
});

test("two echoes a few metres apart collapse into one cluster", () => {
  const a = { id: "a", lat: 52.3676, lon: 4.9041 };
  const b = { id: "b", lat: 52.36761, lon: 4.90411 }; // ~1m away
  const result = clusterEchoes([a, b], 40);
  assert.equal(result.length, 1);
  assert.equal(result[0].count, 2);
});

test("two echoes far apart (different park) stay as separate clusters", () => {
  const a = { id: "a", lat: 52.3676, lon: 4.9041 };
  const b = { id: "b", lat: 52.3900, lon: 4.9041 }; // ~2.5km away
  const result = clusterEchoes([a, b], 40);
  assert.equal(result.length, 2);
  assert.ok(result.every((c) => c.count === 1));
});

test("a cluster's position is the average of its members, not an arbitrary grid corner", () => {
  const a = { id: "a", lat: 52.36760, lon: 4.90410 };
  const b = { id: "b", lat: 52.36762, lon: 4.90412 };
  const result = clusterEchoes([a, b], 40);
  assert.equal(result.length, 1);
  const expectedLat = (a.lat + b.lat) / 2;
  const expectedLon = (a.lon + b.lon) / 2;
  assert.ok(Math.abs(result[0].lat - expectedLat) < 1e-9);
  assert.ok(Math.abs(result[0].lon - expectedLon) < 1e-9);
});

test("every input echo is retained inside its cluster's echoes list", () => {
  const echoes = [
    { id: "a", lat: 52.3676, lon: 4.9041 },
    { id: "b", lat: 52.36761, lon: 4.90411 },
    { id: "c", lat: 52.5000, lon: 4.9041 },
  ];
  const result = clusterEchoes(echoes, 40);
  const totalMembers = result.reduce((sum, c) => sum + c.echoes.length, 0);
  assert.equal(totalMembers, echoes.length);
});

test("a smaller cell size splits echoes that a larger cell size would merge", () => {
  const a = { id: "a", lat: 52.3676, lon: 4.9041 };
  const b = { id: "b", lat: 52.36765, lon: 4.9041 }; // ~5.5m away
  const merged = clusterEchoes([a, b], 40);
  const split = clusterEchoes([a, b], 2);
  assert.equal(merged.length, 1);
  assert.equal(split.length, 2);
});
