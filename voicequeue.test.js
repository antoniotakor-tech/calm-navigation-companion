const test = require("node:test");
const assert = require("node:assert/strict");
const VoiceQueue = require("./voicequeue.js");

function fakeSpeak(log, delayMs) {
  return (text) => new Promise((resolve) => {
    log.push(`start:${text}`);
    setTimeout(() => { log.push(`end:${text}`); resolve(); }, delayMs || 0);
  });
}

test("speaks items in FIFO order, never starting the next before the current resolves", async () => {
  const log = [];
  const q = new VoiceQueue(fakeSpeak(log, 10));
  q.enqueue("first");
  q.enqueue("second");
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(log, ["start:first", "end:first", "start:second", "end:second"]);
});

test("urgent items clear whatever was queued behind the current utterance", async () => {
  const log = [];
  const q = new VoiceQueue(fakeSpeak(log, 10));
  q.enqueue("first");
  q.enqueue("second-should-be-dropped");
  q.enqueue("urgent-one", { urgent: true });
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(!log.includes("start:second-should-be-dropped"));
  assert.ok(log.includes("start:urgent-one"));
});

test("urgent still waits politely for whatever is CURRENTLY speaking to finish — never interrupts itself", async () => {
  const log = [];
  const q = new VoiceQueue(fakeSpeak(log, 20));
  q.enqueue("currently-speaking");
  await new Promise((r) => setTimeout(r, 5));
  q.enqueue("urgent-one", { urgent: true });
  await new Promise((r) => setTimeout(r, 40));
  const startIdx = log.indexOf("start:urgent-one");
  const endIdx = log.indexOf("end:currently-speaking");
  assert.ok(endIdx < startIdx, "the urgent item must not start until the current utterance actually ends");
});

test("onSpeakStart/onSpeakEnd hooks fire around each utterance (this is what drives ducking)", async () => {
  const events = [];
  const q = new VoiceQueue(fakeSpeak([], 5), {
    onSpeakStart: (t) => events.push(`hookStart:${t}`),
    onSpeakEnd: (t) => events.push(`hookEnd:${t}`),
  });
  q.enqueue("hello");
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(events, ["hookStart:hello", "hookEnd:hello"]);
});

test("a synchronous (non-promise) speakFn still advances the queue", () => {
  const log = [];
  const q = new VoiceQueue((text) => { log.push(text); });
  q.enqueue("a");
  q.enqueue("b");
  assert.deepEqual(log, ["a", "b"]);
});

test("isSpeaking reflects whether an utterance is currently in flight", async () => {
  const q = new VoiceQueue(fakeSpeak([], 15));
  assert.equal(q.isSpeaking(), false);
  q.enqueue("hi");
  assert.equal(q.isSpeaking(), true);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(q.isSpeaking(), false);
});

test("a speakFn that throws synchronously still advances the queue instead of getting stuck", () => {
  const log = [];
  const q = new VoiceQueue((text) => {
    if (text === "boom") throw new Error("synth failed");
    log.push(text);
  });
  q.enqueue("boom");
  q.enqueue("after");
  assert.deepEqual(log, ["after"]);
});

test("clear() empties pending items without affecting whatever is already speaking", async () => {
  const log = [];
  const q = new VoiceQueue(fakeSpeak(log, 15));
  q.enqueue("speaking-now");
  q.enqueue("queued-and-should-be-cleared");
  q.clear();
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(log.includes("start:speaking-now"));
  assert.ok(!log.includes("start:queued-and-should-be-cleared"));
});
