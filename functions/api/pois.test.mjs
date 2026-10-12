// Run with: node --test functions/api/pois.test.mjs
// Exercises the actual Cloudflare Pages Function (functions/api/pois.js) —
// same convention as geocode.test.mjs: mock global.fetch, never touch the
// real Overpass service.
import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, parseBbox, normalizePoi } from "./pois.js";

function ctx(url) {
  return { request: { url }, env: {} };
}

async function withMockedFetch(impl, fn) {
  const original = global.fetch;
  global.fetch = impl;
  try {
    return await fn();
  } finally {
    global.fetch = original;
  }
}

test("parseBbox: accepts a small valid bbox, rejects malformed/oversized/inverted ones", () => {
  assert.ok(parseBbox("52.36,4.88,52.37,4.89"));
  assert.equal(parseBbox(null), null);
  assert.equal(parseBbox("not,a,bbox"), null);
  assert.equal(parseBbox("52.37,4.89,52.36,4.88"), null, "inverted corners");
  assert.equal(parseBbox("52.0,4.0,53.0,5.0"), null, "a whole province is far over the area cap");
  assert.equal(parseBbox("91,4.88,92,4.89"), null, "latitude out of range");
});

test("normalizePoi: keeps named nodes/ways, classifies shop vs food, drops unnamed ones", () => {
  const shop = normalizePoi({ type: "node", id: 1, lat: 52.1, lon: 4.9, tags: { shop: "bakery", name: "Bakkerij Jan" } });
  assert.deepEqual(shop, { id: "node/1", lat: 52.1, lon: 4.9, name: "Bakkerij Jan", kind: "shop" });

  const cafe = normalizePoi({ type: "way", id: 2, center: { lat: 52.2, lon: 4.8 }, tags: { amenity: "cafe", name: "Café Zee" } });
  assert.equal(cafe.kind, "food");
  assert.equal(cafe.lat, 52.2, "a way uses its center point");

  assert.equal(normalizePoi({ type: "node", id: 3, lat: 52.1, lon: 4.9, tags: { shop: "bakery" } }), null, "unnamed POIs are dropped");
  assert.equal(normalizePoi({ type: "node", id: 4, tags: { name: "No coords" } }), null);
});

test("missing/invalid bbox: 400, upstream never called", async () => {
  let called = false;
  await withMockedFetch(
    async () => { called = true; return { ok: true, json: async () => ({ elements: [] }) }; },
    async () => {
      const resp = await onRequestGet(ctx("https://x/api/pois"));
      assert.equal(resp.status, 400);
      const oversized = await onRequestGet(ctx("https://x/api/pois?bbox=50,4,53,6"));
      assert.equal(oversized.status, 400);
      assert.equal(called, false);
    }
  );
});

test("happy path: shapes, filters, and caps upstream elements; sends fixed QL with only the bbox interpolated", async () => {
  let sentBody = null;
  const elements = [
    { type: "node", id: 1, lat: 52.361, lon: 4.881, tags: { shop: "books", name: "Boekhandel" } },
    { type: "node", id: 2, lat: 52.362, lon: 4.882, tags: { amenity: "restaurant", name: "Eethuis" } },
    { type: "node", id: 3, lat: 52.363, lon: 4.883, tags: { shop: "florist" } }, // unnamed -> dropped
  ];
  await withMockedFetch(
    async (url, opts) => { sentBody = decodeURIComponent(opts.body); return { ok: true, json: async () => ({ elements }) }; },
    async () => {
      const resp = await onRequestGet(ctx("https://x/api/pois?bbox=52.36,4.88,52.37,4.89"));
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.pois.length, 2);
      // Food first is deliberate (see the per-kind caps in pois.js).
      assert.deepEqual(body.pois.map((p) => p.kind), ["food", "shop"]);
      assert.match(sentBody, /52\.36,4\.88,52\.37,4\.89/, "bbox reaches the QL");
      assert.doesNotMatch(sentBody, /out:csv|out:xml/, "query shape is the fixed server-side one");
      assert.equal(resp.headers.get("cache-control"), "public, max-age=600");
    }
  );
});

test("upstream failures: every mirror tried before an honest 502; a later mirror rescues the request", async () => {
  let calls = 0;
  await withMockedFetch(
    async () => { calls++; throw new Error("network down"); },
    async () => {
      const resp = await onRequestGet(ctx("https://x/api/pois?bbox=52.36,4.88,52.37,4.89"));
      assert.equal(resp.status, 502);
      assert.equal(calls, 3, "all three mirrors attempted");
    }
  );
  calls = 0;
  await withMockedFetch(
    async () => {
      calls++;
      if (calls < 3) return { ok: false, status: 429 };
      return { ok: true, json: async () => ({ elements: [{ type: "node", id: 1, lat: 52.36, lon: 4.88, tags: { amenity: "bar", name: "Rescue Bar" } }] }) };
    },
    async () => {
      const resp = await onRequestGet(ctx("https://x/api/pois?bbox=52.36,4.88,52.37,4.89"));
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.pois[0].name, "Rescue Bar", "third mirror rescued the request");
    }
  );
});

test("per-kind caps: food is never crowded out by shops (shops listed first upstream)", async () => {
  const elements = [];
  for (let i = 0; i < 160; i++) elements.push({ type: "node", id: i, lat: 52.36, lon: 4.88, tags: { shop: "gift", name: `Shop ${i}` } });
  for (let i = 0; i < 80; i++) elements.push({ type: "node", id: 1000 + i, lat: 52.36, lon: 4.88, tags: { amenity: "bar", name: `Bar ${i}` } });
  await withMockedFetch(
    async () => ({ ok: true, json: async () => ({ elements }) }),
    async () => {
      const resp = await onRequestGet(ctx("https://x/api/pois?bbox=52.36,4.88,52.37,4.89"));
      const body = await resp.json();
      const kinds = body.pois.reduce((m, p) => { m[p.kind] = (m[p.kind] || 0) + 1; return m; }, {});
      assert.equal(kinds.food, 80, "every bar survives");
      assert.equal(kinds.shop, 160, "every shop survives under the raised cap");
    }
  );
});

test("expanded food kinds: biergarten and nightclub classify as food", () => {
  assert.equal(normalizePoi({ type: "node", id: 1, lat: 52, lon: 4, tags: { amenity: "biergarten", name: "Garten" } }).kind, "food");
  assert.equal(normalizePoi({ type: "node", id: 2, lat: 52, lon: 4, tags: { amenity: "nightclub", name: "Club" } }).kind, "food");
});

// ---- D1 area cache (2026-10-10) -----------------------------------------
// Minimal in-memory stand-in for the D1 binding: just the prepare/bind/
// first/run surface pois.js uses.
function fakeDb(rows = new Map()) {
  return {
    rows,
    prepare(sql) {
      let args = [];
      const stmt = {
        bind(...a) { args = a; return stmt; },
        async first() { return rows.get(args[0]) || null; },
        async run() {
          if (/^INSERT/.test(sql)) rows.set(args[0], { body: args[1], fetched_at: args[2] });
          return {};
        },
      };
      return stmt;
    },
  };
}
const BBOX_URL = "https://x/api/pois?bbox=52.36,4.88,52.37,4.89";
const KEY = "52.3600,4.8800,52.3700,4.8900";
const cachedBody = JSON.stringify({ pois: [{ id: "node/9", lat: 52.365, lon: 4.885, name: "Cached Café", kind: "food" }] });

test("D1 cache: a fresh cached area is served without calling Overpass", async () => {
  const db = fakeDb(new Map([[KEY, { body: cachedBody, fetched_at: Date.now() - 60 * 1000 }]]));
  let called = false;
  await withMockedFetch(async () => { called = true; throw new Error("should not be called"); }, async () => {
    const resp = await onRequestGet({ request: { url: BBOX_URL }, env: { DB: db } });
    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get("x-poi-cache"), "hit");
    assert.equal((await resp.json()).pois[0].name, "Cached Café");
  });
  assert.equal(called, false);
});

test("D1 cache: when every mirror fails, an old cached copy is served instead of a 502", async () => {
  const db = fakeDb(new Map([[KEY, { body: cachedBody, fetched_at: Date.now() - 3 * 24 * 60 * 60 * 1000 }]]));
  await withMockedFetch(async () => ({ ok: false, status: 429 }), async () => {
    const resp = await onRequestGet({ request: { url: BBOX_URL }, env: { DB: db } });
    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get("x-poi-cache"), "stale");
  });
});

test("D1 cache: a successful Overpass answer is stored for next time", async () => {
  const db = fakeDb();
  await withMockedFetch(
    async () => ({ ok: true, status: 200, json: async () => ({ elements: [{ type: "node", id: 5, lat: 52.365, lon: 4.885, tags: { amenity: "cafe", name: "Fresh" } }] }) }),
    async () => {
      const resp = await onRequestGet({ request: { url: BBOX_URL }, env: { DB: db } });
      assert.equal(resp.headers.get("x-poi-cache"), "miss");
    }
  );
  assert.ok(db.rows.get(KEY), "row written");
  assert.match(db.rows.get(KEY).body, /Fresh/);
});

test("name search: nearest branches first, query sanitised, cached", async () => {
  const { sanitizeNameQuery } = await import("./pois.js");
  assert.equal(sanitizeNameQuery('"]);out;(nwr'), "outnwr", "Overpass syntax can't be injected");
  assert.equal(sanitizeNameQuery("a"), null);
  let sentQuery = "";
  const db = fakeDb();
  await withMockedFetch(
    async (_u, init) => { sentQuery = decodeURIComponent(init.body); return { ok: true, status: 200, json: async () => ({ elements: [
      { type: "node", id: 1, lat: 52.40, lon: 4.90, tags: { amenity: "cafe", name: "Starbucks" } },
      { type: "node", id: 2, lat: 52.3680, lon: 4.9045, tags: { amenity: "cafe", name: "Starbucks" } },
    ] }) }; },
    async () => {
      const resp = await onRequestGet({ request: { url: "https://x/api/pois?q=Starbucks&lat=52.3676&lon=4.9041" }, env: { DB: db } });
      const body = await resp.json();
      assert.equal(body.places[0].id, "node/2", "the nearest branch comes first");
      assert.ok(body.places[0].distanceM < body.places[1].distanceM);
    }
  );
  assert.match(sentQuery, /around:6000,52.3676,4.9041/);
  assert.match(sentQuery, /"name"~"Starbucks",i/);
  assert.ok([...db.rows.keys()].some((k) => k.startsWith("name:starbucks:")), "cached in D1");
});
