// GET /api/social/tracks/:id/audio — the voice recording (the app adds the effect + beat).
import { ensureSocialTables, requireDb, CORS_HEADERS } from "../../_db.js";

export async function onRequestGet({ env, params }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;
  await ensureSocialTables(env.DB);
  const row = await env.DB.prepare("SELECT audio FROM tracks WHERE id = ? AND status = 'visible'").bind(params.id).first();
  const m = row && /^data:(audio\/[^;,]+)[^,]*;base64,(.+)$/.exec(row.audio);
  if (!m) return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  return new Response(bytes, { headers: { "content-type": m[1], "cache-control": "public, max-age=3600", ...CORS_HEADERS } });
}
