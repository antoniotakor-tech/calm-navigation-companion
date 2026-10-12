// Shared helpers for /api/social/* (community profiles + timeline, 2026-10-12).
// Tables are created lazily (same approach as poi_cache / echo_reports) so no
// manual migration step is needed; migrations/0003_social.sql documents them.
import EchoValidation from "../../../echovalidation.js";
import { accountFromSession, ensureAuthTables } from "../auth/_store.js";
export { jsonError, jsonResponse, parseJsonBody, requireDb, CORS_HEADERS } from "../echoes/_util.js";

let ready = false;
export async function ensureSocialTables(db) {
  if (ready) return;
  await ensureAuthTables(db);
  const stmts = [
    "CREATE TABLE IF NOT EXISTS profiles (owner_hash TEXT PRIMARY KEY, author_key TEXT NOT NULL UNIQUE, nickname TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, author_key TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', lat REAL NOT NULL, lon REAL NOT NULL, route_json TEXT, event_at INTEGER, photo TEXT, created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'visible')",
    "CREATE INDEX IF NOT EXISTS posts_geo ON posts (lat, lon)",
    "CREATE INDEX IF NOT EXISTS posts_author ON posts (author_key, created_at)",
    "CREATE TABLE IF NOT EXISTS post_reports (post_id TEXT NOT NULL, reporter_hash TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (post_id, reporter_hash))",
  ];
  for (const s of stmts) await db.prepare(s).bind().run();
  ready = true;
}

/**
 * Who is calling: a signed-in account (session → the identity it adopted,
 * the same on every device) or else this device's private key.
 * Returns { ownerHash, authorKey, account } or null.
 */
export async function identify(body, db) {
  let account = null;
  if (body && body.session && db) account = await accountFromSession(db, body.session);
  if (account) return { ownerHash: account.owner_hash, authorKey: await EchoValidation.deriveAuthorKey(account.owner_hash), account };
  const token = body && body.token;
  if (typeof token !== "string" || token.length < 8 || token.length > 200) return null;
  const ownerHash = await EchoValidation.hashCreatorToken(token);
  const authorKey = await EchoValidation.deriveAuthorKey(ownerHash);
  return { ownerHash, authorKey, account: null };
}

/** Public shape of a post row — never includes owner_hash or the photo bytes. */
export function publicPost(row, profile) {
  return {
    id: row.id, kind: row.kind, title: row.title, body: row.body,
    lat: row.lat, lon: row.lon,
    route: row.route_json ? JSON.parse(row.route_json) : null,
    eventAt: row.event_at || null,
    hasPhoto: !!row.has_photo,
    createdAt: row.created_at,
    author: { id: row.author_key, nickname: profile ? profile.nickname : row.nickname || "Someone", avatar: profile ? profile.avatar : row.avatar || "rose", plus: !!(profile ? profile.plus : row.plus) },
  };
}

export const POST_COLUMNS = "p.id, p.author_key, p.kind, p.title, p.body, p.lat, p.lon, p.route_json, p.event_at, (p.photo IS NOT NULL) AS has_photo, p.created_at, pr.nickname, pr.avatar, " +
  "(SELECT a.plan = 'plus' AND (a.plan_until IS NULL OR a.plan_until > CAST(strftime('%s','now') AS INTEGER) * 1000) FROM accounts a WHERE a.owner_hash = p.owner_hash) AS plus";
