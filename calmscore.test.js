const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("./calmscore.js");

// a straight 1 km line of 11 points
const line = Array.from({ length: 11 }, (_, i) => [4.9 + i * 0.00147, 52.37]);
const route = (details, extra) => ({ coordinates: line, details, steps: [{ sign: 0 }], ...extra });
const all = (v) => [[0, 10, v]];

test("weights live in one place and sum to 1 (also in safety mode)", () => {
  const sum = (w) => Object.values(w).reduce((a, b) => a + b, 0);
  assert.equal(Math.round(sum(C.CALM_WEIGHTS) * 100), 100);
  assert.equal(Math.round(sum(C.weightsFor(true)) * 100), 100);
  assert.ok(C.weightsFor(true).noise < C.weightsFor(false).noise, "safety lowers the noise weight");
  assert.ok(C.weightsFor(true).isolation > 0 && C.weightsFor(false).isolation === 0);
});

test("a footpath scores calmer than a main road", () => {
  const foot = C.scoreRoute(route({ road_class: all("footway"), surface: all("paved") }));
  const main = C.scoreRoute(route({ road_class: all("primary"), surface: all("asphalt"), max_speed: all(50), lanes: all(4) }));
  assert.ok(foot.score > 7 && main.score < 4, `${foot.score} vs ${main.score}`);
  assert.ok(foot.score <= 10 && main.score >= 0);
});

test("traffic lights lower the intersections factor", () => {
  const quiet = C.scoreRoute(route({ road_class: all("residential"), crossing: [] }));
  const lights = C.scoreRoute(route({ road_class: all("residential"), crossing: [[2, 3, "traffic_signals"], [5, 6, "traffic_signals"], [8, 9, "traffic_signals"]] }));
  assert.ok(lights.factors.intersections < quiet.factors.intersections);
});

test("missing data is excluded and reweighted, never defaulted — and reported", () => {
  const r = C.scoreRoute(route({ road_class: [[0, 5, "footway"], [5, 10, "missing"]], surface: all("paved") }));
  assert.equal(r.dataGaps.crowd, 50, "crowd unknown on the second half");
  assert.ok(r.score > 7, "the unknown half doesn't drag the score to the worst case");
  const nothing = C.scoreRoute(route({}, { steps: [] }));
  assert.equal(nothing.score, null, "no data at all → no score, not a fake one");
});

test("safety mode lowers empty paths relative to residential streets", () => {
  const path = route({ road_class: all("path") }), street = route({ road_class: all("residential") });
  const calmGap = C.scoreRoute(path).score - C.scoreRoute(street).score;
  const safeGap = C.scoreRoute(path, { safetyMode: true }).score - C.scoreRoute(street, { safetyMode: true }).score;
  assert.ok(safeGap < calmGap);
});

test("green space nudges the sensory factor up", () => {
  const plain = C.scoreRoute(route({ road_class: all("residential") }));
  const green = C.scoreRoute(route({ road_class: all("residential") }, { greenPct: 60 }));
  assert.ok(green.factors.sensory > plain.factors.sensory);
});
