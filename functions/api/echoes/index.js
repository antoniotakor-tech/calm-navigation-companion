// Cloudflare Pages Function — POST /api/echoes (Create Echo).
//
// Validates with the exact same rules echorecorder.js applies client-side
// (echovalidation.js), but treats the client as untrusted: every check here
// re-runs regardless of what the client claims to have already verified.
// The raw creatorToken is hashed immediately and never stored or logged —
// only its SHA-256 hex digest ever reaches D1 (see migrations/0001_create_echoes.sql).
import EchoValidation from "../../../echovalidation.js";
import { jsonError, jsonResponse, parseJsonBody, requireDb, CORS_HEADERS } from "./_util.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const dbError = requireDb(env);
  if (dbError) return dbError;

  const body = await parseJsonBody(request);
  const check = EchoValidation.validateEchoCreatePayload(body);
  if (!check.valid) return jsonError(check.error, 400);
  const value = check.value;

  const creatorTokenHash = await EchoValidation.hashCreatorToken(value.creatorToken);
  const now = Date.now();

  const rateLimitRow = await env.DB
    .prepare("SELECT COUNT(*) AS c FROM echoes WHERE creator_token_hash = ? AND created_at > ?")
    .bind(creatorTokenHash, now - EchoValidation.MS_PER_DAY)
    .first();
  if (EchoValidation.isRateLimited(rateLimitRow ? rateLimitRow.c : 0)) {
    return jsonError("You've left the maximum number of Calm Echoes for today. Come back tomorrow.", 429);
  }

  const fuzzed = EchoValidation.fuzzLocation(value.lat, value.lon);
  const id = crypto.randomUUID();

  await env.DB
    .prepare(
      `INSERT INTO echoes
        (id, lat, lon, created_at, message, nickname, melody_json, duration_ms, creator_token_hash, moderation_status, play_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'visible', 0)`
    )
    .bind(id, fuzzed.lat, fuzzed.lon, now, value.message, value.nickname, JSON.stringify(value.melody), value.durationMs, creatorTokenHash)
    .run();

  return jsonResponse({ id, lat: fuzzed.lat, lon: fuzzed.lon, createdAt: now }, 201);
}
