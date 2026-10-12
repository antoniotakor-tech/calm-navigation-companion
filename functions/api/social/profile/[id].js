// GET /api/social/profile/:id — someone's public profile and their visible posts.
import { ensureSocialTables, publicPost, POST_COLUMNS, jsonError, jsonResponse, requireDb, CORS_HEADERS } from "../_db.js";

export async function onRequestOptions() { return new Response(null, { status: 204, headers: CORS_HEADERS }); }

export async function onRequestGet({ env, params }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;
  await ensureSocialTables(env.DB);
  const pr = await env.DB.prepare("SELECT nickname, bio, avatar, created_at FROM profiles WHERE author_key = ?").bind(params.id).first();
  if (!pr) return jsonError("Profile not found.", 404);
  const { results } = await env.DB.prepare(
    `SELECT ${POST_COLUMNS} FROM posts p JOIN profiles pr ON pr.owner_hash = p.owner_hash
     WHERE p.author_key = ? AND p.status = 'visible' ORDER BY p.created_at DESC LIMIT 50`
  ).bind(params.id).all();
  return jsonResponse({ id: params.id, profile: { nickname: pr.nickname, bio: pr.bio, avatar: pr.avatar, createdAt: pr.created_at }, posts: (results || []).map((r) => publicPost(r)) });
}
