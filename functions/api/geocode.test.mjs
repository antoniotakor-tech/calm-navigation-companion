// Run with: node --test functions/api/geocode.test.mjs
// Exercises the actual Cloudflare Pages Function (functions/api/geocode.js),
// not a re-implementation of it. Mocks global.fetch so no real GraphHopper
// call ever happens. This file is ESM (funtions/package.json sets
// "type": "module") because the function itself must use Cloudflare's
// `export async function onRequestGet` contract.
import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "./geocode.js";

const ENV_WITH_KEY = { GRAPHHOPPER_API_KEY: "secret-test-key" };

function ctx(url, env = ENV_WITH_KEY) {
  return { request: { url }, env };
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

function okUpstream(hits) {
  return async () => ({ ok: true, json: async () => ({ hits }) });
}

test("no API key configured: returns 501 without ever calling fetch", async () => {
  let called = false;
  await withMockedFetch(
    async () => { called = true; return { ok: true, json: async () => ({ hits: [] }) }; },
    async () => {
      const resp = await onRequestGet(ctx("https://x/api/geocode?q=park", {}));
      assert.equal(resp.status, 501);
      assert.equal(called, false);
    }
  );
});

test("empty q on forward search: 400, no fetch called", async () => {
  let called = false;
  await withMockedFetch(
    async () => { called = true; return okUpstream([])(); },
    async () => {
      const resp = await onRequestGet(ctx("https://x/api/geocode?q="));
      assert.equal(resp.status, 400);
      const body = await resp.json();
      assert.match(body.error, /q must not be empty/i);
      assert.equal(called, false);
    }
  );
});

test("invalid limit (non-integer): 400", async () => {
  const resp = await onRequestGet(ctx("https://x/api/geocode?q=park&limit=abc"));
  assert.equal(resp.status, 400);
});

test("limit above MAX_LIMIT is clamped in the upstream request, not rejected", async () => {
  let requestedUrl = null;
  await withMockedFetch(
    async (url) => { requestedUrl = url; return okUpstream([])(); },
    async () => {
      const resp = await onRequestGet(ctx("https://x/api/geocode?q=park&limit=999"));
      assert.equal(resp.status, 200);
      const upstream = new URL(requestedUrl);
      assert.equal(upstream.searchParams.get("limit"), "10");
    }
  );
});

test("reverse geocoding requires a valid point: 400 without one", async () => {
  const resp = await onRequestGet(ctx("https://x/api/geocode?reverse=true"));
  assert.equal(resp.status, 400);
});

test("reverse geocoding with a valid point: forwards reverse=true and the point upstream", async () => {
  let requestedUrl = null;
  await withMockedFetch(
    async (url) => { requestedUrl = url; return okUpstream([{ name: "Vondelpark" }])(); },
    async () => {
      const resp = await onRequestGet(ctx("https://x/api/geocode?reverse=true&point=52.36,4.87"));
      assert.equal(resp.status, 200);
      const upstream = new URL(requestedUrl);
      assert.equal(upstream.searchParams.get("reverse"), "true");
      assert.equal(upstream.searchParams.get("point"), "52.36,4.87");
    }
  );
});

test("the GraphHopper API key is never present in the response body, even on success", async () => {
  await withMockedFetch(
    okUpstream([{ name: "Vondelpark", point: { lat: 52.36, lng: 4.87 } }]),
    async () => {
      const resp = await onRequestGet(ctx("https://x/api/geocode?q=vondelpark"));
      const text = await resp.text();
      assert.equal(text.includes("secret-test-key"), false);
    }
  );
});

test("only whitelisted hit fields are forwarded to the client", async () => {
  await withMockedFetch(
    okUpstream([{ name: "Vondelpark", point: { lat: 52.36, lng: 4.87 }, some_unexpected_field: "leak-me-not" }]),
    async () => {
      const resp = await onRequestGet(ctx("https://x/api/geocode?q=vondelpark"));
      const body = await resp.json();
      assert.equal("some_unexpected_field" in body.hits[0], false);
    }
  );
});

test("upstream network failure: 502, not an unhandled rejection", async () => {
  await withMockedFetch(
    async () => { throw new Error("network down"); },
    async () => {
      const resp = await onRequestGet(ctx("https://x/api/geocode?q=park"));
      assert.equal(resp.status, 502);
    }
  );
});

test("upstream non-ok response: 502 with a generic message, not the raw upstream body", async () => {
  await withMockedFetch(
    async () => ({ ok: false, status: 500 }),
    async () => {
      const resp = await onRequestGet(ctx("https://x/api/geocode?q=park"));
      assert.equal(resp.status, 502);
    }
  );
});

test("upstream timeout: 504", async () => {
  await withMockedFetch(
    async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; },
    async () => {
      const resp = await onRequestGet(ctx("https://x/api/geocode?q=park&", { ...ENV_WITH_KEY, GEOCODE_TIMEOUT_MS_OVERRIDE: "5" }));
      assert.equal(resp.status, 504);
    }
  );
});

test("query longer than MAX_QUERY_LEN: 400", async () => {
  const resp = await onRequestGet(ctx(`https://x/api/geocode?q=${"a".repeat(201)}`));
  assert.equal(resp.status, 400);
});

test("CORS header is present on every response, success or error", async () => {
  const errorResp = await onRequestGet(ctx("https://x/api/geocode?q="));
  assert.equal(errorResp.headers.get("access-control-allow-origin"), "*");
  await withMockedFetch(okUpstream([]), async () => {
    const okResp = await onRequestGet(ctx("https://x/api/geocode?q=park"));
    assert.equal(okResp.headers.get("access-control-allow-origin"), "*");
  });
});
