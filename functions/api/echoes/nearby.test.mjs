import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "./nearby.js";
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
  const [minLat, maxLat] = boundArgs;
  const spanDeg = maxLat - minLat;
  assert.ok(spanDeg < 1, `expected a bounded box, got a ${spanDeg}-degree-wide span`);
});
