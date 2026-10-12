// POST /api/auth/login/verify { challengeId, credential } → { session, account, ownerProfile }
import { ensureAuthTables, takeChallenge, createSession, publicAccount, rpFor, jsonError, jsonResponse, parseJsonBody, requireDb, CORS_HEADERS } from "../_store.js";
import { verifyAuthentication } from "../_webauthn.js";

export async function onRequestOptions() { return new Response(null, { status: 204, headers: CORS_HEADERS }); }

export async function onRequestPost({ request, env }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;
  const body = (await parseJsonBody(request)) || {};
  await ensureAuthTables(env.DB);
  const ch = await takeChallenge(env.DB, body.challengeId, "login");
  if (!ch) return jsonError("That took too long — please try again.", 400);
  const credId = body.credential && body.credential.id;
  const pk = credId ? await env.DB.prepare("SELECT * FROM passkeys WHERE cred_id = ?").bind(String(credId)).first() : null;
  if (!pk) return jsonError("This passkey isn't registered here (it may have been deleted).", 404);
  const { rpId, origins } = rpFor(request);
  let out;
  try {
    out = await verifyAuthentication({ credential: body.credential, stored: { alg: pk.alg, publicKeyJwk: JSON.parse(pk.jwk), signCount: pk.sign_count }, expectedChallenge: ch.challenge, expectedOrigins: origins, rpId });
  } catch (e) { return jsonError("Sign-in failed: " + e.message, 401); }
  await env.DB.prepare("UPDATE passkeys SET sign_count = ?, last_used = ? WHERE cred_id = ?").bind(out.newSignCount, Date.now(), pk.cred_id).run();
  const account = await env.DB.prepare("SELECT * FROM accounts WHERE id = ?").bind(pk.account_id).first();
  const count = await env.DB.prepare("SELECT COUNT(*) AS c FROM passkeys WHERE account_id = ?").bind(account.id).first();
  return jsonResponse({ session: await createSession(env.DB, account.id), account: publicAccount(account, count.c) });
}
