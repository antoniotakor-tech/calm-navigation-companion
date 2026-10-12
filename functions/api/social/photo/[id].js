// GET /api/social/photo/:id — the post's photo as an image (cached; hidden posts return 404).
import { ensureSocialTables, requireDb, CORS_HEADERS } from "../_db.js";

export async function onRequestGet({ env, params }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;
  await ensureSocialTables(env.DB);
  const row = await env.DB.prepare("SELECT photo FROM posts WHERE id = ? AND status = 'visible'").bind(params.id).first();
  const m = row && row.photo && /^data:(image\/[a-z]+);base64,(.+)$/.exec(row.photo);
  if (!m) return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  return new Response(bytes, { headers: { "content-type": m[1], "cache-control": "public, max-age=3600", ...CORS_HEADERS } });
}
