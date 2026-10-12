// Cloudflare Pages Function — POST /api/echoes/:id/report (2026-10-12).
//
// The "report" half of App Store guideline 1.2 for user-generated content.
// A report hides the Echo for everyone as soon as REPORT_HIDE_THRESHOLD
// distinct people have reported it (1 — see echovalidation.js for why), and
// every report is kept in echo_reports so the owner can review them.
// Reporter tokens are hashed exactly like creator tokens; the raw token is
// never stored. One reporter can file at most DAILY_REPORT_LIMIT reports per
// day, so a single person can't wipe every Echo off the map.
import EchoValidation from "../../../../echovalidation.js";
import { jsonError, jsonResponse, parseJsonBody, requireDb, CORS_HEADERS } from "../_util.js";

let reportsTableReady = false;
export async function ensureReportsTable(db) {
  if (reportsTableReady) return;
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS echo_reports (echo_id TEXT NOT NULL, reporter_hash TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (echo_id, reporter_hash))"
  ).bind().run();
  reportsTableReady = true;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env, params } = context;
  const dbError = requireDb(env);
  if (dbError) return dbError;

  const id = params.id;
  if (!id) return jsonError("Missing Echo id.", 400);

  const body = await parseJsonBody(request);
  const reporterToken = body && typeof body.reporterToken === "string" ? body.reporterToken : "";
  if (reporterToken.length < 8 || reporterToken.length > 200) return jsonError("reporterToken is required.", 400);
  const reason = body && body.reason;
  if (!EchoValidation.REPORT_REASONS.includes(reason)) {
    return jsonError(`reason must be one of: ${EchoValidation.REPORT_REASONS.join(", ")}.`, 400);
  }

  const row = await env.DB.prepare("SELECT id FROM echoes WHERE id = ?").bind(id).first();
  if (!row) return jsonError("Echo not found.", 404);

  await ensureReportsTable(env.DB);
  const reporterHash = await EchoValidation.hashCreatorToken(reporterToken);
  const now = Date.now();

  const recent = await env.DB
    .prepare("SELECT COUNT(*) AS c FROM echo_reports WHERE reporter_hash = ? AND created_at > ?")
    .bind(reporterHash, now - EchoValidation.MS_PER_DAY)
    .first();
  if (recent && recent.c >= EchoValidation.DAILY_REPORT_LIMIT) {
    return jsonError("You've sent a lot of reports today. Thank you — please email us if something urgent needs attention.", 429);
  }

  await env.DB
    .prepare("INSERT OR IGNORE INTO echo_reports (echo_id, reporter_hash, reason, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, reporterHash, reason, now)
    .run();

  const count = await env.DB.prepare("SELECT COUNT(*) AS c FROM echo_reports WHERE echo_id = ?").bind(id).first();
  let hidden = false;
  if (count && count.c >= EchoValidation.REPORT_HIDE_THRESHOLD) {
    await env.DB.prepare("UPDATE echoes SET moderation_status = 'hidden' WHERE id = ?").bind(id).run();
    hidden = true;
  }
  return jsonResponse({ reported: true, hidden });
}
