// POST /api/auth/register/options { token (device key), session? }
// Starts adding a passkey: to the signed-in account, or a new account that
// adopts this device's community identity.
import { ensureAuthTables, accountFromSession, ownerHashForDeviceToken, rpFor, jsonError, jsonResponse, parseJsonBody, requireDb, CORS_HEADERS } from "../_store.js";
import { randomB64url, b64urlEncode } from "../_webauthn.js";

export async function onRequestOptions() { return new Response(null, { status: 204, headers: CORS_HEADERS }); }

export async function onRequestPost({ request, env }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;
  const body = (await parseJsonBody(request)) || {};
  await ensureAuthTables(env.DB);
  let account = await accountFromSession(env.DB, body.session);
  let ownerHash = account ? account.owner_hash : await ownerHashForDeviceToken(body.token);
  if (!ownerHash) return jsonError("Missing device key.", 400);
  if (!account) account = await env.DB.prepare("SELECT * FROM accounts WHERE owner_hash = ?").bind(ownerHash).first();
  // A device that already has an account must sign in first (proves it's still them).
  if (account && !(await accountFromSession(env.DB, body.session))) {
    const has = await env.DB.prepare("SELECT COUNT(*) AS c FROM passkeys WHERE account_id = ?").bind(account.id).first();
    if (has && has.c > 0) return jsonError("This profile already has a passkey — sign in instead.", 409);
  }
  const accountId = account ? account.id : crypto.randomUUID();
  const profile = await env.DB.prepare("SELECT nickname FROM profiles WHERE owner_hash = ?").bind(ownerHash).first().catch(() => null);
  const name = (profile && profile.nickname) || "Calm Companion";
  const existing = account ? (await env.DB.prepare("SELECT cred_id FROM passkeys WHERE account_id = ?").bind(account.id).all()).results || [] : [];
  const challenge = randomB64url(32), id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO auth_challenges (id, challenge, kind, account_id, owner_hash, created_at) VALUES (?, ?, 'register', ?, ?, ?)").bind(id, challenge, accountId, ownerHash, Date.now()).run();
  const { rpId } = rpFor(request);
  return jsonResponse({
    challengeId: id,
    publicKey: {
      challenge, rp: { id: rpId, name: "Calm Companion" },
      user: { id: b64urlEncode(new TextEncoder().encode(accountId)), name, displayName: name },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
      attestation: "none", timeout: 120000,
      excludeCredentials: existing.map((r) => ({ type: "public-key", id: r.cred_id })),
    },
  });
}
