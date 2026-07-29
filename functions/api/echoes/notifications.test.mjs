import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "./notifications.js";
import { createFakeDb } from "./_testdb.mjs";

function ctx(creatorToken, db) {
  return {
    request: { url: `https://x/api/echoes/notifications${creatorToken ? `?creatorToken=${encodeURIComponent(creatorToken)}` : ""}` },
    env: { DB: db },
  };
}

test("no DB binding configured: 501", async () => {
  const resp = await onRequestGet({ request: { url: "https://x/api/echoes/notifications?creatorToken=t" }, env: {} });
  assert.equal(resp.status, 501);
});

test("missing creatorToken: 400", async () => {
  const db = createFakeDb();
  const resp = await onRequestGet(ctx(null, db));
  assert.equal(resp.status, 400);
});

test("returns unseen notifications with the fixed discovery message, and marks them seen in the same request", async () => {
  const db = createFakeDb([
    {
      match: /SELECT id, echo_id, created_at FROM echo_notifications/,
      all: () => ({ results: [{ id: "n1", echo_id: "echo-1", created_at: 1000 }] }),
    },
    { match: /UPDATE echo_notifications SET seen/, run: () => ({ success: true }) },
  ]);
  const resp = await onRequestGet(ctx("creator-token", db));
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(body.notifications.length, 1);
  assert.equal(body.notifications[0].message, "Someone discovered your Calm Echo.");
  assert.equal(db.calls.some((c) => /UPDATE echo_notifications SET seen/.test(c.sql)), true);
});

test("no unseen notifications: empty list, and no UPDATE is issued", () => {
  return (async () => {
    const db = createFakeDb([
      { match: /SELECT id, echo_id, created_at FROM echo_notifications/, all: () => ({ results: [] }) },
    ]);
    const resp = await onRequestGet(ctx("creator-token", db));
    const body = await resp.json();
    assert.deepEqual(body.notifications, []);
    assert.equal(db.calls.some((c) => /UPDATE/.test(c.sql)), false);
  })();
});
