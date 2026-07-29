import test from "node:test";
import assert from "node:assert/strict";
import { onRequestDelete } from "./[id].js";
import { createFakeDb } from "./_testdb.mjs";
import EchoValidation from "../../../echovalidation.js";

function ctx(id, creatorToken, db) {
  return {
    params: { id },
    request: { url: `https://x/api/echoes/${id}${creatorToken ? `?creatorToken=${encodeURIComponent(creatorToken)}` : ""}` },
    env: { DB: db },
  };
}

test("no DB binding configured: 501", async () => {
  const resp = await onRequestDelete({ params: { id: "abc" }, request: { url: "https://x/api/echoes/abc?creatorToken=t" }, env: {} });
  assert.equal(resp.status, 501);
});

test("missing creatorToken: 400, no query attempted", async () => {
  const db = createFakeDb();
  const resp = await onRequestDelete(ctx("abc", null, db));
  assert.equal(resp.status, 400);
  assert.equal(db.calls.length, 0);
});

test("echo not found: 404", async () => {
  const db = createFakeDb([{ match: /SELECT creator_token_hash/, first: () => null }]);
  const resp = await onRequestDelete(ctx("missing-id", "some-token", db));
  assert.equal(resp.status, 404);
});

test("wrong creatorToken (not the owner): 403, nothing deleted", async () => {
  const ownerHash = await EchoValidation.hashCreatorToken("owner-token");
  const db = createFakeDb([{ match: /SELECT creator_token_hash/, first: () => ({ creator_token_hash: ownerHash }) }]);
  const resp = await onRequestDelete(ctx("echo-1", "someone-elses-token", db));
  assert.equal(resp.status, 403);
  assert.equal(db.calls.some((c) => /DELETE/.test(c.sql)), false);
});

test("correct owner: deletes notifications then the echo, returns success", async () => {
  const ownerHash = await EchoValidation.hashCreatorToken("owner-token");
  const db = createFakeDb([
    { match: /SELECT creator_token_hash/, first: () => ({ creator_token_hash: ownerHash }) },
    { match: /DELETE FROM echo_notifications/, run: () => ({ success: true }) },
    { match: /DELETE FROM echoes/, run: () => ({ success: true }) },
  ]);
  const resp = await onRequestDelete(ctx("echo-1", "owner-token", db));
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(body.deleted, true);

  const notifIdx = db.calls.findIndex((c) => /DELETE FROM echo_notifications/.test(c.sql));
  const echoIdx = db.calls.findIndex((c) => /DELETE FROM echoes/.test(c.sql));
  assert.ok(notifIdx >= 0 && echoIdx >= 0 && notifIdx < echoIdx, "notifications must be deleted before the echo row itself");
});
