// Cloudflare Pages Function — server-side proxy for GraphHopper's geocoding
// API. Same rationale as route.js: keeps GRAPHHOPPER_API_KEY out of the
// client bundle entirely.
//
// Supports two modes, selected by the `reverse` param:
//   - forward search: ?q=<text>&point=<lat,lon>&limit=<n>&locale=<xx>
//   - reverse lookup: ?reverse=true&point=<lat,lon>&locale=<xx>
// `point` is optional on forward search (biases ranking toward that
// location) and required on reverse. Only GraphHopper-documented geocoding
// params are forwarded — no invented parameters.
const UPSTREAM_TIMEOUT_MS = 6000;
const MAX_LIMIT = 10;
const DEFAULT_LIMIT = 5;
const MAX_QUERY_LEN = 200;

// Fields the client actually uses (see searchranking.js#normalizeHit).
// Whitelisting the response keeps us from forwarding arbitrary/unexpected
// upstream fields straight to the browser.
const HIT_FIELDS = [
  "name", "housenumber", "street", "postcode", "city", "district",
  "county", "state", "country", "countrycode", "osm_key", "osm_value", "point",
];

// The native app's WebView runs on a different origin (e.g. capacitor://
// or https://localhost) than this Cloudflare Pages deployment, making every
// call here cross-origin from that app's point of view — without this
// header the browser/WebView would fetch the response but refuse to let JS
// read it. Safe to leave permissive: this endpoint carries no cookies/auth
// and no per-user data, only public geocoding results.
const CORS_HEADERS = { "access-control-allow-origin": "*" };

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS_HEADERS },
  });
}

function parsePoint(raw) {
  if (typeof raw !== "string") return null;
  const parts = raw.split(",");
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return `${lat},${lon}`;
}

function parseLimit(raw) {
  if (raw == null || raw === "") return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return null;
  return Math.min(n, MAX_LIMIT);
}

function pickHitFields(hit) {
  const out = {};
  for (const field of HIT_FIELDS) {
    if (hit[field] !== undefined) out[field] = hit[field];
  }
  return out;
}

function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.GRAPHHOPPER_API_KEY) {
    return jsonError("Geocoding is not configured on this deployment.", 501);
  }

  const incoming = new URL(request.url);
  const isReverse = incoming.searchParams.get("reverse") === "true";
  const rawQuery = (incoming.searchParams.get("q") || "").trim();
  const point = parsePoint(incoming.searchParams.get("point"));
  const limit = parseLimit(incoming.searchParams.get("limit"));
  const locale = (incoming.searchParams.get("locale") || "en").slice(0, 10);

  if (limit === null) {
    return jsonError(`limit must be an integer between 1 and ${MAX_LIMIT}.`, 400);
  }
  if (isReverse) {
    if (!point) {
      return jsonError("Reverse geocoding requires a valid point=lat,lon.", 400);
    }
  } else {
    if (!rawQuery) {
      return jsonError("q must not be empty.", 400);
    }
    if (rawQuery.length > MAX_QUERY_LEN) {
      return jsonError(`q must be ${MAX_QUERY_LEN} characters or fewer.`, 400);
    }
    if (incoming.searchParams.has("point") && !point) {
      return jsonError("point, when provided, must be a valid lat,lon.", 400);
    }
  }

  const upstream = new URL("https://graphhopper.com/api/1/geocode");
  if (isReverse) {
    upstream.searchParams.set("reverse", "true");
    upstream.searchParams.set("point", point);
  } else {
    upstream.searchParams.set("q", rawQuery);
    if (point) upstream.searchParams.set("point", point);
  }
  upstream.searchParams.set("limit", String(limit));
  upstream.searchParams.set("locale", locale);
  upstream.searchParams.set("key", env.GRAPHHOPPER_API_KEY);

  // GEOCODE_TIMEOUT_MS_OVERRIDE only exists so tests can exercise the
  // timeout path in milliseconds instead of seconds; real deployments never
  // set it and fall back to the normal constant.
  const timeoutMs = Number(env.GEOCODE_TIMEOUT_MS_OVERRIDE) || UPSTREAM_TIMEOUT_MS;
  let resp;
  try {
    resp = await fetchWithTimeout(upstream.toString(), timeoutMs);
  } catch (e) {
    // Never interpolate the upstream URL/error into the response or logs —
    // both can contain the API key as a query param.
    if (e && e.name === "AbortError") {
      return jsonError("Geocoding service took too long to respond.", 504);
    }
    console.warn("Geocoding upstream unreachable.");
    return jsonError("Upstream geocoding service unreachable.", 502);
  }

  if (!resp.ok) {
    console.warn("Geocoding upstream returned", resp.status);
    return jsonError("Upstream geocoding service returned an error.", 502);
  }

  let data;
  try {
    data = await resp.json();
  } catch (e) {
    return jsonError("Upstream geocoding service returned a malformed response.", 502);
  }

  const hits = Array.isArray(data.hits) ? data.hits.map(pickHitFields) : [];
  return new Response(JSON.stringify({ hits }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS_HEADERS },
  });
}
