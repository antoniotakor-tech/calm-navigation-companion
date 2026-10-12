// POST /api/account { session, action: "get" | "logout" | "delete" | "sync-get" | "sync-put" | "notify-plus", data? }
// "delete" removes the account, its passkeys and sessions, and the community
// profile + posts it owns (App Store 5.1.1(v)). Sync is a Calm+ perk.
import { ensureAuthTables, accountFromSession, endSession, publicAccount, isPlus, jsonError, jsonResponse, parseJsonBody, requireDb, CORS_HEADERS } from "../auth/_store.js";
import { ensureSocialTables } from "../social/_db.js";

export async function onRequestOptions() { return new Response(null, { status: 204, headers: CORS_HEADERS }); }

const MAX_SYNC_CHARS = 64 * 1024;

export async function onRequestPost({ request, env }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;
  const body = (await parseJsonBody(request)) || {};
  await ensureAuthTables(env.DB);
  const a = await accountFromSession(env.DB, body.session);
  if (!a) return jsonError("Signed out — please sign in again.", 401);
  const count = async () => ((await env.DB.prepare("SELECT COUNT(*) AS c FROM passkeys WHERE account_id = ?").bind(a.id).first()) || { c: 0 }).c;

  switch (body.action || "get") {
    case "get":
      return jsonResponse({ account: publicAccount(a, await count()) });
    case "logout":
      await endSession(env.DB, body.session);
      return jsonResponse({ signedOut: true });
    case "delete": {
      await ensureSocialTables(env.DB);
      for (const [sql, arg] of [
        ["DELETE FROM posts WHERE owner_hash = ?", a.owner_hash],
        ["DELETE FROM tracks WHERE owner_hash = ?", a.owner_hash],
        ["DELETE FROM profiles WHERE owner_hash = ?", a.owner_hash],
        ["DELETE FROM passkeys WHERE account_id = ?", a.id],
        ["DELETE FROM sessions WHERE account_id = ?", a.id],
        ["DELETE FROM accounts WHERE id = ?", a.id],
      ]) await env.DB.prepare(sql).bind(arg).run();
      return jsonResponse({ deleted: true, note: a.stripe_customer ? "If you had Calm+, cancel it in the billing page too." : undefined });
    }
    case "sync-get":
      if (!isPlus(a)) return jsonError("Sync between devices is part of Calm+.", 402);
      return jsonResponse({ data: a.sync_json ? JSON.parse(a.sync_json) : null, syncAt: a.sync_at || null });
    case "sync-put": {
      if (!isPlus(a)) return jsonError("Sync between devices is part of Calm+.", 402);
      const json = JSON.stringify(body.data || {});
      if (json.length > MAX_SYNC_CHARS) return jsonError("Too much data to sync.", 413);
      const now = Date.now();
      await env.DB.prepare("UPDATE accounts SET sync_json = ?, sync_at = ? WHERE id = ?").bind(json, now, a.id).run();
      return jsonResponse({ syncAt: now });
    }
    case "notify-plus":
      await env.DB.prepare("INSERT OR IGNORE INTO plus_waitlist (who, created_at) VALUES (?, ?)").bind(a.id, Date.now()).run();
      return jsonResponse({ ok: true });
    default:
      return jsonError("Unknown action.", 400);
  }
}
