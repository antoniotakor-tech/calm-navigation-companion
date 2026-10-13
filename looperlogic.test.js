const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("./looperlogic.js");

const k = (p, tine = 5) => ({ t: "k", p, tine, v: 0.7, key: "C" });
const ch = (p, d = 6, len = 4) => ({ t: "c", p, d, len, s: "keys", key: "C" });

test("a loop is 2 bars of 16ths, and its length follows the tempo", () => {
  assert.equal(L.LOOP_STEPS, 32);
  assert.equal(L.loopSeconds(120), 4);   // 2 bars of 4/4 at 120 bpm
  assert.equal(L.loopSeconds(60), 8);
});

test("positions wrap around the loop", () => {
  const step = 0.125;
  assert.equal(L.posInLoop(10, 10, step), 0);
  assert.equal(L.posInLoop(10 + 5 * step, 10, step), 5);
  assert.equal(L.posInLoop(10 + 33 * step, 10, step), 1);      // second pass
  assert.equal(L.posInLoop(10 - step, 10, step), 31);          // just before the start
});

test("quantize snaps to the grid and wraps the end back to 0", () => {
  assert.equal(L.quantize(3.9, 1), 4);
  assert.equal(L.quantize(31.8, 1), 0);
  assert.equal(L.quantize(2.2, 0.5), 2);
});

test("a pass with nothing played makes no layer; names follow what was played", () => {
  assert.equal(L.makeLayer([], 1), null);
  assert.equal(L.makeLayer([k(1)], 1).name, "Kalimba");
  assert.equal(L.makeLayer([ch(0)], 2).name, "Chords");
  assert.equal(L.makeLayer([ch(0), k(3)], 3).name, "Chords + kalimba");
});

test("malformed notes are dropped and notes are sorted by position", () => {
  const layer = L.makeLayer([k(9), { t: "k", p: 40, tine: 1, v: 1, key: "C" }, { t: "x" }, k(2, 99), ch(1, 12), k(4)], "a");
  assert.deepEqual(layer.events.map((e) => e.p), [4, 9]);
});

test("eventsInStep returns notes in that step with their offset, skipping muted layers", () => {
  let layers = L.addLayer([], L.makeLayer([k(4.5), k(10)], "a"));
  layers = L.addLayer(layers, L.makeLayer([ch(4)], "b"));
  const at4 = L.eventsInStep(layers, 4);
  assert.equal(at4.length, 2);
  assert.ok(at4.some((x) => x.offset === 0.5 && x.e.t === "k"));
  layers = L.toggleMute(layers, "b");
  assert.equal(L.eventsInStep(layers, 4).length, 1);
});

test("layers can be removed, and at most MAX_LAYERS are kept", () => {
  let layers = [];
  for (let i = 0; i < L.MAX_LAYERS + 3; i++) layers = L.addLayer(layers, L.makeLayer([k(i % 32)], i));
  assert.equal(layers.length, L.MAX_LAYERS);
  assert.equal(layers[0].id, "3");
  layers = L.removeLayer(layers, "5");
  assert.ok(!layers.some((l) => l.id === "5"));
});

test("save and restore round-trips; garbage restores to an empty list", () => {
  const layers = L.toggleMute(L.addLayer([], L.makeLayer([ch(0), k(8)], "x")), "x");
  const back = L.deserialize(L.serialize(layers));
  assert.equal(back.length, 1);
  assert.equal(back[0].muted, true);
  assert.equal(back[0].events.length, 2);
  assert.deepEqual(L.deserialize("{nope"), []);
  assert.deepEqual(L.deserialize(JSON.stringify({ v: 2, layers: [] })), []);
});
