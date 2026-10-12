// Run with: node --test functions/api/echoes/report.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "./[id]/report.js";
import { createFakeDb } from "./_testdb.mjs";

function ctx(id, body, db) {
  return { params: { id }, env: { DB: db }, request: { json: async () => body } };
}
const TOKEN = "reporter-device-token-1234";

test("valid report on an existing Echo hides it and records the report", async () => {
  let hiddenId = null, inserted = null;
  const db = createFakeDb([
    { match: /SELECT id FROM echoes WHERE id/, first: () => ({ id: "e1" }) },
    { match: /COUNT\(\*\) AS c FROM echo_reports WHERE reporter_hash/, first: () => ({ c: 0 }) },
    { match: /INSERT OR IGNORE INTO echo_reports/, run: (a) => { inserted = a; return {}; } },
    { match: /COUNT\(\*\) AS c FROM echo_reports WHERE echo_id/, first: () => ({ c: 1 }) },
    { match: /UPDATE echoes SET moderation_status = 'hidden'/, run: (a) => { hiddenId = a[0]; return {}; } },
  ]);
  const resp = await onRequestPost(ctx("e1", { reporterToken: TOKEN, reason: "offensive" }, db));
  assert.equal(resp.status, 200);
  assert.deepEqual(await resp.json(), { reported: true, hidden: true });
  assert.equal(hiddenId, "e1");
  assert.equal(inserted[0], "e1");
  assert.notEqual(inserted[1], TOKEN, "the raw reporter token is never stored");
  assert.equal(inserted[2], "offensive");
});

test("unknown reason or missing token: 400, nothing written", async () => {
  const db = createFakeDb([{ match: /SELECT id FROM echoes/, first: () => ({ id: "e1" }) }]);
  assert.equal((await onRequestPost(ctx("e1", { reporterToken: TOKEN, reason: "meh" }, db))).status, 400);
  assert.equal((await onRequestPost(ctx("e1", { reason: "spam" }, db))).status, 400);
  assert.equal(db.calls.some((c) => /INSERT|UPDATE/.test(c.sql)), false);
});

test("reporting an Echo that doesn't exist: 404", async () => {
  const db = createFakeDb([{ match: /SELECT id FROM echoes/, first: () => null }]);
  assert.equal((await onRequestPost(ctx("nope", { reporterToken: TOKEN, reason: "spam" }, db))).status, 404);
});

test("a reporter over the daily limit is refused, so one person can't wipe the map", async () => {
  const db = createFakeDb([
    { match: /SELECT id FROM echoes/, first: () => ({ id: "e1" }) },
    { match: /COUNT\(\*\) AS c FROM echo_reports WHERE reporter_hash/, first: () => ({ c: 20 }) },
  ]);
  const resp = await onRequestPost(ctx("e1", { reporterToken: TOKEN, reason: "spam" }, db));
  assert.equal(resp.status, 429);
  assert.equal(db.calls.some((c) => /UPDATE echoes/.test(c.sql)), false);
});

test("no DB binding: 501", async () => {
  const resp = await onRequestPost({ params: { id: "e1" }, env: {}, request: { json: async () => ({}) } });
  assert.equal(resp.status, 501);
});
