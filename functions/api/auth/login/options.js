// POST /api/auth/login/options → passkey sign-in challenge (discoverable: the phone offers its passkeys).
import { ensureAuthTables, rpFor, jsonResponse, requireDb, CORS_HEADERS } from "../_store.js";
import { randomB64url } from "../_webauthn.js";

export async function onRequestOptions() { return new Response(null, { status: 204, headers: CORS_HEADERS }); }

export async function onRequestPost({ request, env }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;
  await ensureAuthTables(env.DB);
  const challenge = randomB64url(32), id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO auth_challenges (id, challenge, kind, created_at) VALUES (?, ?, 'login', ?)").bind(id, challenge, Date.now()).run();
  return jsonResponse({ challengeId: id, publicKey: { challenge, rpId: rpFor(request).rpId, userVerification: "required", timeout: 120000, allowCredentials: [] } });
}
