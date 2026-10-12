import test from "node:test";
import assert from "node:assert/strict";
import { createFakeDb } from "../echoes/_testdb.mjs";
import * as posts from "./posts/index.js";
import * as me from "./me.js";

const req = (body) => new Request("https://x/api/social/posts", { method: "POST", body: JSON.stringify(body) });
const post = { kind: "spot", title: "Quiet bench", body: "", lat: 52.37, lon: 4.9 };

test("posting without a profile is refused", async () => {
  const DB = createFakeDb([{ match: /FROM profiles/, first: () => null }]);
  const res = await posts.onRequestPost({ request: req({ token: "device-token-123", post }), env: { DB } });
  assert.equal(res.status, 403);
});

test("a valid post is stored without the raw token and returned with the author", async () => {
  const DB = createFakeDb([
    { match: /SELECT nickname, avatar FROM profiles/, first: () => ({ nickname: "Ann", avatar: "mint" }) },
    { match: /COUNT\(\*\)/, first: () => ({ c: 0 }) },
  ]);
  const res = await posts.onRequestPost({ request: req({ token: "device-token-123", post }), env: { DB } });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.post.author.nickname, "Ann");
  const insert = DB.calls.find((c) => /INSERT INTO posts/.test(c.sql));
  assert.ok(insert && !insert.args.includes("device-token-123"));
});

test("the daily post limit applies", async () => {
  const DB = createFakeDb([
    { match: /SELECT nickname, avatar FROM profiles/, first: () => ({ nickname: "Ann", avatar: "mint" }) },
    { match: /COUNT\(\*\)/, first: () => ({ c: 5 }) },
  ]);
  const res = await posts.onRequestPost({ request: req({ token: "device-token-123", post }), env: { DB } });
  assert.equal(res.status, 429);
});

test("deleting the account removes posts and profile", async () => {
  const DB = createFakeDb();
  const res = await me.onRequestPost({ request: req({ token: "device-token-123", action: "delete" }), env: { DB } });
  assert.equal((await res.json()).deleted, true);
  assert.ok(DB.calls.some((c) => /DELETE FROM posts/.test(c.sql)) && DB.calls.some((c) => /DELETE FROM profiles/.test(c.sql)));
});
