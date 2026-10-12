// Accounts, passkeys, sessions and Calm+ plans (2026-10-12).
// An account is created the first time someone adds a passkey; it adopts the
// device's existing community identity (owner_hash), so their profile and
// posts carry over and can then be reached from any device they sign in on.
// Session tokens are random, kept by the app (not cookies — the native
// WebView is cross-origin), and stored here only as SHA-256 hashes.
import EchoValidation from "../../../echovalidation.js";
import { randomB64url, b64urlEncode, sha256 } from "./_webauthn.js";
export { jsonError, jsonResponse, parseJsonBody, requireDb, CORS_HEADERS } from "../echoes/_util.js";

export const SESSION_MS = 180 * 24 * 3600 * 1000;
export const CHALLENGE_MS = 5 * 60 * 1000;
export const PLUS_LIMITS = { postsPerDay: 20 };
export const FREE_LIMITS = { postsPerDay: 3 };

let ready = false;
export async function ensureAuthTables(db) {
  if (ready) return;
  const stmts = [
    "CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, plan TEXT NOT NULL DEFAULT 'free', plan_until INTEGER, stripe_customer TEXT, sync_json TEXT, sync_at INTEGER)",
    "CREATE TABLE IF NOT EXISTS passkeys (cred_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, alg INTEGER NOT NULL, jwk TEXT NOT NULL, sign_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_used INTEGER)",
    "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS auth_challenges (id TEXT PRIMARY KEY, challenge TEXT NOT NULL, kind TEXT NOT NULL, account_id TEXT, owner_hash TEXT, created_at INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS plus_waitlist (who TEXT PRIMARY KEY, created_at INTEGER NOT NULL)",
  ];
  for (const s of stmts) await db.prepare(s).bind().run();
  ready = true;
}

export function rpFor(request) {
  const url = new URL(request.url);
  return { rpId: url.hostname, origins: [url.origin] };
}

const hashToken = async (t) => b64urlEncode(await sha256(new TextEncoder().encode(String(t))));

export async function createSession(db, accountId) {
  const token = randomB64url(32), now = Date.now();
  await db.prepare("INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(await hashToken(token), accountId, now, now + SESSION_MS).run();
  return token;
}
export async function endSession(db, token) {
  if (typeof token === "string" && token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await hashToken(token)).run();
}

/** Session token → account row (or null). Expired sessions are treated as signed out. */
export async function accountFromSession(db, token) {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
  await ensureAuthTables(db);
  return db.prepare(
    "SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?"
  ).bind(await hashToken(token), Date.now()).first();
}

export function isPlus(account, now = Date.now()) {
  return !!account && account.plan === "plus" && (!account.plan_until || account.plan_until > now);
}

export function publicAccount(a, passkeyCount) {
  return { id: a.id, plan: isPlus(a) ? "plus" : "free", planUntil: a.plan_until || null, passkeys: passkeyCount, syncAt: a.sync_at || null, billing: !!a.stripe_customer };
}

export async function ownerHashForDeviceToken(token) {
  if (typeof token !== "string" || token.length < 8 || token.length > 200) return null;
  return EchoValidation.hashCreatorToken(token);
}

export async function takeChallenge(db, id, kind) {
  const row = await db.prepare("SELECT * FROM auth_challenges WHERE id = ? AND kind = ?").bind(String(id || ""), kind).first();
  if (!row) return null;
  await db.prepare("DELETE FROM auth_challenges WHERE id = ? OR created_at < ?").bind(row.id, Date.now() - CHALLENGE_MS).run();
  return row.created_at > Date.now() - CHALLENGE_MS ? row : null;
}
