const test = require("node:test");
const assert = require("node:assert/strict");
const {
  specialEventToday, scoreRoadClassBreakdown, isPeakNow, isNightNow, CALM_SCORE, SAFETY_CALM_SCORE,
  haversineM, segmentDistanceM, unionBboxDeg, fetchGreenWays, fetchCalmRoute,
} = require("./routing.js");

async function withMockedFetch(impl, fn) {
  const original = global.fetch;
  global.fetch = impl;
  try {
    return await fn();
  } finally {
    global.fetch = original;
  }
}

test("isPeakNow: true inside a window, false outside all windows", () => {
  // Clock injected, not read from the wall: the previous version of this test
  // asserted false against a hardcoded 7-9:30 window and therefore failed on
  // every run between 07:00 and 09:30 local.
  const windows = [{ startHour: 7, endHour: 9.5 }];
  assert.equal(isPeakNow(windows, new Date(2026, 0, 15, 8, 15)), true, "08:15 is inside 7-9:30");
  assert.equal(isPeakNow(windows, new Date(2026, 0, 15, 14, 0)), false, "14:00 is outside every window");
  assert.equal(isPeakNow([], new Date(2026, 0, 15, 8, 15)), false, "no windows means never peak");
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

test("haversineM: known distance — roughly 1 degree of longitude at the equator is ~111.3km", () => {
  const d = haversineM([0, 0], [1, 0]);
  assert.ok(Math.abs(d - 111320) < 500, `expected ~111320m, got ${d}`);
});

test("haversineM: same point is zero distance", () => {
  assert.equal(haversineM([4.9, 52.37], [4.9, 52.37]), 0);
});

test("segmentDistanceM: sums consecutive-point legs between from/to indices", () => {
  // Three points ~11.1m apart each (0.0001 deg lat steps) -> ~22.2m over two legs.
  const coords = [[4.9, 52.37], [4.9, 52.3701], [4.9, 52.3702]];
  const d = segmentDistanceM(coords, 0, 2);
  assert.ok(d > 20 && d < 25, `expected ~22m, got ${d}`);
});

test("segmentDistanceM: null when coordinates are missing or the range is empty", () => {
  assert.equal(segmentDistanceM(null, 0, 5), null);
  assert.equal(segmentDistanceM([[0, 0]], 0, 0), null);
});

test("unionBboxDeg: covers every point across every path, padded outward", () => {
  const paths = [[[4.90, 52.36], [4.91, 52.37]], [[4.89, 52.35], [4.92, 52.38]]];
  const box = unionBboxDeg(paths, 0.01);
  assert.equal(box.minLon, 4.88);
  assert.equal(box.maxLon, 4.93);
  assert.equal(box.minLat, 52.34);
  assert.equal(box.maxLat, 52.39);
});

test("unionBboxDeg: null for no coordinates anywhere", () => {
  assert.equal(unionBboxDeg([], 0.01), null);
  assert.equal(unionBboxDeg([[]], 0.01), null);
});

test("fetchGreenWays: sends the union bbox to /api/greenspace and returns its ways", async () => {
  let sentUrl = null;
  await withMockedFetch(
    async (url) => { sentUrl = url; return { ok: true, json: async () => ({ ways: [[[0, 0], [1, 1]]] }) }; },
    async () => {
      const ways = await fetchGreenWays([[[4.90, 52.36], [4.91, 52.37]]], "", 5000);
      assert.equal(ways.length, 1);
      assert.match(sentUrl, /\/api\/greenspace\?bbox=/);
    }
  );
});

test("fetchGreenWays: fails toward an empty list on network error or a non-ok response, never throws", async () => {
  await withMockedFetch(
    async () => { throw new Error("offline"); },
    async () => {
      const ways = await fetchGreenWays([[[4.90, 52.36]]], "", 5000);
      assert.deepEqual(ways, []);
    }
  );
  await withMockedFetch(
    async () => ({ ok: false, status: 502 }),
    async () => {
      const ways = await fetchGreenWays([[[4.90, 52.36]]], "", 5000);
      assert.deepEqual(ways, []);
    }
  );
});

test("fetchCalmRoute: a real green-space bonus breaks a close road-class tie in favor of the greener path", async () => {
  // Path A: "unclassified" (CALM_SCORE 5) running entirely through a mapped park.
  // Path B: "residential" (CALM_SCORE 6) nowhere near any green way — a 1-point
  // road-class edge, well inside GREEN_BONUS_MAX (2.5). Road-class-only, B wins.
  // With A's real, measured green coverage blended in, A should win instead —
  // proving the signal actually moves a close-tie pick, not just gets computed
  // and ignored (it's deliberately NOT enough to flip a route through a park
  // past, say, a motorway — see greenscore.js's GREEN_BONUS_MAX comment).
  const pathA = {
    points: { coordinates: [[4.900, 52.370], [4.902, 52.370], [4.904, 52.370]] },
    distance: 500, time: 400000,
    details: { road_class: [[0, 2, "unclassified"]] },
    instructions: [],
  };
  const pathB = {
    points: { coordinates: [[10.0, 10.0], [10.002, 10.0]] },
    distance: 400, time: 300000,
    details: { road_class: [[0, 1, "residential"]] },
    instructions: [],
  };
  const park = [[4.899, 52.369], [4.905, 52.369], [4.905, 52.371], [4.899, 52.371], [4.899, 52.369]];

  global.GreenScore = require("./greenscore.js");
  try {
    await withMockedFetch(
      async (url) => {
        if (String(url).includes("/api/greenspace")) return { ok: true, json: async () => ({ ways: [park] }) };
        return { ok: true, json: async () => ({ paths: [pathA, pathB] }) };
      },
      async () => {
        const result = await fetchCalmRoute({ start: { lat: 4.9, lon: 52.37 }, end: { lat: 4.9, lon: 52.37 }, peakWindows: [], safetyMode: false, specialEvents: [] });
        assert.equal(result.calm.roadClassScore, CALM_SCORE.unclassified, "the park route should have won calmest once its measured green coverage broke the close tie");
        assert.ok(result.calm.greenPct > 0, "the park route's greenPct should reflect real measured coverage");
        assert.ok(result.calm.calmScore > result.calm.roadClassScore, "blended calmScore should exceed the bare road-class score once a green bonus is added");
      }
    );
  } finally {
    delete global.GreenScore;
  }
});

test("fetchCalmRoute: no green data (Overpass fails) leaves calmScore equal to roadClassScore — never invents a bonus", async () => {
  const pathA = {
    points: { coordinates: [[4.900, 52.370], [4.902, 52.370]] },
    distance: 300, time: 200000,
    details: { road_class: [[0, 1, "residential"]] },
    instructions: [],
  };
  global.GreenScore = require("./greenscore.js");
  try {
    await withMockedFetch(
      async (url) => {
        if (String(url).includes("/api/greenspace")) return { ok: false, status: 502 };
        return { ok: true, json: async () => ({ paths: [pathA] }) };
      },
      async () => {
        const result = await fetchCalmRoute({ start: { lat: 4.9, lon: 52.37 }, end: { lat: 4.9, lon: 52.37 }, peakWindows: [], safetyMode: false, specialEvents: [] });
        assert.equal(result.calm.calmScore, result.calm.roadClassScore);
        assert.equal(result.calm.greenPct, null);
      }
    );
  } finally {
    delete global.GreenScore;
  }
});

test("scoreRoadClassBreakdown: real coordinates weight segments by actual meters, not point-index span — a short-but-many-points segment no longer outweighs a long-but-few-points one", () => {
  // Segment A (path, index 0-4): 4 tightly-packed points spanning ~4m total (winding alley).
  // Segment B (motorway, index 4-6): 2 points spanning ~400m (long straight arterial).
  // Old index-span math: A gets weight 4, B gets weight 2 -> A dominates despite covering far less ground.
  // Real-distance math: A gets ~4m, B gets ~400m -> B should dominate the average instead.
  const coords = [
    [4.9000, 52.3700], [4.9000, 52.37001], [4.9000, 52.37002], [4.9000, 52.37003], [4.9000, 52.37004],
    [4.9060, 52.3700],
  ];
  const detail = [[0, 4, "path"], [4, 5, "motorway"]];
  const withCoords = scoreRoadClassBreakdown(detail, false, false, coords);
  const withoutCoords = scoreRoadClassBreakdown(detail, false, false);
  assert.ok(withCoords.score < 0, `real-distance score should be dominated by the long motorway leg (near ${CALM_SCORE.motorway}), got ${withCoords.score}`);
  assert.ok(withoutCoords.score > 5, `index-span score should be dominated by the short-but-many-point path segments (near ${CALM_SCORE.path}), got ${withoutCoords.score}`);
});
