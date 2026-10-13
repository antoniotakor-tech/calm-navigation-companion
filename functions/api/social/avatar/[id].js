// GET /api/social/avatar/:authorId — that profile's picture (2026-10-13).
// Hidden once the profile is reported enough to be hidden, like posts.
import { ensureSocialTables, requireDb, CORS_HEADERS } from "../_db.js";
import EchoValidation from "../../../../echovalidation.js";
import { jsonError, jsonResponse, parseJsonBody } from "../_db.js";

export async function onRequestGet({ env, params }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;
  await ensureSocialTables(env.DB);
  const row = await env.DB.prepare("SELECT pic FROM profiles WHERE author_key = ?").bind(params.id).first();
  const m = row && row.pic && /^data:(image\/[a-z]+);base64,(.+)$/.exec(row.pic);
  if (!m) return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  return new Response(bytes, { headers: { "content-type": m[1], "cache-control": "public, max-age=86400", ...CORS_HEADERS } });
}

// POST /api/social/avatar/:authorId { reporterToken } — report a profile
// picture. Like posts, one report takes it down at once (the person falls
// back to their flower); the report is kept for review.

export async function onRequestPost({ request, env, params }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;
  const body = await parseJsonBody(request);
  const t = body && body.reporterToken;
  if (typeof t !== "string" || t.length < 8 || t.length > 200) return jsonError("Missing device key.", 400);
  await ensureSocialTables(env.DB);
  const reporter = await EchoValidation.hashCreatorToken(t);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS avatar_reports (author_key TEXT NOT NULL, reporter_hash TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (author_key, reporter_hash))").bind().run();
  await env.DB.prepare("INSERT OR IGNORE INTO avatar_reports (author_key, reporter_hash, created_at) VALUES (?, ?, ?)").bind(params.id, reporter, Date.now()).run();
  await env.DB.prepare("UPDATE profiles SET pic = NULL WHERE author_key = ?").bind(params.id).run();
  return jsonResponse({ reported: true });
}
