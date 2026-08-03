// Cloudflare Pages Function — proxy for OpenStreetMap's Overpass API,
// fetching real green-space geometry (parks, woods, water, forest) for a
// route's bounding box. This is the "calm-by-measurement" data source:
// routing.js's road-class scoring is a heuristic (path/residential/motorway
// ranking); greenscore.js scores actual route points against the polygons
// this endpoint returns, instead of guessing "calm" from road type alone.
//
// Same proxy-not-passthrough philosophy as pois.js, applied to the same
// free/shared/no-key Overpass service:
//   - bbox area is hard-capped (a walking/biking route corridor, never a
//     whole city),
//   - the query is fixed server-side (only the bbox comes from the client),
//   - each way's geometry is simplified/capped so a sprawling coastline or
//     forest way can't balloon the response,
//   - responses carry cache headers so repeat views of the same area don't
//     re-hit Overpass.
//
// GET /api/greenspace?bbox=minLat,minLon,maxLat,maxLon
// -> { ways: [[[lon,lat], [lon,lat], ...], ...] }

const UPSTREAMS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const UPSTREAM_TIMEOUT_MS = 9000;

// A route corridor, not a neighborhood: pois.js caps at ~4km x 3km because
// it only needs the visible map viewport. A walking/biking route can span
// several kilometers, so this cap is wider — but still a hard ceiling
// (roughly 12km x 8km at Amsterdam's latitude) so a client bug or bad actor
// can't ask Overpass for a whole province.
const MAX_BBOX_AREA_DEG2 = 0.02;

const MAX_WAYS = 150;
// Coastlines/rivers/large forests can carry thousands of nodes for one way
// — stride-sampled down to this many points (keeping first/last) so one
// sprawling feature can't dominate the response budget.
const MAX_POINTS_PER_WAY = 150;
const MAX_TOTAL_POINTS = 6000;

const LEISURE = "park|garden|nature_reserve|recreation_ground|common";
const NATURAL = "wood|water|scrub|grassland";
const LANDUSE = "forest|grass|meadow|allotments|recreation_ground|village_green";

const CORS_HEADERS = { "access-control-allow-origin": "*" };

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
 * Stride-samples a point array down to at most `max` points, always keeping
 * the first and last point so the shape's endpoints (and closed-ring check
 * downstream in greenscore.js) survive simplification. Exported for tests.
 */
export function simplifyWay(points, max) {
  if (!Array.isArray(points) || points.length <= max) return points;
  const stride = Math.ceil(points.length / (max - 1));
  const out = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/**
 * Shapes one Overpass `out geom` way element into a plain [[lon,lat], ...]
 * array, or null if it has no usable geometry. Exported for tests.
 */
export function normalizeGreenWay(el) {
  if (!el || typeof el !== "object" || !Array.isArray(el.geometry) || el.geometry.length < 2) return null;
  const points = el.geometry
    .filter((g) => g && typeof g.lat === "number" && typeof g.lon === "number")
    .map((g) => [g.lon, g.lat]);
  if (points.length < 2) return null;
  return simplifyWay(points, MAX_POINTS_PER_WAY);
}

export async function onRequestGet(context) {
  const { request } = context;
  const incoming = new URL(request.url);
  const bbox = parseBbox(incoming.searchParams.get("bbox"));
  if (!bbox) {
    return jsonError("bbox must be minLat,minLon,maxLat,maxLon covering at most a route-sized area.", 400);
  }

  const bboxQL = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
  // Fixed query, bbox-only interpolation. `out geom` returns each way's full
  // node geometry inline (needed for real point-to-polygon distance math),
  // not just a center point like pois.js uses.
  const query = `[out:json][timeout:8];(way["leisure"~"^(${LEISURE})$"](${bboxQL});way["natural"~"^(${NATURAL})$"](${bboxQL});way["landuse"~"^(${LANDUSE})$"](${bboxQL}););out geom ${MAX_WAYS * 2};`;

  let resp = null;
  for (const upstream of UPSTREAMS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const attempt = await fetch(upstream, {
        method: "POST",
        body: "data=" + encodeURIComponent(query),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          // Overpass's usage policy asks every client to identify itself, and
          // their servers reject anonymous/UA-less requests (workerd sends no
          // default User-Agent — this header is load-bearing, not courtesy).
          "user-agent": "CalmNavigationCompanion/1.0 (https://calm-navigation-companion.pages.dev)",
        },
        signal: controller.signal,
      });
      if (attempt.ok) { resp = attempt; break; }
      console.warn("Greenspace upstream non-ok status, trying next mirror:", attempt.status);
    } catch (e) {
      console.warn("Greenspace upstream fetch failed, trying next mirror:", e && e.message);
    } finally {
      clearTimeout(timer);
    }
  }
  if (!resp) return jsonError("Green-space service is busy right now.", 502);

  let data;
  try {
    data = await resp.json();
  } catch (e) {
    return jsonError("Green-space service returned an unreadable response.", 502);
  }

  const ways = [];
  let totalPoints = 0;
  for (const el of Array.isArray(data.elements) ? data.elements : []) {
    if (ways.length >= MAX_WAYS || totalPoints >= MAX_TOTAL_POINTS) break;
    const way = normalizeGreenWay(el);
    if (!way) continue;
    ways.push(way);
    totalPoints += way.length;
  }

  return new Response(JSON.stringify({ ways }), {
    headers: {
      "content-type": "application/json",
      // Parks/woods/water don't move: reuse an area's answer for an hour
      // instead of re-asking Overpass (longer than pois.js's 10min — shops
      // open/close, green-space boundaries don't).
      "cache-control": "public, max-age=3600",
      ...CORS_HEADERS,
    },
  });
}
