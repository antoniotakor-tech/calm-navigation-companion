const test = require("node:test");
const assert = require("node:assert/strict");
const {
  forwardGeocode, reverseGeocode, resolveCityContext,
  getCachedCityContext, clearCachedCityContext,
} = require("./geocodingservice.js");

function mockFetchOk(body) {
  return async () => ({ ok: true, json: async () => body });
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

test("forwardGeocode: an empty/blank query short-circuits to an empty result without calling fetch", async () => {
  let called = false;
  await withMockedFetch(
    async () => { called = true; return mockFetchOk({ hits: [] })(); },
    async () => {
      const result = await forwardGeocode({ query: "   " });
      assert.deepEqual(result.hits, []);
      assert.equal(called, false);
    }
  );
});

test("forwardGeocode: returns hits from a successful response", async () => {
  await withMockedFetch(
    mockFetchOk({ hits: [{ name: "Vondelpark" }] }),
    async () => {
      const result = await forwardGeocode({ query: "vondelpark" });
      assert.equal(result.hits.length, 1);
      assert.equal(result.hits[0].name, "Vondelpark");
    }
  );
});

test("forwardGeocode: a non-ok HTTP response throws a typed 'http' error with the server's message", async () => {
  await withMockedFetch(
    async () => ({ ok: false, status: 400, json: async () => ({ error: "q must not be empty." }) }),
    async () => {
      await assert.rejects(
        () => forwardGeocode({ query: "x" }),
        (err) => { assert.equal(err.kind, "http"); assert.equal(err.status, 400); return true; }
      );
    }
  );
});

test("forwardGeocode: a malformed (non-JSON) response throws a typed 'malformed' error", async () => {
  await withMockedFetch(
    async () => ({ ok: true, json: async () => { throw new Error("not json"); } }),
    async () => {
      await assert.rejects(() => forwardGeocode({ query: "x" }), (err) => { assert.equal(err.kind, "malformed"); return true; });
    }
  );
});

test("forwardGeocode: a network failure throws a typed 'network' error", async () => {
  await withMockedFetch(
    async () => { throw new Error("connection refused"); },
    async () => {
      await assert.rejects(() => forwardGeocode({ query: "x" }), (err) => { assert.equal(err.kind, "network"); return true; });
    }
  );
});

test("forwardGeocode: an externally aborted request throws a typed 'cancelled' error, not 'timeout'", async () => {
  const controller = new AbortController();
  await withMockedFetch(
    async (url, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); });
    }),
    async () => {
      const promise = forwardGeocode({ query: "x", signal: controller.signal });
      controller.abort();
      await assert.rejects(promise, (err) => { assert.equal(err.kind, "cancelled"); return true; });
    }
  );
});

test("forwardGeocode: a request that times out (never resolves) throws a typed 'timeout' error", async () => {
  await withMockedFetch(
    async (url, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); });
    }),
    async () => {
      await assert.rejects(
        () => forwardGeocode({ query: "x", timeoutMs: 5 }),
        (err) => { assert.equal(err.kind, "timeout"); return true; }
      );
    }
  );
});

test("reverseGeocode: no point at all short-circuits to an empty result without calling fetch", async () => {
  let called = false;
  await withMockedFetch(
    async () => { called = true; return mockFetchOk({ hits: [] })(); },
    async () => {
      const result = await reverseGeocode({ point: null });
      assert.deepEqual(result.hits, []);
      assert.equal(called, false);
    }
  );
});

test("resolveCityContext: caches the result for the rest of the session, avoiding a repeat reverse-geocode call", async () => {
  clearCachedCityContext();
  let callCount = 0;
  await withMockedFetch(
    async () => { callCount++; return mockFetchOk({ hits: [{ city: "Amsterdam", state: "North Holland", countrycode: "nl" }] })(); },
    async () => {
      const first = await resolveCityContext({ point: { lat: 52.37, lon: 4.9 } });
      const second = await resolveCityContext({ point: { lat: 52.37, lon: 4.9 } });
      assert.equal(callCount, 1, "the second call must be served from cache, not a new request");
      assert.equal(first.city, "Amsterdam");
      assert.equal(second, first);
    }
  );
});

test("resolveCityContext: force:true bypasses the cache and re-fetches", async () => {
  clearCachedCityContext();
  let callCount = 0;
  await withMockedFetch(
    async () => { callCount++; return mockFetchOk({ hits: [{ city: "Amsterdam" }] })(); },
    async () => {
      await resolveCityContext({ point: { lat: 52.37, lon: 4.9 } });
      await resolveCityContext({ point: { lat: 52.37, lon: 4.9 }, force: true });
      assert.equal(callCount, 2);
    }
  );
});

test("resolveCityContext: no point at all returns null immediately", async () => {
  clearCachedCityContext();
  const result = await resolveCityContext({});
  assert.equal(result, null);
});

test("getCachedCityContext/clearCachedCityContext: reflect the current cache state directly", async () => {
  clearCachedCityContext();
  assert.equal(getCachedCityContext(), null);
  await withMockedFetch(
    mockFetchOk({ hits: [{ city: "Rotterdam" }] }),
    async () => {
      await resolveCityContext({ point: { lat: 51.9, lon: 4.5 } });
      assert.equal(getCachedCityContext().city, "Rotterdam");
      clearCachedCityContext();
      assert.equal(getCachedCityContext(), null);
    }
  );
});
