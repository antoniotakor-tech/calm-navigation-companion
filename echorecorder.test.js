const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("./echorecorder.js");

test("isDurationValid: accepts the 2s-20s window, rejects outside it", () => {
  assert.equal(R.isDurationValid(2000), true);
  assert.equal(R.isDurationValid(20000), true);
  assert.equal(R.isDurationValid(10000), true);
  assert.equal(R.isDurationValid(1999), false);
  assert.equal(R.isDurationValid(20001), false);
  assert.equal(R.isDurationValid(0), false);
});

test("clampElapsed: never returns more than the max recording length, or less than zero", () => {
  assert.equal(R.clampElapsed(5000), 5000);
  assert.equal(R.clampElapsed(25000), R.MAX_DURATION_MS);
  assert.equal(R.clampElapsed(-500), 0);
});

test("validateMessage: empty/whitespace-only input is valid and normalizes to null (a supported 'no message' Echo)", () => {
  assert.deepEqual(R.validateMessage(null), { valid: true, value: null });
  assert.deepEqual(R.validateMessage("   "), { valid: true, value: null });
  assert.deepEqual(R.validateMessage(""), { valid: true, value: null });
});

test("validateMessage: trims surrounding whitespace on an otherwise valid message", () => {
  const r = R.validateMessage("  Take a deep breath.  ");
  assert.equal(r.valid, true);
  assert.equal(r.value, "Take a deep breath.");
});

test("validateMessage: rejects anything over the 100-character cap", () => {
  const r = R.validateMessage("x".repeat(101));
  assert.equal(r.valid, false);
  assert.equal(r.value, null);
});

test("validateMessage: exactly 100 characters is still valid (boundary, not off-by-one)", () => {
  const r = R.validateMessage("x".repeat(100));
  assert.equal(r.valid, true);
});

test("validateNickname: rejects over 24 characters, accepts empty as anonymous", () => {
  assert.equal(R.validateNickname("x".repeat(25)).valid, false);
  assert.deepEqual(R.validateNickname(""), { valid: true, value: null });
  assert.equal(R.validateNickname("Wanderer").value, "Wanderer");
});

test("quantizeEvent: rounds timing to the millisecond and velocity to two decimals", () => {
  assert.deepEqual(R.quantizeEvent({ t: 123.456, tine: 4, v: 0.71234 }), { t: 123, tine: 4, v: 0.71 });
});

test("buildMelodyPayload: shape matches migrations/0001_create_echoes.sql's melody_json column", () => {
  const payload = R.buildMelodyPayload([{ t: 0, tine: 5, v: 0.7 }, { t: 500.4, tine: 6, v: 0.6 }], 2000.6);
  assert.deepEqual(payload, { melody: [{ t: 0, tine: 5, v: 0.7 }, { t: 500, tine: 6, v: 0.6 }], durationMs: 2001 });
});

test("applyRecorderAction: idle -> recording -> recorded happy path", () => {
  let state = R.initialRecorderState();
  assert.equal(state.phase, "idle");

  state = R.applyRecorderAction(state, { type: "recordStart", atMs: 1000 });
  assert.equal(state.phase, "recording");

  state = R.applyRecorderAction(state, { type: "pluck", tine: 3, v: 0.7, atMs: 1500 });
  state = R.applyRecorderAction(state, { type: "pluck", tine: 5, v: 0.8, atMs: 2200 });
  assert.equal(state.events.length, 2);
  assert.equal(state.events[0].t, 500);
  assert.equal(state.events[1].t, 1200);

  state = R.applyRecorderAction(state, { type: "stop", atMs: 4000 });
  assert.equal(state.phase, "recorded");
  assert.equal(state.durationMs, 3000);
  assert.equal(R.canSave(state), true);
});

test("applyRecorderAction: stopping before the 2s minimum lands in 'tooShort', which cannot be saved", () => {
  let state = R.initialRecorderState();
  state = R.applyRecorderAction(state, { type: "recordStart", atMs: 0 });
  state = R.applyRecorderAction(state, { type: "pluck", tine: 0, v: 0.7, atMs: 500 });
  state = R.applyRecorderAction(state, { type: "stop", atMs: 1200 });
  assert.equal(state.phase, "tooShort");
  assert.equal(R.canSave(state), false);
});

test("applyRecorderAction: a pluck that reaches the 20s cap auto-stops into 'recorded' without waiting for an explicit stop", () => {
  let state = R.initialRecorderState();
  state = R.applyRecorderAction(state, { type: "recordStart", atMs: 0 });
  state = R.applyRecorderAction(state, { type: "pluck", tine: 2, v: 0.6, atMs: 25000 });
  assert.equal(state.phase, "recorded");
  assert.equal(state.durationMs, R.MAX_DURATION_MS);
});

test("applyRecorderAction: pluck events outside 'recording' (e.g. a late/stray event after stop) are ignored, not appended", () => {
  let state = R.initialRecorderState();
  state = R.applyRecorderAction(state, { type: "recordStart", atMs: 0 });
  state = R.applyRecorderAction(state, { type: "stop", atMs: 3000 });
  const before = state;
  state = R.applyRecorderAction(state, { type: "pluck", tine: 1, v: 0.5, atMs: 3500 });
  assert.deepEqual(state, before);
});

test("applyRecorderAction: redo and cancel both return cleanly to a blank idle state", () => {
  let state = R.initialRecorderState();
  state = R.applyRecorderAction(state, { type: "recordStart", atMs: 0 });
  state = R.applyRecorderAction(state, { type: "pluck", tine: 1, v: 0.5, atMs: 500 });
  state = R.applyRecorderAction(state, { type: "stop", atMs: 3000 });

  const redone = R.applyRecorderAction(state, { type: "redo" });
  assert.deepEqual(redone, R.initialRecorderState());

  const cancelled = R.applyRecorderAction(state, { type: "cancel" });
  assert.deepEqual(cancelled, R.initialRecorderState());
});

test("applyRecorderAction: playStart/playEnd only apply from 'recorded', and don't mutate the captured events", () => {
  let state = R.initialRecorderState();
  state = R.applyRecorderAction(state, { type: "recordStart", atMs: 0 });
  state = R.applyRecorderAction(state, { type: "pluck", tine: 1, v: 0.5, atMs: 500 });
  state = R.applyRecorderAction(state, { type: "stop", atMs: 3000 });

  const playing = R.applyRecorderAction(state, { type: "playStart" });
  assert.equal(playing.isPlaying, true);
  assert.deepEqual(playing.events, state.events);

  const doneIdle = R.applyRecorderAction(R.initialRecorderState(), { type: "playStart" });
  assert.equal(doneIdle.phase, "idle");
  assert.equal(doneIdle.isPlaying, false);
});

test("canSave: false for idle/tooShort/empty-events states, true only for a valid recorded melody", () => {
  assert.equal(R.canSave(R.initialRecorderState()), false);
  assert.equal(R.canSave({ phase: "tooShort", events: [{ t: 0, tine: 1, v: 0.5 }], durationMs: 1000 }), false);
  assert.equal(R.canSave({ phase: "recorded", events: [], durationMs: 3000 }), false);
  assert.equal(R.canSave({ phase: "recorded", events: [{ t: 0, tine: 1, v: 0.5 }], durationMs: 3000 }), true);
});

test("applyRecorderAction: overdubStart keeps layer 1's events and duration, and records layer 2 on the shared t=0 timeline", () => {
  let state = R.initialRecorderState();
  state = R.applyRecorderAction(state, { type: "recordStart", atMs: 0 });
  state = R.applyRecorderAction(state, { type: "pluck", tine: 2, v: 0.6, atMs: 1000 });
  state = R.applyRecorderAction(state, { type: "stop", atMs: 5000 });
  assert.equal(state.phase, "recorded");
  assert.equal(state.layers, 1);

  // Overdub starts at wall-clock 60s — but its plucks land relative to the
  // overdub's own start, i.e. on the same t=0 timeline as layer 1.
  state = R.applyRecorderAction(state, { type: "overdubStart", atMs: 60000 });
  assert.equal(state.phase, "recording");
  assert.equal(state.events.length, 1, "layer 1's events must be carried into the overdub");
  state = R.applyRecorderAction(state, { type: "pluck", tine: 9, v: 0.8, atMs: 60500 });
  state = R.applyRecorderAction(state, { type: "stop", atMs: 63000 });

  assert.equal(state.phase, "recorded");
  assert.equal(state.layers, 2);
  assert.equal(state.events.length, 2);
  assert.equal(state.events[1].t, 500, "layer-2 pluck timing is relative to the overdub start, not wall clock");
  assert.equal(state.durationMs, 5000, "a shorter overlay never shrinks the melody below layer 1's duration");
});

test("applyRecorderAction: overdubStart is ignored outside 'recorded' (idle, tooShort, mid-recording)", () => {
  const idle = R.initialRecorderState();
  assert.equal(R.applyRecorderAction(idle, { type: "overdubStart", atMs: 0 }).phase, "idle");
  let rec = R.applyRecorderAction(idle, { type: "recordStart", atMs: 0 });
  assert.equal(R.applyRecorderAction(rec, { type: "overdubStart", atMs: 100 }), rec);
});

test("applyRecorderAction: an overlay longer than layer 1 extends the melody's duration", () => {
  let state = R.initialRecorderState();
  state = R.applyRecorderAction(state, { type: "recordStart", atMs: 0 });
  state = R.applyRecorderAction(state, { type: "pluck", tine: 0, v: 0.5, atMs: 100 });
  state = R.applyRecorderAction(state, { type: "stop", atMs: 3000 });
  state = R.applyRecorderAction(state, { type: "overdubStart", atMs: 10000 });
  state = R.applyRecorderAction(state, { type: "pluck", tine: 14, v: 0.5, atMs: 17000 });
  state = R.applyRecorderAction(state, { type: "stop", atMs: 18000 });
  assert.equal(state.durationMs, 8000);
  assert.equal(state.events[1].t, 7000);
});

test("applyRecorderAction: recordStart after an overdubbed take wipes everything back to a fresh single-layer recording", () => {
  let state = R.initialRecorderState();
  state = R.applyRecorderAction(state, { type: "recordStart", atMs: 0 });
  state = R.applyRecorderAction(state, { type: "pluck", tine: 1, v: 0.5, atMs: 200 });
  state = R.applyRecorderAction(state, { type: "stop", atMs: 3000 });
  state = R.applyRecorderAction(state, { type: "overdubStart", atMs: 5000 });
  state = R.applyRecorderAction(state, { type: "stop", atMs: 9000 });
  state = R.applyRecorderAction(state, { type: "recordStart", atMs: 20000 });
  assert.equal(state.events.length, 0);
  assert.equal(state.layers, 0);
});
