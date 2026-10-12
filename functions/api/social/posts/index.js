// GET  /api/social/posts?lat=&lon=&radius=  — nearby timeline (newest first)
// POST /api/social/posts { token, post }     — share a spot / route / event
import SocialValidation from "../../../../socialvalidation.js";
import EchoValidation from "../../../../echovalidation.js";
import { FREE_LIMITS, PLUS_LIMITS, isPlus } from "../../auth/_store.js";
import { ensureSocialTables, identify, publicPost, POST_COLUMNS, jsonError, jsonResponse, parseJsonBody, requireDb, CORS_HEADERS } from "../_db.js";

export async function onRequestOptions() { return new Response(null, { status: 204, headers: CORS_HEADERS }); }

export async function onRequestGet({ request, env }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat")), lon = Number(url.searchParams.get("lon"));
  if (!EchoValidation.isValidLatLon(lat, lon)) return jsonError("lat and lon are required.", 400);
  const radius = Math.min(25000, Math.max(500, Number(url.searchParams.get("radius")) || 8000));
  await ensureSocialTables(env.DB);
  const bb = EchoValidation.boundingBox(lat, lon, radius);
  const { results } = await env.DB.prepare(
    `SELECT ${POST_COLUMNS} FROM posts p JOIN profiles pr ON pr.owner_hash = p.owner_hash
     WHERE p.status = 'visible' AND p.lat BETWEEN ? AND ? AND p.lon BETWEEN ? AND ?
       AND (p.event_at IS NULL OR p.event_at > ?)
     ORDER BY p.created_at DESC LIMIT 60`
  ).bind(bb.minLat, bb.maxLat, bb.minLon, bb.maxLon, Date.now() - 6 * 3600 * 1000).all();
  return jsonResponse({ posts: (results || []).map((r) => publicPost(r)) });
}

export async function onRequestPost({ request, env }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;
  const body = await parseJsonBody(request);
  const who = await identify(body, env.DB);
  if (!who) return jsonError("Missing device key.", 400);
  const check = SocialValidation.validatePost(body.post);
  if (!check.valid) return jsonError(check.error, 400);
  await ensureSocialTables(env.DB);
  const profile = await env.DB.prepare("SELECT nickname, avatar FROM profiles WHERE owner_hash = ?").bind(who.ownerHash).first();
  if (!profile) return jsonError("Create your profile first.", 403);
  const now = Date.now();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS c FROM posts WHERE owner_hash = ? AND created_at > ?").bind(who.ownerHash, now - 86400000).first();
  const limit = isPlus(who.account) ? PLUS_LIMITS.postsPerDay : FREE_LIMITS.postsPerDay;
  if (recent && recent.c >= limit) return jsonError(isPlus(who.account) ? "That's the most posts for today — come back tomorrow." : `That's ${limit} posts today — come back tomorrow, or get Calm+ for more.`, 429);
  const v = check.value, id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO posts (id, owner_hash, author_key, kind, title, body, lat, lon, route_json, event_at, photo, created_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'visible')`
  ).bind(id, who.ownerHash, who.authorKey, v.kind, v.title, v.body, v.lat, v.lon, v.route ? JSON.stringify(v.route) : null, v.eventAt, v.photo, now).run();
  return jsonResponse({ post: publicPost({ id, author_key: who.authorKey, kind: v.kind, title: v.title, body: v.body, lat: v.lat, lon: v.lon, route_json: v.route ? JSON.stringify(v.route) : null, event_at: v.eventAt, has_photo: !!v.photo, created_at: now }, { ...profile, plus: isPlus(who.account) }) }, 201);
}
