const test = require("node:test");
const assert = require("node:assert/strict");
const { buildNavRoutePayload, validateNavRoutePayload, estimatePayloadBytes, PAYLOAD_VERSION } = require("./routeTransfer.js");

const THRESHOLDS = {
  ARRIVE_STEP_M: 18, ARRIVE_DEST_M: 20, OFF_ROUTE_M: 35,
  OFF_ROUTE_STREAK_NEEDED: 3, HEADING_MIN_SPEED_MPS: 0.6,
};

const ROUTE = {
  coordinates: [[4.90, 52.36], [4.91, 52.37], [4.92, 52.38]],
  distanceM: 1200, timeMs: 900000,
  steps: [{ text: "Turn left", interval: [0, 1], distanceM: 400, sign: -2, streetName: "Test St" }, { text: "Arrive", interval: [1, 2], distanceM: 0, sign: 4 }],
  roadClassSegments: [[0, 2, "residential"]],
};
const DESTINATION = { label: "Vondelpark", lat: 52.38, lon: 4.92 };

test("buildNavRoutePayload: thresholds are copied verbatim from navlogic.js, not re-declared", () => {
  const payload = buildNavRoutePayload({ route: ROUTE, destination: DESTINATION, travelMode: "walk", safetyMode: false, thresholds: THRESHOLDS });
  assert.equal(payload.thresholds.arriveStepM, THRESHOLDS.ARRIVE_STEP_M);
  assert.equal(payload.thresholds.offRouteStreakNeeded, THRESHOLDS.OFF_ROUTE_STREAK_NEEDED);
});

test("buildNavRoutePayload: converts [lon,lat] geometry into named {lat,lon} points", () => {
  const payload = buildNavRoutePayload({ route: ROUTE, destination: DESTINATION, travelMode: "walk", thresholds: THRESHOLDS });
  assert.deepEqual(payload.geometry[0], { lat: 52.36, lon: 4.90 });
});

test("buildNavRoutePayload: marks the last maneuver isFinal, and defaults travelMode to walk for anything but 'bike'", () => {
  const payload = buildNavRoutePayload({ route: ROUTE, destination: DESTINATION, travelMode: "car", thresholds: THRESHOLDS });
  assert.equal(payload.travelMode, "walk");
  assert.equal(payload.maneuvers[payload.maneuvers.length - 1].isFinal, true);
  assert.equal(payload.maneuvers[0].isFinal, false);
});

test("validateNavRoutePayload: accepts a well-formed payload", () => {
  const payload = buildNavRoutePayload({ route: ROUTE, destination: DESTINATION, travelMode: "walk", thresholds: THRESHOLDS });
  const result = validateNavRoutePayload(payload);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("validateNavRoutePayload: rejects an out-of-range destination coordinate", () => {
  const payload = buildNavRoutePayload({ route: ROUTE, destination: { ...DESTINATION, lat: 999 }, travelMode: "walk", thresholds: THRESHOLDS });
  const result = validateNavRoutePayload(payload);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("destination")));
});

test("validateNavRoutePayload: rejects too-short geometry", () => {
  const payload = buildNavRoutePayload({ route: { ...ROUTE, coordinates: [[4.9, 52.3]] }, destination: DESTINATION, travelMode: "walk", thresholds: THRESHOLDS });
  const result = validateNavRoutePayload(payload);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("geometry")));
});

test("validateNavRoutePayload: rejects an unsupported version", () => {
  const payload = buildNavRoutePayload({ route: ROUTE, destination: DESTINATION, travelMode: "walk", thresholds: THRESHOLDS });
  payload.version = 999;
  const result = validateNavRoutePayload(payload);
  assert.equal(result.valid, false);
});

test("validateNavRoutePayload: rejects a missing/invalid threshold", () => {
  const payload = buildNavRoutePayload({ route: ROUTE, destination: DESTINATION, travelMode: "walk", thresholds: THRESHOLDS });
  payload.thresholds.offRouteM = -5;
  const result = validateNavRoutePayload(payload);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("offRouteM")));
});

test("validateNavRoutePayload: null/non-object input fails cleanly, not with a thrown exception", () => {
  assert.equal(validateNavRoutePayload(null).valid, false);
  assert.equal(validateNavRoutePayload("not an object").valid, false);
});

test("estimatePayloadBytes: returns a positive number that grows with geometry size", () => {
  const small = buildNavRoutePayload({ route: ROUTE, destination: DESTINATION, travelMode: "walk", thresholds: THRESHOLDS });
  const biggerRoute = { ...ROUTE, coordinates: Array.from({ length: 200 }, (_, i) => [4.9 + i * 0.0001, 52.3 + i * 0.0001]) };
  const big = buildNavRoutePayload({ route: biggerRoute, destination: DESTINATION, travelMode: "walk", thresholds: THRESHOLDS });
  assert.ok(estimatePayloadBytes(big) > estimatePayloadBytes(small));
});

test("PAYLOAD_VERSION is a stable, exported constant", () => {
  assert.equal(typeof PAYLOAD_VERSION, "number");
});
