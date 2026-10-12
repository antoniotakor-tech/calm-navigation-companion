// ---------------------------------------------------------------------------
// Geocoding service — thin client wrapper around the same-origin
// /api/geocode proxy (functions/api/geocode.js). No API key ever lives here;
// same rationale as routing.js's fetchCalmRoute/geocode.
//
// Provides forward search, reverse lookup, and a session-cached "current
// city context" used to bias/rank autocomplete results. Every request
// supports an external AbortSignal (for stale-request cancellation by
// autocompletecontroller.js) plus its own timeout, combined manually so this
// works without relying on AbortSignal.any (not universally available on
// older mobile Safari).
// ---------------------------------------------------------------------------

// Named distinctly from routing.js's own REQUEST_TIMEOUT_MS — classic
// <script> tags share one top-level lexical scope, so two `const`s with the
// same name across files is a SyntaxError that silently kills whichever
// script loads second (no console.* message, just a swallowed parse error).
const GEOCODE_REQUEST_TIMEOUT_MS = 7000;

function buildUrl(path, params, endpointBase) {
  const url = new URL(
    (endpointBase || "") + path,
    typeof location !== "undefined" ? location.origin : "http://localhost"
  );
  Object.keys(params).forEach((k) => {
    const v = params[k];
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  });
  return url.toString();
}

function fetchJSON(url, { signal, timeoutMs } = {}) {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs || GEOCODE_REQUEST_TIMEOUT_MS);
  const onExternalAbort = () => timeoutController.abort();
  if (signal) {
    if (signal.aborted) timeoutController.abort();
    signal.addEventListener("abort", onExternalAbort);
  }

  return fetch(url, { signal: timeoutController.signal })
    .then(async (resp) => {
      let body = null;
      try {
        body = await resp.json();
      } catch (e) {
        const err = new Error("Geocoding service returned a malformed response.");
        err.kind = "malformed";
        throw err;
      }
      if (!resp.ok) {
        const err = new Error((body && body.error) || "Geocoding request failed.");
        err.kind = "http";
        err.status = resp.status;
        throw err;
      }
      return body;
    })
    .catch((e) => {
      if (e && e.name === "AbortError") {
        if (signal && signal.aborted) {
          const err = new Error("Request cancelled.");
          err.kind = "cancelled";
          throw err;
        }
        const err = new Error("Geocoding request timed out.");
        err.kind = "timeout";
        throw err;
      }
      if (e && e.kind) throw e;
      const err = new Error("Couldn't reach the geocoding service.");
      err.kind = "network";
      throw err;
    })
    .finally(() => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onExternalAbort);
    });
}

// point: {lat, lon} | null — when present, biases (does not restrict) results
// toward that location, per GraphHopper's documented `point` bias parameter.
// "Street 12, City": find the city first, then search the street around it,
// so "Via San Francesco 5, Assisi" doesn't become "Via San Francesco
// d'Assisi 5" in another town (2026-10-12). City points are cached.
const cityPointCache = new Map();
const PLACE_VALUES = ["city", "town", "village", "hamlet", "suburb", "municipality", "borough"];
async function cityPoint(city, opts) {
  const key = city.toLowerCase();
  if (cityPointCache.has(key)) return cityPointCache.get(key);
  const url = buildUrl("/api/geocode", { q: city, limit: 5, locale: opts.locale }, opts.endpointBase);
  const data = await fetchJSON(url, { signal: opts.signal, timeoutMs: opts.timeoutMs });
  const hits = Array.isArray(data.hits) ? data.hits : [];
  const best = hits.find((h) => h.osm_key === "place" && PLACE_VALUES.includes(h.osm_value)) || hits.find((h) => h.osm_key === "boundary") || null;
  const p = best && best.point ? { lat: best.point.lat, lon: best.point.lng } : null;
  cityPointCache.set(key, p);
  return p;
}

async function forwardGeocode({ query, point, limit, locale, signal, timeoutMs, endpointBase }) {
  const q = (query || "").trim();
  if (!q) return { hits: [] };
  const comma = q.lastIndexOf(",");
  const cityPart = comma > 0 ? q.slice(comma + 1).trim() : "";
  if (cityPart && !/\d/.test(cityPart) && cityPart.length >= 2) {
    try {
      const cp = await cityPoint(cityPart, { locale, signal, timeoutMs, endpointBase });
      if (cp) {
        const near = buildUrl("/api/geocode", { q: q.slice(0, comma).trim(), point: `${cp.lat},${cp.lon}`, limit: 10, locale }, endpointBase);
        const all = buildUrl("/api/geocode", { q, point: point ? `${point.lat},${point.lon}` : undefined, limit, locale }, endpointBase);
        const [a, b] = await Promise.all([fetchJSON(near, { signal, timeoutMs }), fetchJSON(all, { signal, timeoutMs }).catch(() => ({ hits: [] }))]);
        // keep street results that really are near the named city (≤ 25 km)
        const nearHits = (a.hits || []).filter((h) => h.point && Math.abs(h.point.lat - cp.lat) < 0.23 && Math.abs(h.point.lng - cp.lon) < 0.33)
          // "Napoli" typed, "Naples" returned: still the right city — but only
          // close to its centre (~6 km), so a nearby village doesn't count.
          .map((h) => ({ ...h, inNamedCity: Math.abs(h.point.lat - cp.lat) < 0.055 && Math.abs(h.point.lng - cp.lon) < 0.08 }));
        return { hits: nearHits.concat(Array.isArray(b.hits) ? b.hits : []) };
      }
    } catch (e) {
      if (e && e.name === "AbortError") throw e;
      // fall through to the plain search
    }
  }
  const url = buildUrl(
    "/api/geocode",
    { q, point: point ? `${point.lat},${point.lon}` : undefined, limit, locale },
    endpointBase
  );
  const data = await fetchJSON(url, { signal, timeoutMs });
  return { hits: Array.isArray(data.hits) ? data.hits : [] };
}

async function reverseGeocode({ point, locale, signal, timeoutMs, endpointBase }) {
  if (!point) return { hits: [] };
  const url = buildUrl(
    "/api/geocode",
    { reverse: "true", point: `${point.lat},${point.lon}`, locale },
    endpointBase
  );
  const data = await fetchJSON(url, { signal, timeoutMs });
  return { hits: Array.isArray(data.hits) ? data.hits : [] };
}

// Session-level cache — deliberately module-scoped state, not persisted to
// localStorage/disk: "cache the result for the current session" but never
// store live-location history permanently (privacy requirement).
let cachedCityContext = null;

function getCachedCityContext() {
  return cachedCityContext;
}

function clearCachedCityContext() {
  cachedCityContext = null;
}

// Resolves {city, locality, state, countryCode, lat, lon} for a coordinate via
// one reverse-geocode call, then caches it for the rest of the session so
// repeated GPS fixes never trigger repeated reverse-geocode requests.
async function resolveCityContext({ point, locale, endpointBase, force } = {}) {
  if (!point) return null;
  if (cachedCityContext && !force) return cachedCityContext;
  const { hits } = await reverseGeocode({ point, locale, endpointBase });
  const hit = hits[0];
  if (!hit) return null;
  cachedCityContext = {
    city: hit.city || hit.district || null,
    locality: hit.district || hit.city || null,
    state: hit.state || null,
    countryCode: hit.countrycode ? String(hit.countrycode).toUpperCase() : null,
    lat: point.lat,
    lon: point.lon,
  };
  return cachedCityContext;
}

if (typeof module === "object" && module.exports) {
  module.exports = {
    forwardGeocode, reverseGeocode, resolveCityContext,
    getCachedCityContext, clearCachedCityContext,
    GEOCODE_REQUEST_TIMEOUT_MS,
  };
}
