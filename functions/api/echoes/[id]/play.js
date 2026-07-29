// Cloudflare Pages Function — POST /api/echoes/:id/play (Discovery playback).
//
// This is the ONLY endpoint that ever returns a melody. Fetching the nearby
// list (nearby.js) never reveals one — a melody is only released once a
// listener has explicitly chosen to press Play on a specific Echo, matching
// the spec's "never autoplay" rule structurally rather than by convention.
//
// Also the only place a "Someone discovered your Calm Echo" notification is
// created — and only when the listener isn't the Echo's own creator, so
// replaying your own Echo never notifies you about yourself. play_count is
// incremented for internal use only; no API response anywhere exposes it
// ("never show play counts publicly" — see migrations/0001_create_echoes.sql).
import EchoValidation from "../../../../echovalidation.js";
import { jsonError, jsonResponse, parseJsonBody, requireDb, CORS_HEADERS } from "../_util.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env, params } = context;
  const dbError = requireDb(env);
  if (dbError) return dbError;

  const id = params.id;
  if (!id) return jsonError("Missing Echo id.", 400);

  const row = await env.DB
    .prepare("SELECT message, melody_json, duration_ms, creator_token_hash, moderation_status FROM echoes WHERE id = ?")
    .bind(id)
    .first();
  if (!row || row.moderation_status !== "visible") return jsonError("Echo not found.", 404);

  const body = await parseJsonBody(request);
  const listenerToken = body && typeof body.listenerToken === "string" ? body.listenerToken : null;

  await env.DB.prepare("UPDATE echoes SET play_count = play_count + 1 WHERE id = ?").bind(id).run();

  if (listenerToken) {
    const listenerTokenHash = await EchoValidation.hashCreatorToken(listenerToken);
    if (listenerTokenHash !== row.creator_token_hash) {
      await env.DB
        .prepare("INSERT INTO echo_notifications (id, echo_id, creator_token_hash, created_at, seen) VALUES (?, ?, ?, ?, 0)")
        .bind(crypto.randomUUID(), id, row.creator_token_hash, Date.now())
        .run();
    }
  }

  let melody;
  try {
    melody = JSON.parse(row.melody_json);
  } catch (e) {
    return jsonError("This Echo's melody is corrupted and can't be played.", 500);
  }

  return jsonResponse({ melody, durationMs: row.duration_ms, message: row.message });
}
