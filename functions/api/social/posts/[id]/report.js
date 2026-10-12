// POST /api/social/posts/:id/report { reporterToken, reason } — one report hides the post (same rule as Echoes).
import EchoValidation from "../../../../../echovalidation.js";
import { ensureSocialTables, jsonError, jsonResponse, parseJsonBody, requireDb, CORS_HEADERS } from "../../_db.js";

export async function onRequestOptions() { return new Response(null, { status: 204, headers: CORS_HEADERS }); }

export async function onRequestPost({ request, env, params }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;
  const body = await parseJsonBody(request);
  const token = body && typeof body.reporterToken === "string" ? body.reporterToken : "";
  if (token.length < 8 || token.length > 200) return jsonError("reporterToken is required.", 400);
  if (!EchoValidation.REPORT_REASONS.includes(body.reason)) return jsonError("Unknown reason.", 400);
  await ensureSocialTables(env.DB);
  const row = await env.DB.prepare("SELECT id FROM posts WHERE id = ?").bind(params.id).first();
  if (!row) return jsonError("Post not found.", 404);
  const reporterHash = await EchoValidation.hashCreatorToken(token);
  const now = Date.now();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS c FROM post_reports WHERE reporter_hash = ? AND created_at > ?").bind(reporterHash, now - EchoValidation.MS_PER_DAY).first();
  if (recent && recent.c >= EchoValidation.DAILY_REPORT_LIMIT) return jsonError("You've sent a lot of reports today — please email us if it's urgent.", 429);
  await env.DB.prepare("INSERT OR IGNORE INTO post_reports (post_id, reporter_hash, reason, created_at) VALUES (?, ?, ?, ?)").bind(params.id, reporterHash, body.reason, now).run();
  const count = await env.DB.prepare("SELECT COUNT(*) AS c FROM post_reports WHERE post_id = ?").bind(params.id).first();
  const hidden = !!(count && count.c >= EchoValidation.REPORT_HIDE_THRESHOLD);
  if (hidden) await env.DB.prepare("UPDATE posts SET status = 'hidden' WHERE id = ?").bind(params.id).run();
  return jsonResponse({ reported: true, hidden });
}
