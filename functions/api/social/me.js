// POST /api/social/me — { token, action: "get" | "save" | "delete", profile? }
// One endpoint for "my profile": read it, create/update it, or delete the
// account and everything posted with it (App Store 5.1.1(v) account deletion).
import SocialValidation from "../../../socialvalidation.js";
import { ensureSocialTables, identify, jsonError, jsonResponse, parseJsonBody, requireDb, CORS_HEADERS } from "./_db.js";

export async function onRequestOptions() { return new Response(null, { status: 204, headers: CORS_HEADERS }); }

export async function onRequestPost({ request, env }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;
  const body = await parseJsonBody(request);
  const who = await identify(body && body.token);
  if (!who) return jsonError("Missing device key.", 400);
  await ensureSocialTables(env.DB);
  const action = body.action || "get";

  if (action === "delete") {
    await env.DB.prepare("DELETE FROM posts WHERE owner_hash = ?").bind(who.ownerHash).run();
    await env.DB.prepare("DELETE FROM profiles WHERE owner_hash = ?").bind(who.ownerHash).run();
    return jsonResponse({ deleted: true });
  }

  if (action === "save") {
    const check = SocialValidation.validateProfile(body.profile);
    if (!check.valid) return jsonError(check.error, 400);
    const v = check.value, now = Date.now();
    await env.DB.prepare(
      `INSERT INTO profiles (owner_hash, author_key, nickname, bio, avatar, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_hash) DO UPDATE SET nickname = excluded.nickname, bio = excluded.bio, avatar = excluded.avatar, updated_at = excluded.updated_at`
    ).bind(who.ownerHash, who.authorKey, v.nickname, v.bio, v.avatar, now, now).run();
  }

  const row = await env.DB.prepare("SELECT nickname, bio, avatar, created_at FROM profiles WHERE owner_hash = ?").bind(who.ownerHash).first();
  return jsonResponse({ id: who.authorKey, profile: row ? { nickname: row.nickname, bio: row.bio, avatar: row.avatar, createdAt: row.created_at } : null });
}
