const test = require("node:test");
const assert = require("node:assert/strict");
const FlowTheme = require("./flowtheme.js");

test("isValidTheme: only light/dark/flow are valid", () => {
  assert.equal(FlowTheme.isValidTheme("light"), true);
  assert.equal(FlowTheme.isValidTheme("dark"), true);
  assert.equal(FlowTheme.isValidTheme("flow"), true);
  assert.equal(FlowTheme.isValidTheme("neon"), false);
  assert.equal(FlowTheme.isValidTheme(null), false);
  assert.equal(FlowTheme.isValidTheme(undefined), false);
});

test("FLOW_PALETTE: 7 calming colors, all valid hex, no obvious neon duplicates", () => {
  assert.equal(FlowTheme.FLOW_PALETTE.length, 7);
  FlowTheme.FLOW_PALETTE.forEach((c) => {
    assert.match(c.hex, /^#[0-9A-Fa-f]{6}$/);
    assert.ok(c.name.length > 0);
  });
  const hexes = FlowTheme.FLOW_PALETTE.map((c) => c.hex);
  assert.equal(new Set(hexes).size, hexes.length, "every palette color should be distinct");
});

test("paletteColorForTine: in-range tines map to distinct palette entries, cycling every 7", () => {
  assert.equal(FlowTheme.paletteColorForTine(0), FlowTheme.FLOW_PALETTE[0].hex);
  assert.equal(FlowTheme.paletteColorForTine(6), FlowTheme.FLOW_PALETTE[6].hex);
  assert.equal(FlowTheme.paletteColorForTine(7), FlowTheme.FLOW_PALETTE[0].hex, "should wrap, not throw or go undefined");
  assert.equal(FlowTheme.paletteColorForTine(10), FlowTheme.FLOW_PALETTE[3].hex);
});

test("paletteColorForTine: invalid input falls back to the first palette color rather than crashing", () => {
  assert.equal(FlowTheme.paletteColorForTine(-1), FlowTheme.FLOW_PALETTE[0].hex);
  assert.equal(FlowTheme.paletteColorForTine(1.5), FlowTheme.FLOW_PALETTE[0].hex);
  assert.equal(FlowTheme.paletteColorForTine(null), FlowTheme.FLOW_PALETTE[0].hex);
  assert.equal(FlowTheme.paletteColorForTine(undefined), FlowTheme.FLOW_PALETTE[0].hex);
});

test("TIMING: background layer durations are distinct and none are near-instant or absurdly long", () => {
  const durations = FlowTheme.TIMING.backgroundLayerDurationsSec;
  assert.ok(durations.length >= 3, "needs several layers for a non-repetitive combined pattern");
  assert.equal(new Set(durations).size, durations.length, "duplicate periods would resync visibly");
  durations.forEach((d) => assert.ok(d >= 20 && d <= 180, `expected a slow, calm period, got ${d}s`));
});

test("shouldAnimateFlowDecor: true only when reduced motion, battery saver, and backgrounded are all false/absent", () => {
  assert.equal(FlowTheme.shouldAnimateFlowDecor(), true);
  assert.equal(FlowTheme.shouldAnimateFlowDecor({}), true);
  assert.equal(FlowTheme.shouldAnimateFlowDecor({ reducedMotion: true }), false);
  assert.equal(FlowTheme.shouldAnimateFlowDecor({ batterySaver: true }), false);
  assert.equal(FlowTheme.shouldAnimateFlowDecor({ backgrounded: true }), false);
  assert.equal(FlowTheme.shouldAnimateFlowDecor({ reducedMotion: false, batterySaver: false, backgrounded: false }), true);
});

test("nextTheme: cycles Light -> Dark -> Flow -> Bloom -> Light", () => {
  assert.equal(FlowTheme.nextTheme("light"), "dark");
  assert.equal(FlowTheme.nextTheme("dark"), "flow");
  assert.equal(FlowTheme.nextTheme("flow"), "bloom");
  assert.equal(FlowTheme.nextTheme("bloom"), "light");
});

test("nextTheme: an unrecognized current theme safely restarts the cycle rather than throwing", () => {
  assert.equal(FlowTheme.nextTheme("something-invalid"), "light");
});

test("isFlowActive: true only for the literal string 'flow'", () => {
  assert.equal(FlowTheme.isFlowActive("flow"), true);
  assert.equal(FlowTheme.isFlowActive("dark"), false);
  assert.equal(FlowTheme.isFlowActive("light"), false);
  assert.equal(FlowTheme.isFlowActive(undefined), false);
});

test("usesDarkMapTiles: true for dark and flow, false for light", () => {
  assert.equal(FlowTheme.usesDarkMapTiles("dark"), true);
  assert.equal(FlowTheme.usesDarkMapTiles("flow"), true);
  assert.equal(FlowTheme.usesDarkMapTiles("light"), false);
  assert.equal(FlowTheme.usesDarkMapTiles("bloom"), false, "Bloom is a bright, colourful daytime theme");
});
