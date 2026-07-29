const test = require("node:test");
const assert = require("node:assert/strict");
const { createRerouteBackoff } = require("./rerouteBackoff.js");

test("shouldAttempt: true until maxAttempts is reached", () => {
  const b = createRerouteBackoff({ maxAttempts: 2 });
  assert.equal(b.shouldAttempt(), true);
  b.recordAttempt();
  assert.equal(b.shouldAttempt(), true);
  b.recordAttempt();
  assert.equal(b.shouldAttempt(), false);
});

test("nextDelayMs: doubles each attempt, starting from baseDelayMs, capped at maxDelayMs", () => {
  const b = createRerouteBackoff({ baseDelayMs: 1000, maxDelayMs: 5000 });
  assert.equal(b.nextDelayMs(), 1000);
  b.recordAttempt();
  assert.equal(b.nextDelayMs(), 2000);
  b.recordAttempt();
  assert.equal(b.nextDelayMs(), 4000);
  b.recordAttempt();
  assert.equal(b.nextDelayMs(), 5000, "should cap rather than keep doubling past maxDelayMs");
});

test("recordSuccess: resets the attempt counter (repeated FAILURES are guarded against, not repeated legitimate reroutes)", () => {
  const b = createRerouteBackoff({ maxAttempts: 3 });
  b.recordAttempt();
  b.recordAttempt();
  assert.equal(b.attempts, 2);
  b.recordSuccess();
  assert.equal(b.attempts, 0);
  assert.equal(b.shouldAttempt(), true);
});

test("isExhausted: true once attempts reaches maxAttempts", () => {
  const b = createRerouteBackoff({ maxAttempts: 1 });
  assert.equal(b.isExhausted(), false);
  b.recordAttempt();
  assert.equal(b.isExhausted(), true);
});

test("reset: same effect as recordSuccess, for callers that aren't reporting a successful route fetch", () => {
  const b = createRerouteBackoff({ maxAttempts: 2 });
  b.recordAttempt();
  b.reset();
  assert.equal(b.attempts, 0);
});

test("uses sane defaults when no options are given at all", () => {
  const b = createRerouteBackoff();
  assert.equal(b.shouldAttempt(), true);
  assert.ok(b.nextDelayMs() > 0);
  assert.ok(b.maxAttempts > 0);
});
