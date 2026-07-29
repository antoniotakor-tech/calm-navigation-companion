const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("./audioregulation.js");

test("isValidMode: only relax/concentrate are valid", () => {
  assert.equal(A.isValidMode("relax"), true);
  assert.equal(A.isValidMode("concentrate"), true);
  assert.equal(A.isValidMode("bogus"), false);
});

test("computeDuckParams: concentrate ducks faster and deeper than relax", () => {
  const concentrate = A.computeDuckParams("concentrate", false);
  const relax = A.computeDuckParams("relax", false);
  assert.ok(concentrate.downMs < relax.downMs, "concentrate should duck in faster");
  assert.ok(concentrate.mult < relax.mult, "concentrate should duck deeper (lower multiplier)");
});

test("computeDuckParams: night mode slows transitions further, on top of the mode's own base timing", () => {
  const relaxDay = A.computeDuckParams("relax", false);
  const relaxNight = A.computeDuckParams("relax", true);
  assert.ok(relaxNight.downMs > relaxDay.downMs);
  assert.ok(relaxNight.restoreMs > relaxDay.restoreMs);
});

test("computeEffectsScale: concentrate is louder than relax; night mode caps both further", () => {
  const concentrateDay = A.computeEffectsScale("concentrate", false);
  const relaxDay = A.computeEffectsScale("relax", false);
  assert.ok(concentrateDay > relaxDay);
  assert.ok(A.computeEffectsScale("concentrate", true) < concentrateDay, "night mode must reduce effects volume even in concentrate");
});

test("computeCrossfadeMs: relax fades slower than concentrate; night mode slows both further", () => {
  const relax = A.computeCrossfadeMs("relax", false);
  const concentrate = A.computeCrossfadeMs("concentrate", false);
  assert.ok(relax > concentrate);
  assert.ok(A.computeCrossfadeMs("relax", true) > relax);
});

test("shouldSkipFarAnnouncement: true only for relax (fewer spoken interruptions)", () => {
  assert.equal(A.shouldSkipFarAnnouncement("relax"), true);
  assert.equal(A.shouldSkipFarAnnouncement("concentrate"), false);
});

test("computeSpeechRate: concentrate speaks faster/crisper than relax", () => {
  assert.ok(A.computeSpeechRate("concentrate") > A.computeSpeechRate("relax"));
});

test("SOUNDSCAPE_LABELS: has a label for every soundscape key prefs.js knows about, including 'off'", () => {
  const Prefs = require("./prefs.js");
  Prefs.VALID_SOUNDSCAPES.forEach((key) => {
    assert.ok(A.SOUNDSCAPE_LABELS[key], `missing a label for soundscape key "${key}"`);
  });
});
