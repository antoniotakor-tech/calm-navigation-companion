import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "./index.js";
import { createFakeDb } from "./_testdb.mjs";

const VALID_BODY = {
  lat: 52.3676, lon: 4.9041, durationMs: 5000,
  melody: [{ t: 0, tine: 0, v: 0.5 }],
  message: "Take a deep breath.", nickname: "Wanderer",
  creatorToken: "a-real-device-token-value",
};

test("no DB binding configured: 501, no query attempted", async () => {
  const resp = await onRequestPost({ request: { json: async () => VALID_BODY }, env: {} });
  assert.equal(resp.status, 501);
});

test("invalid payload (bad coordinates): 400, never reaches the database", async () => {
  const db = createFakeDb();
  const resp = await onRequestPost({ request: { json: async () => ({ ...VALID_BODY, lat: 999 }) }, env: { DB: db } });
  assert.equal(resp.status, 400);
  assert.equal(db.calls.length, 0);
});

test("happy path: inserts a fuzzed location and returns 201 with an id", async () => {
  const db = createFakeDb([
    { match: /SELECT COUNT/, first: () => ({ c: 0 }) },
    { match: /INSERT INTO echoes/, run: () => ({ success: true }) },
  ]);
  const resp = await onRequestPost({ request: { json: async () => VALID_BODY }, env: { DB: db } });
  assert.equal(resp.status, 201);
  const body = await resp.json();
  assert.equal(typeof body.id, "string");
  // Fuzzing (10-20m) must have actually moved the stored point off the raw input.
  assert.notEqual(body.lat, VALID_BODY.lat);

  const insertCall = db.calls.find((c) => /INSERT INTO echoes/.test(c.sql));
  assert.ok(insertCall, "expected an INSERT INTO echoes call");
  // args: [id, lat, lon, created_at, message, nickname, melody_json, duration_ms, creator_token_hash]
  assert.notEqual(insertCall.args[8], VALID_BODY.creatorToken, "the raw creatorToken must never be stored");
  assert.match(insertCall.args[8], /^[0-9a-f]{64}$/, "only the sha-256 hash should be stored");
});

test("rate limit: 5 Echoes already in the last 24h -> 429, no insert attempted", async () => {
  const db = createFakeDb([{ match: /SELECT COUNT/, first: () => ({ c: 5 }) }]);
  const resp = await onRequestPost({ request: { json: async () => VALID_BODY }, env: { DB: db } });
  assert.equal(resp.status, 429);
  assert.equal(db.calls.some((c) => /INSERT/.test(c.sql)), false);
});

test("malformed JSON body: 400, not a 500", async () => {
  const db = createFakeDb();
  const resp = await onRequestPost({ request: { json: async () => { throw new Error("bad json"); } }, env: { DB: db } });
  assert.equal(resp.status, 400);
});
