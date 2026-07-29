import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "./[id]/play.js";
import { createFakeDb } from "./_testdb.mjs";
import EchoValidation from "../../../echovalidation.js";

const SAMPLE_ROW = {
  message: "This park always makes me smile.",
  melody_json: JSON.stringify([{ t: 0, tine: 0, v: 0.5 }, { t: 1200, tine: 5, v: 0.8 }]),
  duration_ms: 4000,
  moderation_status: "visible",
};

function ctx(id, body, db) {
  return { params: { id }, request: { json: async () => body }, env: { DB: db } };
}

test("no DB binding configured: 501", async () => {
  const resp = await onRequestPost({ params: { id: "abc" }, request: { json: async () => ({}) }, env: {} });
  assert.equal(resp.status, 501);
});

test("echo not found (or hidden by moderation): 404", async () => {
  const db = createFakeDb([{ match: /SELECT message, melody_json/, first: () => null }]);
  const resp = await onRequestPost(ctx("missing", {}, db));
  assert.equal(resp.status, 404);
});

test("happy path: returns the melody/duration/message, increments play_count, no listenerToken means no notification", async () => {
  const creatorHash = await EchoValidation.hashCreatorToken("creator-token");
  const db = createFakeDb([
    { match: /SELECT message, melody_json/, first: () => ({ ...SAMPLE_ROW, creator_token_hash: creatorHash }) },
    { match: /UPDATE echoes SET play_count/, run: () => ({ success: true }) },
  ]);
  const resp = await onRequestPost(ctx("echo-1", {}, db));
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.deepEqual(body.melody, JSON.parse(SAMPLE_ROW.melody_json));
  assert.equal(body.durationMs, 4000);
  assert.equal(body.message, SAMPLE_ROW.message);
  assert.equal(db.calls.some((c) => /UPDATE echoes SET play_count/.test(c.sql)), true);
  assert.equal(db.calls.some((c) => /INSERT INTO echo_notifications/.test(c.sql)), false);
});

test("a listener who is NOT the creator triggers a discovery notification", async () => {
  const creatorHash = await EchoValidation.hashCreatorToken("creator-token");
  const db = createFakeDb([
    { match: /SELECT message, melody_json/, first: () => ({ ...SAMPLE_ROW, creator_token_hash: creatorHash }) },
    { match: /UPDATE echoes SET play_count/, run: () => ({ success: true }) },
    { match: /INSERT INTO echo_notifications/, run: () => ({ success: true }) },
  ]);
  const resp = await onRequestPost(ctx("echo-1", { listenerToken: "a-different-listener-token" }, db));
  assert.equal(resp.status, 200);
  assert.equal(db.calls.some((c) => /INSERT INTO echo_notifications/.test(c.sql)), true);
});

test("the creator replaying their OWN Echo does not notify themself", async () => {
  const creatorHash = await EchoValidation.hashCreatorToken("creator-token");
  const db = createFakeDb([
    { match: /SELECT message, melody_json/, first: () => ({ ...SAMPLE_ROW, creator_token_hash: creatorHash }) },
    { match: /UPDATE echoes SET play_count/, run: () => ({ success: true }) },
  ]);
  const resp = await onRequestPost(ctx("echo-1", { listenerToken: "creator-token" }, db));
  assert.equal(resp.status, 200);
  assert.equal(db.calls.some((c) => /INSERT INTO echo_notifications/.test(c.sql)), false);
});

test("response never includes play_count or the creator token hash", async () => {
  const creatorHash = await EchoValidation.hashCreatorToken("creator-token");
  const db = createFakeDb([
    { match: /SELECT message, melody_json/, first: () => ({ ...SAMPLE_ROW, creator_token_hash: creatorHash }) },
    { match: /UPDATE echoes SET play_count/, run: () => ({ success: true }) },
  ]);
  const resp = await onRequestPost(ctx("echo-1", {}, db));
  const body = await resp.json();
  assert.equal("play_count" in body, false);
  assert.equal("creator_token_hash" in body, false);
});
