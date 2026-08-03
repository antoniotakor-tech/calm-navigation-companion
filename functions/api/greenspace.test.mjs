// Run with: node --test functions/api/greenspace.test.mjs
// Exercises the actual Cloudflare Pages Function (functions/api/greenspace.js)
// — same convention as pois.test.mjs: mock global.fetch, never touch the
// real Overpass service.
import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, parseBbox, normalizeGreenWay, simplifyWay } from "./greenspace.js";

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

test("parseBbox: accepts a route-sized bbox, rejects malformed/oversized/inverted ones", () => {
  assert.ok(parseBbox("52.36,4.88,52.40,4.95"));
  assert.equal(parseBbox(null), null);
  assert.equal(parseBbox("not,a,bbox"), null);
  assert.equal(parseBbox("52.40,4.95,52.36,4.88"), null, "inverted corners");
  assert.equal(parseBbox("52.0,4.0,53.0,5.0"), null, "a whole province is far over the area cap");
  assert.equal(parseBbox("91,4.88,92,4.89"), null, "latitude out of range");
});

test("simplifyWay: leaves short ways untouched, stride-samples long ones while keeping the last point", () => {
  const short = [[0, 0], [1, 1], [2, 2]];
  assert.deepEqual(simplifyWay(short, 150), short);

  const long = Array.from({ length: 1000 }, (_, i) => [i, i]);
  const simplified = simplifyWay(long, 100);
  assert.ok(simplified.length <= 101, `expected ~100 points, got ${simplified.length}`);
  assert.deepEqual(simplified[0], long[0]);
  assert.deepEqual(simplified[simplified.length - 1], long[long.length - 1]);
});

test("normalizeGreenWay: shapes an Overpass `out geom` way into [[lon,lat],...], drops elements with no usable geometry", () => {
  const way = normalizeGreenWay({
    type: "way", id: 1,
    geometry: [{ lat: 52.37, lon: 4.90 }, { lat: 52.371, lon: 4.901 }, { lat: 52.372, lon: 4.902 }],
  });
  assert.deepEqual(way, [[4.90, 52.37], [4.901, 52.371], [4.902, 52.372]]);

  assert.equal(normalizeGreenWay(null), null);
  assert.equal(normalizeGreenWay({ type: "way", id: 2 }), null, "no geometry array at all");
  assert.equal(normalizeGreenWay({ type: "way", id: 3, geometry: [{ lat: 52.37, lon: 4.9 }] }), null, "single point isn't a way");
  assert.equal(
    normalizeGreenWay({ type: "way", id: 4, geometry: [{ lat: null, lon: 4.9 }, { lat: 52.37, lon: 4.9 }] }),
    null,
    "fewer than 2 valid points after filtering bad entries"
  );
});

test("missing/invalid bbox: 400, upstream never called", async () => {
  let called = false;
  await withMockedFetch(
    async () => { called = true; return { ok: true, json: async () => ({ elements: [] }) }; },
    async () => {
      const resp = await onRequestGet(ctx("https://x/api/greenspace"));
      assert.equal(resp.status, 400);
      const oversized = await onRequestGet(ctx("https://x/api/greenspace?bbox=50,4,53,6"));
      assert.equal(oversized.status, 400);
      assert.equal(called, false);
    }
  );
});

test("happy path: shapes way geometry, sends fixed QL with only the bbox interpolated, long cache", async () => {
  let sentBody = null;
  const elements = [
    {
      type: "way", id: 10, tags: { leisure: "park", name: "Vondelpark" },
      geometry: [{ lat: 52.357, lon: 4.868 }, { lat: 52.358, lon: 4.869 }, { lat: 52.357, lon: 4.868 }],
    },
    { type: "way", id: 11, tags: { shop: "books" }, geometry: [] }, // not a green tag match in a real query, but also just bad geometry here
  ];
  await withMockedFetch(
    async (url, opts) => { sentBody = decodeURIComponent(opts.body); return { ok: true, json: async () => ({ elements }) }; },
    async () => {
      const resp = await onRequestGet(ctx("https://x/api/greenspace?bbox=52.35,4.86,52.36,4.87"));
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.ways.length, 1);
      assert.deepEqual(body.ways[0][0], [4.868, 52.357]);
      assert.match(sentBody, /52\.35,4\.86,52\.36,4\.87/, "bbox reaches the QL");
      assert.match(sentBody, /out geom/, "requests full geometry, not just centers");
      assert.equal(resp.headers.get("cache-control"), "public, max-age=3600");
    }
  );
});

test("upstream failures: every mirror tried before an honest 502; a later mirror rescues the request", async () => {
  let calls = 0;
  await withMockedFetch(
    async () => { calls++; throw new Error("network down"); },
    async () => {
      const resp = await onRequestGet(ctx("https://x/api/greenspace?bbox=52.35,4.86,52.36,4.87"));
      assert.equal(resp.status, 502);
      assert.equal(calls, 3, "all three mirrors attempted");
    }
  );
  calls = 0;
  await withMockedFetch(
    async () => {
      calls++;
      if (calls < 3) return { ok: false, status: 429 };
      return {
        ok: true,
        json: async () => ({
          elements: [{ type: "way", id: 1, geometry: [{ lat: 52.36, lon: 4.88 }, { lat: 52.361, lon: 4.881 }] }],
        }),
      };
    },
    async () => {
      const resp = await onRequestGet(ctx("https://x/api/greenspace?bbox=52.35,4.86,52.36,4.87"));
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.ways.length, 1, "third mirror rescued the request");
    }
  );
});

test("response budget: stops adding ways once MAX_TOTAL_POINTS-equivalent is hit, never throws on a huge payload", async () => {
  const elements = [];
  for (let i = 0; i < 300; i++) {
    elements.push({
      type: "way", id: i,
      geometry: Array.from({ length: 50 }, (_, j) => ({ lat: 52.36 + j * 0.0001, lon: 4.88 + i * 0.0001 })),
    });
  }
  await withMockedFetch(
    async () => ({ ok: true, json: async () => ({ elements }) }),
    async () => {
      const resp = await onRequestGet(ctx("https://x/api/greenspace?bbox=52.35,4.86,52.36,4.87"));
      const body = await resp.json();
      assert.ok(body.ways.length <= 150, `expected at most MAX_WAYS (150), got ${body.ways.length}`);
    }
  );
});
