// Cloudflare Pages Function — GET /api/echoes/notifications?creatorToken=
//
// The only notification this feature ever sends: "Someone discovered your
// Calm Echo." Polled by the creator's own client (there is no push
// infrastructure here) — a fetch-and-consume pattern: every unseen
// notification returned by a call is marked seen in that same call, so a
// second poll never re-delivers it.
import EchoValidation from "../../../echovalidation.js";
import { jsonError, jsonResponse, requireDb, CORS_HEADERS } from "./_util.js";

const DISCOVERY_MESSAGE = "Someone discovered your Calm Echo.";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const dbError = requireDb(env);
  if (dbError) return dbError;

  const url = new URL(request.url);
  const creatorToken = url.searchParams.get("creatorToken");
  if (!creatorToken) return jsonError("creatorToken is required.", 400);
  const creatorTokenHash = await EchoValidation.hashCreatorToken(creatorToken);

  const { results } = await env.DB
    .prepare("SELECT id, echo_id, created_at FROM echo_notifications WHERE creator_token_hash = ? AND seen = 0")
    .bind(creatorTokenHash)
    .all();

  if (results && results.length > 0) {
    await env.DB.prepare("UPDATE echo_notifications SET seen = 1 WHERE creator_token_hash = ? AND seen = 0").bind(creatorTokenHash).run();
  }

  const notifications = (results || []).map((row) => ({
    id: row.id,
    echoId: row.echo_id,
    createdAt: row.created_at,
    message: DISCOVERY_MESSAGE,
  }));

  return jsonResponse({ notifications });
}
