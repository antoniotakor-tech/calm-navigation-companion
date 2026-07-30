// Run with: node --test functions/api/transit.test.mjs
// Exercises the actual Cloudflare Pages Function (functions/api/transit.js) —
// same convention as pois.test.mjs: mock global.fetch, never touch the real
// Transitous service.
import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, parsePoint, normalizeLeg, normalizeItinerary } from "./transit.js";

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

const LEG = {
  mode: "TRAM",
  routeShortName: "2",
  headsign: "Nieuw Sloten",
  from: { name: "Amsterdam, Centraal Station" },
  to: { name: "Amsterdam, Cornelis Schuytstraat" },
  startTime: "2026-07-30T15:31:00Z",
  endTime: "2026-07-30T15:52:00Z",
  legGeometry: { points: "abc123", precision: 6 },
};

test("parsePoint: accepts lat,lon; rejects malformed/out-of-range", () => {
  assert.deepEqual(parsePoint("52.37,4.90"), { lat: 52.37, lon: 4.9 });
  assert.equal(parsePoint("52.37"), null);
  assert.equal(parsePoint("91,4.9"), null);
  assert.equal(parsePoint(null), null);
  assert.equal(parsePoint("a,b"), null);
});

test("normalizeLeg: whitelists fields, defaults precision, drops mode-less legs", () => {
  const leg = normalizeLeg(LEG);
  assert.equal(leg.mode, "TRAM");
  assert.equal(leg.route, "2");
  assert.equal(leg.points, "abc123");
  assert.equal(leg.precision, 6);
  assert.equal(normalizeLeg({ from: {}, to: {} }), null);
  assert.equal(normalizeLeg({ ...LEG, legGeometry: {} }).points, null);
  assert.equal(normalizeLeg({ ...LEG, legGeometry: {} }).precision, 6);
});

test("normalizeItinerary: keeps usable legs, drops leg-less itineraries", () => {
  const it = normalizeItinerary({ duration: 1740, startTime: "s", endTime: "e", transfers: 1, legs: [LEG, { nope: true }] });
  assert.equal(it.durationS, 1740);
  assert.equal(it.transfers, 1);
  assert.equal(it.legs.length, 1);
  assert.equal(normalizeItinerary({ duration: 100, legs: [] }), null);
});

test("missing/invalid from/to: 400, upstream never called", async () => {
  let called = false;
  await withMockedFetch(
    async () => { called = true; return { ok: true, json: async () => ({ itineraries: [] }) }; },
    async () => {
      assert.equal((await onRequestGet(ctx("https://x/api/transit"))).status, 400);
      assert.equal((await onRequestGet(ctx("https://x/api/transit?from=52.3,4.9"))).status, 400);
      assert.equal((await onRequestGet(ctx("https://x/api/transit?from=52.3,4.9&to=999,4.8"))).status, 400);
      assert.equal(called, false);
    }
  );
});

test("happy path: forwards from/to, caps itineraries, short cache header", async () => {
  let sentUrl = null;
  const itineraries = Array.from({ length: 7 }, () => ({ duration: 1000, startTime: "s", endTime: "e", transfers: 0, legs: [LEG] }));
  await withMockedFetch(
    async (url) => { sentUrl = String(url); return { ok: true, json: async () => ({ itineraries }) }; },
    async () => {
      const resp = await onRequestGet(ctx("https://x/api/transit?from=52.3791,4.9003&to=52.3579,4.8686"));
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.itineraries.length, 4, "capped at 4 options");
      assert.match(sentUrl, /fromPlace=52\.3791%2C4\.9003/);
      assert.match(sentUrl, /toPlace=52\.3579%2C4\.8686/);
      assert.equal(resp.headers.get("cache-control"), "public, max-age=30");
    }
  );
});

test("upstream failure/non-ok: honest 502", async () => {
  await withMockedFetch(
    async () => { throw new Error("down"); },
    async () => assert.equal((await onRequestGet(ctx("https://x/api/transit?from=52.3,4.9&to=52.4,4.8"))).status, 502)
  );
  await withMockedFetch(
    async () => ({ ok: false, status: 503 }),
    async () => assert.equal((await onRequestGet(ctx("https://x/api/transit?from=52.3,4.9&to=52.4,4.8"))).status, 502)
  );
});
