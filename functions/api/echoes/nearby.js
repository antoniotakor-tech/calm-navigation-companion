// Cloudflare Pages Function — GET /api/echoes/nearby?lat=&lon=&radiusM=
// (Fetch nearby Echoes, for map discovery).
//
// Deliberately does NOT return the melody itself here — only enough to draw
// a marker and, once tapped, show the discovery detail sheet (message,
// distance, time created). The actual melody is only fetched by
// POST /api/echoes/:id/play, which is also the point a "someone discovered
// your Echo" notification gets created — matching the spec's "never
// autoplay" and "notify creators only when appropriate" rules by construction:
// there is no code path that reveals a melody without a real play request.
//
// Bounding-box prefilter (indexed lat/lon columns) then an exact haversine
// check, per migrations/0001_create_echoes.sql's own comment — SQLite has no
// native great-circle distance function.
//
// 48-hour visibility window (2026-08-03, direct request): Echoes older than
// this stop appearing here. Deliberately a HIDE, not a DELETE — no row is
// ever removed from D1 by this filter, so it's a one-line, fully reversible
// change (no destructive cron job, no data actually lost) rather than a
// real retention/cleanup policy. See CALM_ECHOES.md for the fuller writeup,
// including why hide-not-delete was chosen.
import EchoValidation from "../../../echovalidation.js";
import NavLogic from "../../../navlogic.js";
import { jsonError, jsonResponse, requireDb, CORS_HEADERS } from "./_util.js";

export const VISIBILITY_WINDOW_MS = 48 * 60 * 60 * 1000;

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const dbError = requireDb(env);
  if (dbError) return dbError;

  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!EchoValidation.isValidLatLon(lat, lon)) {
    return jsonError("lat/lon must be valid coordinates.", 400);
  }
  const radiusM = EchoValidation.clampNearbyRadius(url.searchParams.get("radiusM"));
  const box = EchoValidation.boundingBox(lat, lon, radiusM);

  const visibleSinceMs = Date.now() - VISIBILITY_WINDOW_MS;
  const { results } = await env.DB
    .prepare(
      `SELECT id, lat, lon, created_at, message FROM echoes
       WHERE moderation_status = 'visible' AND created_at > ? AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`
    )
    .bind(visibleSinceMs, box.minLat, box.maxLat, box.minLon, box.maxLon)
    .all();

  const echoes = (results || [])
    .map((row) => ({
      id: row.id,
      lat: row.lat,
      lon: row.lon,
      message: row.message,
      createdAt: row.created_at,
      distanceM: NavLogic.haversineM(lat, lon, row.lat, row.lon),
    }))
    .filter((echo) => echo.distanceM <= radiusM)
    .map((echo) => ({ ...echo, distanceM: Math.round(echo.distanceM) }));

  return jsonResponse({ echoes });
}
