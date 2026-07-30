// Cloudflare Pages Function — proxy for Transitous (transitous.org), the
// free, open, community-run MOTIS journey planner. Its Dutch feeds cover
// trains, metro, trams, buses, and the ferries — which is exactly the
// "public transport options" this app offers alongside its own calm
// walking/cycling routes.
//
// Same proxy discipline as route.js/geocode.js/pois.js: fixed upstream
// query (only from/to coordinates come from the client), whitelisted
// response fields, honest error statuses, and an identifying User-Agent
// per the service's fair-use policy. No API key exists for this service —
// the proxy is about shaping/limiting, not secrets.
//
// GET /api/transit?from=lat,lon&to=lat,lon
// -> { itineraries: [{ durationS, startTime, endTime, transfers,
//      legs: [{ mode, route, headsign, fromName, toName,
//               startTime, endTime, points, precision }] }] }

const UPSTREAM = "https://api.transitous.org/api/v3/plan";
const UPSTREAM_TIMEOUT_MS = 12000;
const MAX_ITINERARIES = 4;
const MAX_LEGS = 12;

const CORS_HEADERS = { "access-control-allow-origin": "*" };

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS_HEADERS },
  });
}

/** Parses/validates "lat,lon". Exported for tests. */
export function parsePoint(raw) {
  if (typeof raw !== "string") return null;
  const parts = raw.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return null;
  const [lat, lon] = parts;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/** Shapes one upstream leg to the whitelisted record, or null if unusable. Exported for tests. */
export function normalizeLeg(leg) {
  if (!leg || typeof leg !== "object" || typeof leg.mode !== "string") return null;
  const geom = leg.legGeometry || {};
  return {
    mode: leg.mode,
    route: typeof leg.routeShortName === "string" ? leg.routeShortName.slice(0, 12) : null,
    headsign: typeof leg.headsign === "string" ? leg.headsign.slice(0, 60) : null,
    fromName: leg.from && typeof leg.from.name === "string" ? leg.from.name.slice(0, 80) : "",
    toName: leg.to && typeof leg.to.name === "string" ? leg.to.name.slice(0, 80) : "",
    startTime: typeof leg.startTime === "string" ? leg.startTime : null,
    endTime: typeof leg.endTime === "string" ? leg.endTime : null,
    points: typeof geom.points === "string" ? geom.points : null,
    precision: Number.isInteger(geom.precision) ? geom.precision : 6,
  };
}

/** Shapes one itinerary, or null if it has no usable legs. Exported for tests. */
export function normalizeItinerary(it) {
  if (!it || typeof it !== "object") return null;
  const legs = (Array.isArray(it.legs) ? it.legs : []).map(normalizeLeg).filter(Boolean).slice(0, MAX_LEGS);
  if (!legs.length) return null;
  return {
    durationS: Number.isFinite(it.duration) ? Math.round(it.duration) : null,
    startTime: typeof it.startTime === "string" ? it.startTime : null,
    endTime: typeof it.endTime === "string" ? it.endTime : null,
    transfers: Number.isInteger(it.transfers) ? it.transfers : 0,
    legs,
  };
}

export async function onRequestGet(context) {
  const { request } = context;
  const incoming = new URL(request.url);
  const from = parsePoint(incoming.searchParams.get("from"));
  const to = parsePoint(incoming.searchParams.get("to"));
  if (!from || !to) return jsonError("from and to must each be lat,lon.", 400);

  const upstream = new URL(UPSTREAM);
  upstream.searchParams.set("fromPlace", `${from.lat},${from.lon}`);
  upstream.searchParams.set("toPlace", `${to.lat},${to.lon}`);
  upstream.searchParams.set("arriveBy", "false");

  let resp;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    resp = await fetch(upstream.toString(), {
      headers: { "user-agent": "CalmNavigationCompanion/1.0 (https://calm-navigation-companion.pages.dev)" },
      signal: controller.signal,
    });
  } catch (e) {
    console.warn("Transit upstream fetch failed:", e && e.message);
    return jsonError("Journey planner unreachable.", 502);
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    console.warn("Transit upstream non-ok status:", resp.status);
    return jsonError("Journey planner is busy right now.", 502);
  }

  let data;
  try {
    data = await resp.json();
  } catch (e) {
    return jsonError("Journey planner returned an unreadable response.", 502);
  }

  const itineraries = (Array.isArray(data.itineraries) ? data.itineraries : [])
    .map(normalizeItinerary)
    .filter(Boolean)
    .slice(0, MAX_ITINERARIES);

  return new Response(JSON.stringify({ itineraries }), {
    headers: {
      "content-type": "application/json",
      // Departure times go stale fast — cache only briefly at the edge to
      // absorb double-taps, never long enough to show yesterday's tram.
      "cache-control": "public, max-age=30",
      ...CORS_HEADERS,
    },
  });
}
