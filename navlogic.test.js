const test = require("node:test");
const assert = require("node:assert/strict");
const NavLogic = require("./navlogic.js");

test("haversineM: zero for identical points, symmetric, roughly right for a known distance", () => {
  assert.equal(NavLogic.haversineM(52.37, 4.90, 52.37, 4.90), 0);
  const ab = NavLogic.haversineM(52.3676, 4.9041, 52.3580, 4.8686);
  const ba = NavLogic.haversineM(52.3580, 4.8686, 52.3676, 4.9041);
  assert.equal(ab, ba);
  assert.ok(ab > 2000 && ab < 3000, `expected ~2.5km Centraal-Vondelpark-ish distance, got ${ab}`);
});

test("bearingDeg: due north is 0, due east is 90", () => {
  assert.ok(Math.abs(NavLogic.bearingDeg(52.0, 4.9, 52.1, 4.9)) < 1);
  assert.ok(Math.abs(NavLogic.bearingDeg(52.0, 4.9, 52.0, 5.0) - 90) < 2);
});

test("nearestRouteIndex: finds the closest vertex and its index, not just the distance", () => {
  const coords = [[4.90, 52.36], [4.91, 52.37], [4.92, 52.38]]; // [lon,lat]
  const result = NavLogic.nearestRouteIndex(52.37, 4.91, coords);
  assert.equal(result.index, 1);
  assert.ok(result.distanceM < 5);
});

test("roadClassAt: returns the segment covering the index, or 'unknown' with no segments", () => {
  const route = { roadClassSegments: [[0, 5, "residential"], [5, 10, "path"]] };
  assert.equal(NavLogic.roadClassAt(route, 3), "residential");
  assert.equal(NavLogic.roadClassAt(route, 7), "path");
  assert.equal(NavLogic.roadClassAt({}, 3), "unknown");
});

test("stepTargetLatLon: uses the step's interval end index into route.coordinates", () => {
  const route = { coordinates: [[4.90, 52.36], [4.91, 52.37], [4.92, 52.38]] };
  const target = NavLogic.stepTargetLatLon(route, { interval: [0, 2] });
  assert.equal(target.lat, 52.38);
  assert.equal(target.lon, 4.92);
});

test("stepTargetLatLon: falls back to the route's last point when there's no usable interval", () => {
  const route = { coordinates: [[4.90, 52.36], [4.92, 52.38]] };
  const target = NavLogic.stepTargetLatLon(route, null);
  assert.equal(target.lat, 52.38);
  assert.equal(target.lon, 4.92);
});

test("createNavState: starts NAVIGATING at step 0 with no off-route streak", () => {
  const route = { coordinates: [[4.9, 52.3]] };
  const state = NavLogic.createNavState(route);
  assert.equal(state.state, NavLogic.NavState.NAVIGATING);
  assert.equal(state.stepIdx, 0);
  assert.equal(state.offRouteStreak, 0);
});

test("processFix: a fix right on the route with no nearby maneuver just reports distances, no arrival/reroute", () => {
  const route = {
    coordinates: [[4.90, 52.36], [4.91, 52.37], [4.92, 52.38]],
    steps: [{ text: "Continue", interval: [0, 2] }],
  };
  const navState = NavLogic.createNavState(route);
  const info = NavLogic.processFix(navState, { lat: 52.36, lon: 4.90 });
  assert.equal(info.arrived, false);
  assert.equal(info.shouldReroute, false);
  assert.ok(info.distToRoute < 5);
});

test("processFix: a single off-route fix does not trigger a reroute — needs OFF_ROUTE_STREAK_NEEDED consecutive fixes", () => {
  const route = { coordinates: [[4.90, 52.36], [4.92, 52.38]], steps: [{ text: "Continue", interval: [0, 1] }] };
  const navState = NavLogic.createNavState(route);
  // Far from the route line (roughly 500m+ away).
  const farFix = { lat: 52.36 + 0.005, lon: 4.90 + 0.005 };
  const info = NavLogic.processFix(navState, farFix);
  assert.equal(info.shouldReroute, false);
  assert.equal(navState.offRouteStreak, 1);
});

test("processFix: sustained off-route fixes (streak) do trigger shouldReroute", () => {
  const route = { coordinates: [[4.90, 52.36], [4.92, 52.38]], steps: [{ text: "Continue", interval: [0, 1] }] };
  const navState = NavLogic.createNavState(route);
  const farFix = { lat: 52.36 + 0.01, lon: 4.90 + 0.01 };
  let info;
  for (let i = 0; i < NavLogic.THRESHOLDS.OFF_ROUTE_STREAK_NEEDED; i++) {
    info = NavLogic.processFix(navState, farFix);
  }
  assert.equal(info.shouldReroute, true);
  assert.equal(navState.state, NavLogic.NavState.OFF_ROUTE);
});

test("processFix: a fix within ARRIVE_DEST_M of the final point marks arrived", () => {
  const route = { coordinates: [[4.90, 52.36], [4.92, 52.38]], steps: [{ text: "Arrive", interval: [0, 1] }] };
  const navState = NavLogic.createNavState(route);
  const info = NavLogic.processFix(navState, { lat: 52.38, lon: 4.92 });
  assert.equal(info.arrived, true);
  assert.equal(navState.state, NavLogic.NavState.ARRIVED);
});

test("processFix: passing within ARRIVE_STEP_M of a maneuver auto-advances stepIdx", () => {
  const route = {
    coordinates: [[4.90, 52.36], [4.91, 52.37], [4.92, 52.38]],
    steps: [{ text: "Turn", interval: [0, 1] }, { text: "Arrive", interval: [1, 2] }],
  };
  const navState = NavLogic.createNavState(route);
  const info = NavLogic.processFix(navState, { lat: 52.37, lon: 4.91 });
  assert.equal(info.passedStep, true);
  assert.equal(navState.stepIdx, 1);
});

test("processFix: heading is derived from consecutive fixes only above HEADING_MIN_SPEED_MPS", () => {
  const route = { coordinates: [[4.90, 52.36], [4.90, 52.40]], steps: [{ text: "Continue", interval: [0, 1] }] };
  const navState = NavLogic.createNavState(route);
  NavLogic.processFix(navState, { lat: 52.36, lon: 4.90, speedMps: 0.1 });
  const stillInfo = NavLogic.processFix(navState, { lat: 52.3601, lon: 4.90, speedMps: 0.1 });
  assert.equal(stillInfo.heading, null, "heading should not update from noisy near-zero-speed movement");

  const movingInfo = NavLogic.processFix(navState, { lat: 52.365, lon: 4.90, speedMps: 2 });
  assert.ok(movingInfo.heading != null, "heading should derive once moving above the threshold");
});

test("processFix: an explicit headingDeg on the fix is always trusted over derived heading", () => {
  const route = { coordinates: [[4.90, 52.36], [4.90, 52.40]], steps: [{ text: "Continue", interval: [0, 1] }] };
  const navState = NavLogic.createNavState(route);
  const info = NavLogic.processFix(navState, { lat: 52.36, lon: 4.90, headingDeg: 123 });
  assert.equal(info.heading, 123);
});

test("resetForNewRoute: swaps the route and resets step/streak/state without losing the navState object identity", () => {
  const route1 = { coordinates: [[4.9, 52.3]] };
  const navState = NavLogic.createNavState(route1);
  navState.stepIdx = 3;
  navState.offRouteStreak = 2;
  navState.state = NavLogic.NavState.OFF_ROUTE;

  const route2 = { coordinates: [[4.8, 52.2]] };
  const result = NavLogic.resetForNewRoute(navState, route2);
  assert.equal(result, navState, "should mutate and return the same object");
  assert.equal(navState.route, route2);
  assert.equal(navState.stepIdx, 0);
  assert.equal(navState.offRouteStreak, 0);
  assert.equal(navState.state, NavLogic.NavState.NAVIGATING);
});

test("suggestAmbientLevel: off-route/recalculating always ducks ambient regardless of road class", () => {
  const r1 = NavLogic.suggestAmbientLevel({ navState: NavLogic.NavState.OFF_ROUTE, roadClass: "path" });
  assert.equal(r1.level, 0.4);
  const r2 = NavLogic.suggestAmbientLevel({ navState: NavLogic.NavState.RECALCULATING });
  assert.equal(r2.level, 0.4);
});

test("suggestAmbientLevel: a busy road class reduces the level even while navigating normally", () => {
  const r = NavLogic.suggestAmbientLevel({ navState: NavLogic.NavState.NAVIGATING, roadClass: "primary" });
  assert.equal(r.level, 0.6);
  assert.equal(r.reason, "busy-road");
});

test("suggestAmbientLevel: a calm road class at walking speed gets the full level", () => {
  const r = NavLogic.suggestAmbientLevel({ navState: NavLogic.NavState.NAVIGATING, roadClass: "path", speedMps: 1.3 });
  assert.equal(r.level, 1.0);
  assert.equal(r.reason, "calm-road");
});

test("suggestAmbientLevel: an unrecognized/neutral context falls back to the default level, never throws", () => {
  const r = NavLogic.suggestAmbientLevel();
  assert.equal(r.level, 0.85);
  assert.equal(r.reason, "default");
});

test("lerpLatLon: t=0 is the start point, t=1 is the end point, t=0.5 is the midpoint", () => {
  const start = NavLogic.lerpLatLon(52.36, 4.90, 52.38, 4.92, 0);
  const end = NavLogic.lerpLatLon(52.36, 4.90, 52.38, 4.92, 1);
  const mid = NavLogic.lerpLatLon(52.36, 4.90, 52.38, 4.92, 0.5);
  assert.deepEqual(start, { lat: 52.36, lon: 4.90 });
  assert.deepEqual(end, { lat: 52.38, lon: 4.92 });
  assert.ok(Math.abs(mid.lat - 52.37) < 1e-9);
  assert.ok(Math.abs(mid.lon - 4.91) < 1e-9);
});

test("lerpLatLon: clamps t outside 0..1 rather than extrapolating past either endpoint", () => {
  const beforeStart = NavLogic.lerpLatLon(52.36, 4.90, 52.38, 4.92, -0.5);
  const afterEnd = NavLogic.lerpLatLon(52.36, 4.90, 52.38, 4.92, 1.5);
  assert.deepEqual(beforeStart, { lat: 52.36, lon: 4.90 });
  assert.deepEqual(afterEnd, { lat: 52.38, lon: 4.92 });
});

test("smoothHeading: with no prior heading, the first reading passes through unsmoothed", () => {
  assert.equal(NavLogic.smoothHeading(null, 90, 0.35), 90);
});

test("smoothHeading: a missing new reading holds the last smoothed value", () => {
  assert.equal(NavLogic.smoothHeading(90, null, 0.35), 90);
  assert.equal(NavLogic.smoothHeading(null, null, 0.35), null);
});

test("smoothHeading: blends toward the new value by `factor`, not an instant jump", () => {
  const result = NavLogic.smoothHeading(0, 90, 0.5);
  assert.ok(Math.abs(result - 45) < 1e-9, `expected ~45 (halfway), got ${result}`);
});

test("smoothHeading: crosses the 0/360 wraparound the short way, not the long way around", () => {
  // 350 -> 10 is a 20-degree turn through 0/360, not a 340-degree turn the other way.
  const result = NavLogic.smoothHeading(350, 10, 0.5);
  assert.ok(result < 20 || result > 340, `expected the short way across 0/360, got ${result}`);
  // Specifically should land near 0 (350 + 10 short-way / 2 = 0), not near 180.
  const distFromZero = Math.min(result, 360 - result);
  assert.ok(distFromZero < 15, `expected close to 0deg, got ${result}`);
});

test("destinationPoint: heading 0 (due north) moves lat up, lon unchanged", () => {
  const dest = NavLogic.destinationPoint(52.37, 4.90, 0, 100);
  assert.ok(dest.lat > 52.37);
  assert.ok(Math.abs(dest.lon - 4.90) < 1e-6);
});

test("destinationPoint: heading 90 (due east) moves lon up, lat essentially unchanged", () => {
  const dest = NavLogic.destinationPoint(52.37, 4.90, 90, 100);
  assert.ok(dest.lon > 4.90);
  assert.ok(Math.abs(dest.lat - 52.37) < 1e-4);
});

test("destinationPoint: the resulting point is genuinely ~distanceM away from the start, per haversineM", () => {
  const dest = NavLogic.destinationPoint(52.37, 4.90, 45, 250);
  const actualDistance = NavLogic.haversineM(52.37, 4.90, dest.lat, dest.lon);
  assert.ok(Math.abs(actualDistance - 250) < 1, `expected ~250m, got ${actualDistance}`);
});

test("destinationPoint: zero distance returns (approximately) the same point", () => {
  const dest = NavLogic.destinationPoint(52.37, 4.90, 123, 0);
  assert.ok(Math.abs(dest.lat - 52.37) < 1e-9);
  assert.ok(Math.abs(dest.lon - 4.90) < 1e-9);
});
