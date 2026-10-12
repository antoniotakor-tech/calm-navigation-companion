const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("./voicefx.js");

test("WAV export has a valid header and the right length", () => {
  const samples = [new Float32Array([0, 0.5, -0.5, 1]), new Float32Array([0, -1, 0.25, 0])];
  const buf = { numberOfChannels: 2, length: 4, sampleRate: 44100, getChannelData: (c) => samples[c] };
  const v = new DataView(F.encodeWav(buf));
  const tag = (o) => String.fromCharCode(...[0, 1, 2, 3].map((i) => v.getUint8(o + i)));
  assert.equal(tag(0), "RIFF"); assert.equal(tag(8), "WAVE"); assert.equal(tag(36), "data");
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(24, true), 44100);
  assert.equal(v.byteLength, 44 + 4 * 2 * 2);
  assert.equal(v.getInt16(44 + 2 * 3, true), -32768, "full-scale negative sample");
});

test("pitch effects are flagged as not staying in time with the beat", () => {
  assert.equal(F.keepsTime("studio"), true);
  assert.equal(F.keepsTime("chipmunk"), false);
  assert.ok(F.rateFor("deep") < 1 && F.rateFor("chipmunk") > 1);
  assert.ok(F.EFFECTS.some((e) => e.id === "choir"));
});
