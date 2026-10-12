// POST /api/social/tracks/:id/report { reporterToken, reason } — one report hides the song (same rule as posts).
import EchoValidation from "../../../../../echovalidation.js";
import { ensureSocialTables, jsonError, jsonResponse, parseJsonBody, requireDb, CORS_HEADERS } from "../../_db.js";

export async function onRequestOptions() { return new Response(null, { status: 204, headers: CORS_HEADERS }); }

export async function onRequestPost({ request, env, params }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;
  const body = (await parseJsonBody(request)) || {};
  const token = typeof body.reporterToken === "string" ? body.reporterToken : "";
  if (token.length < 8 || token.length > 200) return jsonError("reporterToken is required.", 400);
  if (!EchoValidation.REPORT_REASONS.includes(body.reason)) return jsonError("Unknown reason.", 400);
  await ensureSocialTables(env.DB);
  const hash = await EchoValidation.hashCreatorToken(token);
  const now = Date.now();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS c FROM track_reports WHERE reporter_hash = ? AND created_at > ?").bind(hash, now - EchoValidation.MS_PER_DAY).first();
  if (recent && recent.c >= EchoValidation.DAILY_REPORT_LIMIT) return jsonError("You've sent a lot of reports today.", 429);
  await env.DB.prepare("INSERT OR IGNORE INTO track_reports (track_id, reporter_hash, reason, created_at) VALUES (?, ?, ?, ?)").bind(params.id, hash, body.reason, now).run();
  await env.DB.prepare("UPDATE tracks SET status = 'hidden' WHERE id = ?").bind(params.id).run();
  return jsonResponse({ reported: true, hidden: true });
}
