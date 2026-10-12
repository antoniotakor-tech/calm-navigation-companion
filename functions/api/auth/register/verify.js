// POST /api/auth/register/verify { challengeId, credential } → { session, account }
import { ensureAuthTables, takeChallenge, createSession, publicAccount, rpFor, jsonError, jsonResponse, parseJsonBody, requireDb, CORS_HEADERS } from "../_store.js";
import { verifyRegistration } from "../_webauthn.js";

export async function onRequestOptions() { return new Response(null, { status: 204, headers: CORS_HEADERS }); }

export async function onRequestPost({ request, env }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;
  const body = (await parseJsonBody(request)) || {};
  await ensureAuthTables(env.DB);
  const ch = await takeChallenge(env.DB, body.challengeId, "register");
  if (!ch) return jsonError("That took too long — please try again.", 400);
  const { rpId, origins } = rpFor(request);
  let reg;
  try {
    reg = await verifyRegistration({ credential: body.credential, expectedChallenge: ch.challenge, expectedOrigins: origins, rpId });
  } catch (e) { return jsonError("Passkey could not be verified: " + e.message, 400); }
  const now = Date.now();
  await env.DB.prepare("INSERT OR IGNORE INTO accounts (id, owner_hash, created_at) VALUES (?, ?, ?)").bind(ch.account_id, ch.owner_hash, now).run();
  const account = await env.DB.prepare("SELECT * FROM accounts WHERE owner_hash = ?").bind(ch.owner_hash).first();
  await env.DB.prepare("INSERT INTO passkeys (cred_id, account_id, alg, jwk, sign_count, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(reg.credentialId, account.id, reg.alg, JSON.stringify(reg.publicKeyJwk), reg.signCount, now).run();
  const count = await env.DB.prepare("SELECT COUNT(*) AS c FROM passkeys WHERE account_id = ?").bind(account.id).first();
  return jsonResponse({ session: await createSession(env.DB, account.id), account: publicAccount(account, count ? count.c : 1) }, 201);
}
