import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, VISIBILITY_WINDOW_MS } from "./nearby.js";
import { createFakeDb } from "./_testdb.mjs";

function req(query) {
  return { request: { url: `https://x/api/echoes/nearby?${query}` } };
}

test("no DB binding configured: 501", async () => {
  const resp = await onRequestGet({ ...req("lat=52.37&lon=4.9"), env: {} });
  assert.equal(resp.status, 501);
});

test("invalid lat/lon: 400, no query attempted", async () => {
  const db = createFakeDb();
  const resp = await onRequestGet({ ...req("lat=999&lon=4.9"), env: { DB: db } });
  assert.equal(resp.status, 400);
  assert.equal(db.calls.length, 0);
});

test("filters bounding-box hits down to the exact radius, and never returns the melody or creator hash", async () => {
  const db = createFakeDb([
    {
      match: /SELECT id, lat, lon, created_at, message FROM echoes/,
      all: () => ({
        results: [
          { id: "close", lat: 52.3680, lon: 4.9041, created_at: 1000, message: "Nearby one" },
          { id: "far", lat: 52.5000, lon: 4.9041, created_at: 2000, message: "Far one" }, // ~14.7km away
        ],
      }),
    },
  ]);
  const resp = await onRequestGet({ ...req("lat=52.3676&lon=4.9041&radiusM=500"), env: { DB: db } });
  assert.equal(resp.status, 200);
  const body = await resp.json();
  assert.equal(body.echoes.length, 1);
  assert.equal(body.echoes[0].id, "close");
  assert.equal("melody" in body.echoes[0], false);
  assert.equal("creatorTokenHash" in body.echoes[0], false);
});

test("radiusM is clamped server-side regardless of what the client requests", async () => {
  let boundArgs = null;
  const db = createFakeDb([
    {
      match: /SELECT id, lat, lon, created_at, message FROM echoes/,
      all: (args) => { boundArgs = args; return { results: [] }; },
    },
  ]);
  await onRequestGet({ ...req("lat=52.3676&lon=4.9041&radiusM=999999"), env: { DB: db } });
  // A wildly oversized requested radius must not blow up the bounding box —
  // the box passed to SQL should correspond to MAX_NEARBY_RADIUS_M, not 999999.
  // boundArgs[0] is now the 48h visibility cutoff (see the test below) —
  // the lat/lon box follows it.
  const [, minLat, maxLat] = boundArgs;
  const spanDeg = maxLat - minLat;
  assert.ok(spanDeg < 1, `expected a bounded box, got a ${spanDeg}-degree-wide span`);
});

test("48h visibility window: the query is bound with a visibleSince cutoff ~48h in the past, and the SQL actually filters on it", async () => {
  let boundArgs = null;
  let sql = null;
  const db = createFakeDb([
    {
      match: /SELECT id, lat, lon, created_at, message FROM echoes/,
      all: (args) => { boundArgs = args; return { results: [] }; },
    },
  ]);
  const before = Date.now();
  await onRequestGet({ ...req("lat=52.3676&lon=4.9041"), env: { DB: db } });
  const after = Date.now();
  assert.match(db.calls[0].sql, /created_at > \?/, "the WHERE clause filters on created_at");
  const cutoff = boundArgs[0];
  assert.ok(cutoff >= before - VISIBILITY_WINDOW_MS && cutoff <= after - VISIBILITY_WINDOW_MS, `expected cutoff ~48h before now, got ${new Date(cutoff).toISOString()}`);
});

test("48h visibility window: an Echo older than the cutoff never reaches the response (hidden, not deleted — the row itself is untouched)", async () => {
  const now = Date.now();
  const db = createFakeDb([
    {
      match: /SELECT id, lat, lon, created_at, message FROM echoes/,
      // Mimics what a real `created_at > ?` WHERE clause would do — the
      // fake DB doesn't execute SQL, so the filtering the endpoint asked
      // for is applied here to prove the bound cutoff would actually work.
      all: (args) => {
        const [cutoff] = args;
        const rows = [
          { id: "fresh", lat: 52.3680, lon: 4.9041, created_at: now - 60000, message: "Fresh" },
          { id: "stale", lat: 52.3680, lon: 4.9041, created_at: now - VISIBILITY_WINDOW_MS - 60000, message: "Stale" },
        ];
        return { results: rows.filter((r) => r.created_at > cutoff) };
      },
    },
  ]);
  const resp = await onRequestGet({ ...req("lat=52.3676&lon=4.9041&radiusM=500"), env: { DB: db } });
  const body = await resp.json();
  assert.equal(body.echoes.length, 1);
  assert.equal(body.echoes[0].id, "fresh");
});
