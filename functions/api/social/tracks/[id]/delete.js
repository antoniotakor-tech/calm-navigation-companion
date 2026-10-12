// POST /api/social/tracks/:id/delete { token|session } — remove your own song.
import { ensureSocialTables, identify, jsonError, jsonResponse, parseJsonBody, requireDb, CORS_HEADERS } from "../../_db.js";

export async function onRequestOptions() { return new Response(null, { status: 204, headers: CORS_HEADERS }); }

export async function onRequestPost({ request, env, params }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;
  const who = await identify(await parseJsonBody(request), env.DB);
  if (!who) return jsonError("Missing device key.", 400);
  await ensureSocialTables(env.DB);
  await env.DB.prepare("DELETE FROM tracks WHERE id = ? AND owner_hash = ?").bind(params.id, who.ownerHash).run();
  return jsonResponse({ deleted: true });
}
