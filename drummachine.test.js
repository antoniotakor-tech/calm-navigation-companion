const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("./drummachine.js");

test("every preset has 16 steps for every track and a tempo in range", () => {
  Object.keys(D.PRESETS).forEach((name) => {
    const p = D.fromPreset(name);
    D.TRACKS.forEach((t) => assert.equal(p.rows[t.id].length, D.STEPS, `${name}/${t.id}`));
    assert.ok(p.bpm >= D.MIN_BPM && p.bpm <= D.MAX_BPM);
  });
});

test("toggling a step doesn't change the original pattern", () => {
  const a = D.emptyPattern();
  const b = D.toggle(a, "kick", 0);
  assert.equal(a.rows.kick[0], false);
  assert.equal(b.rows.kick[0], true);
  assert.deepEqual(D.hitsAt(b, 0), ["kick"]);
  assert.deepEqual(D.hitsAt(b, 16), ["kick"], "wraps around the bar");
});

test("tempo is clamped and step length follows it", () => {
  assert.equal(D.clampBpm(500), D.MAX_BPM);
  assert.equal(D.clampBpm("abc"), D.DEFAULT_BPM);
  assert.equal(D.stepSeconds(120), 0.125);
});

test("save/restore round-trips and bad data is rejected", () => {
  const p = D.toggle(D.fromPreset("walk"), "tom", 3);
  const back = D.deserialize(D.serialize(p));
  assert.deepEqual(back.rows, p.rows);
  assert.equal(back.bpm, p.bpm);
  assert.equal(D.deserialize("not json"), null);
  assert.equal(D.deserialize('{"v":9}'), null);
});
