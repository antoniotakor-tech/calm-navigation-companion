// Cloudflare Pages Function — proxy for OpenStreetMap's Overpass API,
// fetching shops and restaurants/cafés for a small visible map area.
//
// Same proxy-not-passthrough philosophy as route.js/geocode.js, applied to
// an API that needs protecting for a different reason: Overpass is a free,
// shared, donation-run community service with no API key at all, so the
// thing to guard is *their* capacity, not a secret of ours. Hence:
//   - bbox area is hard-capped (a neighborhood, never a whole city),
//   - the query is fixed server-side (only the bbox comes from the client —
//     no client-supplied Overpass QL, ever),
//   - results are capped and whitelisted to the fields the map needs,
//   - responses carry cache headers so Cloudflare's edge + the browser
//     absorb repeat views of the same area instead of Overpass.
//
// GET /api/pois?bbox=minLat,minLon,maxLat,maxLon
// -> { pois: [{ id, lat, lon, name, kind }] }

// Ordered fallback chain: the public overpass-api.de instance rate-limits
// aggressively under bursty use, which surfaced as "the shops just aren't
// there" on device. Each mirror is tried in order until one answers; all
// are established public Overpass instances.
const UPSTREAMS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const UPSTREAM_TIMEOUT_MS = 6000;
// Deliberately BELOW the query's own [timeout:8] server budget: verified
// 2026-09-09 that all three public Overpass mirrors refuse this Worker
// outright (Overpass rate-limits per IP; Workers egress from Cloudflare's
// shared pool). The same query returns 200 in 2.2-6.3s from a home IP.
// Since upstream failure is currently the norm, failing fast beats waiting
// longer for the same 502. Raise this above 8000 only once POIs are served
// from a source that actually answers us — see PROJECT_STATUS.md.
const MAX_FOOD = 400;
const MAX_SHOPS = 400;
const MAX_TRANSIT = 150;
const MAX_RESULTS = MAX_FOOD + MAX_SHOPS + MAX_TRANSIT;
// Neighborhood-sized backstop: the client clamps its query area to roughly
// ±0.0125° around the map center and grid-snaps outward (see app.js's
// poiGridBbox), which worst-cases near 0.035° x 0.035° ≈ 0.0012 deg².
// Anything bigger than 0.0015 deg² (~4 km x 3 km) is not a neighborhood
// view and gets rejected rather than forwarded to Overpass.
const MAX_BBOX_AREA_DEG2 = 0.0015;

// The amenity values that count as "restaurants" for this feature — eating
// and drinking places, not every amenity OSM knows about.
const FOOD_AMENITIES = "restaurant|cafe|fast_food|ice_cream|bar|pub|biergarten|food_court|nightclub";
// Public-transport places (2026-07-30, user request): ferry terminals,
// train/metro stations, tram stops, bus stops — the places themselves;
// transit ROUTING is a separate concern this endpoint doesn't attempt.
const TRANSIT_RAILWAY = "station|tram_stop|halt|subway_entrance";

const CORS_HEADERS = { "access-control-allow-origin": "*" };

// ---- Persistent area cache in D1 (2026-10-10) ----------------------------
// The public Overpass mirrors refuse or time out on roughly half of all
// requests (measured: 3 of 6, some refused in ~0.1s), which left the map
// with no cafés/shops half the time. Every good answer is now stored per
// area in the app's existing D1 database (binding DB, also used by Calm
// Echoes), so:
//   - a fresh copy (< POI_FRESH_MS) is served straight from D1, never
//     touching Overpass at all;
//   - when Overpass fails, the last good copy (< POI_STALE_MAX_MS) is served
//     instead of an error.
// Shops and cafés change on a scale of weeks, so a day-old answer is fine.
// Every DB step is best-effort: if D1 is missing or errors, this endpoint
// behaves exactly as it did before the cache existed.
const POI_FRESH_MS = 24 * 60 * 60 * 1000;
const POI_STALE_MAX_MS = 30 * 24 * 60 * 60 * 1000;
let poiTableReady = false;

async function ensurePoiTable(db) {
  if (poiTableReady) return;
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS poi_cache (k TEXT PRIMARY KEY, body TEXT NOT NULL, fetched_at INTEGER NOT NULL)"
  ).run();
  poiTableReady = true;
}

async function readPoiCache(db, key) {
  if (!db) return null;
  try {
    await ensurePoiTable(db);
    return await db.prepare("SELECT body, fetched_at FROM poi_cache WHERE k = ?").bind(key).first();
  } catch (e) {
    console.warn("poi_cache read failed:", e && e.message);
    return null;
  }
}

async function writePoiCache(db, key, body) {
  if (!db) return;
  try {
    await ensurePoiTable(db);
    await db.prepare("INSERT OR REPLACE INTO poi_cache (k, body, fetched_at) VALUES (?, ?, ?)")
      .bind(key, body, Date.now()).run();
  } catch (e) {
    console.warn("poi_cache write failed:", e && e.message);
  }
}

function poiResponse(body, cacheState) {
  return new Response(body, {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=600",
      "x-poi-cache": cacheState,
      ...CORS_HEADERS,
    },
  });
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS_HEADERS },
  });
}

/**
 * Parses/validates "minLat,minLon,maxLat,maxLon". Returns the numeric bbox
 * or null. Exported for tests.
 */
export function parseBbox(raw) {
  if (typeof raw !== "string") return null;
  const parts = raw.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [minLat, minLon, maxLat, maxLon] = parts;
  if (minLat < -90 || maxLat > 90 || minLon < -180 || maxLon > 180) return null;
  if (minLat >= maxLat || minLon >= maxLon) return null;
  if ((maxLat - minLat) * (maxLon - minLon) > MAX_BBOX_AREA_DEG2) return null;
  return { minLat, minLon, maxLat, maxLon };
}

/**
 * Shapes one Overpass element into the whitelisted marker record, or null
 * if it isn't usable (no coordinates or no name — an unnamed POI dot the
 * user can't identify is clutter, not information). Exported for tests.
 */
export function normalizePoi(el) {
  if (!el || typeof el !== "object") return null;
  const lat = el.lat != null ? el.lat : (el.center && el.center.lat);
  const lon = el.lon != null ? el.lon : (el.center && el.center.lon);
  const tags = el.tags || {};
  const isTransit = tags.amenity === "ferry_terminal" || tags.railway != null || tags.highway === "bus_stop";
  let name = typeof tags.name === "string" ? tags.name.trim() : "";
  // Transit stops are worth showing even unnamed (a ferry dock IS its
  // location); shops/restaurants without names stay filtered as clutter.
  if (!name && isTransit) {
    name = tags.amenity === "ferry_terminal" ? "Ferry" : tags.railway ? "Station" : "Bus stop";
  }
  if (typeof lat !== "number" || typeof lon !== "number" || !name) return null;
  const kind = isTransit ? "transit" : tags.shop ? "shop" : "food";
  return { id: `${el.type || "node"}/${el.id}`, lat, lon, name: name.slice(0, 80), kind };
}

export async function onRequestGet(context) {
  const { request } = context;
  const incoming = new URL(request.url);
  const bbox = parseBbox(incoming.searchParams.get("bbox"));
  if (!bbox) {
    return jsonError("bbox must be minLat,minLon,maxLat,maxLon covering at most a neighborhood-sized area.", 400);
  }

  const bboxQL = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
  const db = context.env && context.env.DB;
  const cacheKey = [bbox.minLat, bbox.minLon, bbox.maxLat, bbox.maxLon].map((v) => Number(v).toFixed(4)).join(",");
  const cached = await readPoiCache(db, cacheKey);
  const cacheAge = cached ? Date.now() - Number(cached.fetched_at) : Infinity;
  if (cached && cacheAge < POI_FRESH_MS) return poiResponse(cached.body, "hit");
  // Fixed query, bbox-only interpolation. `out center` makes ways (a shop
  // mapped as a building outline) come back with a usable single point.
  const query = `[out:json][timeout:8];(node["shop"]["name"](${bboxQL});way["shop"]["name"](${bboxQL});node["amenity"~"^(${FOOD_AMENITIES})$"]["name"](${bboxQL});way["amenity"~"^(${FOOD_AMENITIES})$"]["name"](${bboxQL});node["amenity"="ferry_terminal"](${bboxQL});way["amenity"="ferry_terminal"](${bboxQL});node["railway"~"^(${TRANSIT_RAILWAY})$"](${bboxQL});node["highway"="bus_stop"](${bboxQL}););out center ${MAX_RESULTS * 2};`;

  // Mirrors are raced in PARALLEL, not tried one after another.
  //
  // Changed 2026-09-03 after the app was reported as laggy. The sequential
  // loop cost (mirrors x per-request timeout) in the worst case — measured
  // 19-21s in production, every time, because Overpass was refusing all
  // three. The client waits on this, so the whole app felt frozen.
  // Racing bounds the wait at ONE timeout regardless of how many mirrors
  // there are, and the fastest healthy mirror wins instead of whichever
  // happens to be first in the list.
  const raceOne = async (upstream) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const attempt = await fetch(upstream, {
        method: "POST",
        body: "data=" + encodeURIComponent(query),
        headers: {
          // Overpass's usage policy asks every client to identify itself, and
          // their servers reject anonymous/UA-less requests (workerd sends no
          // default User-Agent — this header is load-bearing, not courtesy).
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "CalmNavigationCompanion/1.0 (https://calm-navigation-companion.pages.dev)",
        },
        signal: controller.signal,
      });
      // Promise.any resolves on the first NON-rejecting promise, so a non-ok
      // response has to reject or a 429 would beat a healthy mirror's 200.
      if (!attempt.ok) throw new Error("upstream status " + attempt.status);
      return attempt;
    } finally {
      clearTimeout(timer); // also on the error path — a leaked timer pins the runtime alive
    }
  };

  let resp = null;
  try {
    resp = await Promise.any(UPSTREAMS.map(raceOne));
  } catch (e) {
    // AggregateError: every mirror failed or timed out.
    console.warn("All %s upstream mirrors failed or timed out.", UPSTREAMS.length);
  }
  if (!resp) {
    if (cached && cacheAge < POI_STALE_MAX_MS) return poiResponse(cached.body, "stale");
    return jsonError("POI service is busy right now.", 502);
  }

  let data;
  try {
    data = await resp.json();
  } catch (e) {
    if (cached && cacheAge < POI_STALE_MAX_MS) return poiResponse(cached.body, "stale");
    return jsonError("POI service returned an unreadable response.", 502);
  }

  const all = (Array.isArray(data.elements) ? data.elements : [])
    .map(normalizePoi)
    .filter(Boolean);
  const byKind = { food: [], shop: [], transit: [] };
  all.forEach((p) => { if (byKind[p.kind]) byKind[p.kind].push(p); });
  const pois = [
    ...byKind.food.slice(0, MAX_FOOD),
    ...byKind.shop.slice(0, MAX_SHOPS),
    ...byKind.transit.slice(0, MAX_TRANSIT),
  ];

  const body = JSON.stringify({ pois });
  // Don't make the user wait on the DB write.
  const write = writePoiCache(db, cacheKey, body);
  if (context.waitUntil) context.waitUntil(write); else await write;
  return poiResponse(body, "miss");
}
