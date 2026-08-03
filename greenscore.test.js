const test = require("node:test");
const assert = require("node:assert/strict");
const {
  haversineM, pointToSegmentM, isClosedRing, pointInPolygon, sampleRouteEvenly,
  nearestGreenDistanceM, computeGreenCoverage, greenBonus, GREEN_BONUS_MAX,
} = require("./greenscore.js");

test("haversineM: known distance — roughly 1 degree of longitude at the equator is ~111.3km", () => {
  const d = haversineM([0, 0], [1, 0]);
  assert.ok(Math.abs(d - 111320) < 500, `expected ~111320m, got ${d}`);
});

test("pointToSegmentM: a point exactly on the segment is ~zero distance", () => {
  const a = [4.9, 52.37];
  const b = [4.91, 52.37];
  const mid = [4.905, 52.37];
  assert.ok(pointToSegmentM(mid, a, b) < 1, "midpoint of the segment should be ~0m away");
});

test("pointToSegmentM: a point off to the side measures its perpendicular offset, not distance to an endpoint", () => {
  const a = [4.9, 52.37];
  const b = [4.91, 52.37];
  // ~0.0003 deg north of the segment's midpoint, roughly 33m at this latitude.
  const off = [4.905, 52.3703];
  const d = pointToSegmentM(off, a, b);
  assert.ok(d > 25 && d < 40, `expected ~33m perpendicular offset, got ${d}`);
});

test("sampleRouteEvenly: returns exactly `count` points spanning start to end", () => {
  const coords = [[0, 0], [0, 0.001], [0, 0.002], [0, 0.003]];
  const samples = sampleRouteEvenly(coords, 5);
  assert.equal(samples.length, 5);
  assert.deepEqual(samples[0], coords[0]);
  assert.deepEqual(samples[samples.length - 1], coords[coords.length - 1]);
});

test("sampleRouteEvenly: samples are evenly spaced by real distance regardless of uneven point density", () => {
  // Dense cluster of points near the start, one big jump to the end —
  // mirrors real GraphHopper geometry (more points on winding streets).
  const coords = [[0, 0], [0, 0.00001], [0, 0.00002], [0, 0.00003], [0, 0.01]];
  const samples = sampleRouteEvenly(coords, 4);
  const legs = [];
  for (let i = 0; i < samples.length - 1; i++) legs.push(haversineM(samples[i], samples[i + 1]));
  const maxLeg = Math.max(...legs);
  const minLeg = Math.min(...legs);
  assert.ok(maxLeg - minLeg < 1, `expected near-equal leg lengths, got legs ${legs}`);
});

test("sampleRouteEvenly: degenerate input (0-1 points, count<1) never throws", () => {
  assert.deepEqual(sampleRouteEvenly([], 5), []);
  assert.deepEqual(sampleRouteEvenly([[1, 1]], 5), [[1, 1]]);
  assert.deepEqual(sampleRouteEvenly([[1, 1], [2, 2]], 0), []);
});

test("isClosedRing: true when first point equals last point and there are enough vertices, false otherwise", () => {
  assert.equal(isClosedRing([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]), true);
  assert.equal(isClosedRing([[0, 0], [1, 0], [1, 1]]), false, "open way, doesn't return to start");
  assert.equal(isClosedRing([[0, 0], [0, 0]]), false, "too few vertices to be a real ring");
});

test("pointInPolygon: correctly classifies inside vs. outside a simple square ring", () => {
  const square = [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]];
  assert.equal(pointInPolygon([0.005, 0.005], square), true);
  assert.equal(pointInPolygon([0.5, 0.5], square), false);
});

test("nearestGreenDistanceM: a point on a park way's edge is near-zero away", () => {
  const parkWay = [[4.900, 52.370], [4.905, 52.370], [4.905, 52.375], [4.900, 52.375], [4.900, 52.370]];
  const insidePoint = [4.9025, 52.370]; // sits right on the bottom edge
  assert.ok(nearestGreenDistanceM(insidePoint, [parkWay]) < 5);
});

test("nearestGreenDistanceM: a point deep inside a closed park ring is distance 0, not distance-to-nearest-edge", () => {
  // A large park (~700m x 550m) — its centroid is ~275-350m from every edge,
  // which a boundary-only distance check would wrongly score as "far from
  // green". Containment must short-circuit to 0 for points genuinely inside.
  const bigPark = [[4.900, 52.365], [4.910, 52.365], [4.910, 52.370], [4.900, 52.370], [4.900, 52.365]];
  const centroid = [4.905, 52.3675];
  assert.equal(nearestGreenDistanceM(centroid, [bigPark]), 0);
});

test("nearestGreenDistanceM: a far point returns a large distance, empty list returns Infinity", () => {
  const parkWay = [[4.900, 52.370], [4.905, 52.370]];
  const farPoint = [10, 52.370];
  assert.ok(nearestGreenDistanceM(farPoint, [parkWay]) > 100000);
  assert.equal(nearestGreenDistanceM(farPoint, []), Infinity);
});

test("computeGreenCoverage: a route running straight through a park scores high greenPct", () => {
  const parkWay = [[4.900, 52.3695], [4.910, 52.3695], [4.910, 52.3705], [4.900, 52.3705], [4.900, 52.3695]];
  const routeThroughPark = [[4.900, 52.370], [4.902, 52.370], [4.904, 52.370], [4.906, 52.370], [4.908, 52.370]];
  const r = computeGreenCoverage(routeThroughPark, [parkWay]);
  assert.ok(r.greenPct >= 80, `expected most sample points inside/near the park, got ${r.greenPct}%`);
});

test("computeGreenCoverage: a route far from any green way scores 0%", () => {
  const parkWay = [[4.900, 52.370], [4.905, 52.370]];
  const distantRoute = [[10, 52.370], [10.01, 52.370], [10.02, 52.370]];
  const r = computeGreenCoverage(distantRoute, [parkWay]);
  assert.equal(r.greenPct, 0);
});

test("computeGreenCoverage: no green data at all fails toward 0, not toward inventing a score", () => {
  const route = [[4.900, 52.370], [4.905, 52.370]];
  assert.deepEqual(computeGreenCoverage(route, []), { greenPct: 0, sampleCount: 0 });
  assert.deepEqual(computeGreenCoverage(route, null), { greenPct: 0, sampleCount: 0 });
  assert.deepEqual(computeGreenCoverage(null, [[[0, 0], [1, 1]]]), { greenPct: 0, sampleCount: 0 });
});

test("greenBonus: 0% coverage gives no bonus, 100% gives the full capped bonus, monotonic in between", () => {
  assert.equal(greenBonus(0), 0);
  assert.equal(greenBonus(100), GREEN_BONUS_MAX);
  assert.ok(greenBonus(30) < greenBonus(70));
});

test("greenBonus: clamps out-of-range input instead of exceeding the cap", () => {
  assert.equal(greenBonus(500), GREEN_BONUS_MAX);
  assert.equal(greenBonus(-50), 0);
});
