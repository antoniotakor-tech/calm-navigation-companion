// POST /api/social/tracks { token|session, track } — add a song to your profile.
import SocialValidation from "../../../../socialvalidation.js";
import { FREE_LIMITS, PLUS_LIMITS, isPlus } from "../../auth/_store.js";
import { ensureSocialTables, identify, publicTrack, jsonError, jsonResponse, parseJsonBody, requireDb, CORS_HEADERS } from "../_db.js";

export async function onRequestOptions() { return new Response(null, { status: 204, headers: CORS_HEADERS }); }

export async function onRequestPost({ request, env }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;
  const body = await parseJsonBody(request);
  const who = await identify(body, env.DB);
  if (!who) return jsonError("Missing device key.", 400);
  const check = SocialValidation.validateTrack(body && body.track);
  if (!check.valid) return jsonError(check.error, 400);
  await ensureSocialTables(env.DB);
  const profile = await env.DB.prepare("SELECT nickname FROM profiles WHERE owner_hash = ?").bind(who.ownerHash).first();
  if (!profile) return jsonError("Create your profile first (Community tab).", 403);
  const now = Date.now();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS c FROM tracks WHERE owner_hash = ? AND created_at > ?").bind(who.ownerHash, now - 86400000).first();
  const limit = isPlus(who.account) ? PLUS_LIMITS.postsPerDay : FREE_LIMITS.postsPerDay;
  if (recent && recent.c >= limit) return jsonError(`That's ${limit} songs today — come back tomorrow.`, 429);
  const v = check.value, id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO tracks (id, owner_hash, author_key, title, audio, fx, pattern, ms, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'visible')")
    .bind(id, who.ownerHash, who.authorKey, v.title, v.audio, v.fx, v.pattern, v.ms, now).run();
  return jsonResponse({ track: publicTrack({ id, title: v.title, fx: v.fx, pattern: v.pattern, ms: v.ms, created_at: now, author_key: who.authorKey }) }, 201);
}
