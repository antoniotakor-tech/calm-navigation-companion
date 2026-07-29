// Cloudflare Pages Function — DELETE /api/echoes/:id (a creator deleting
// their own Echo — "allow users to delete their own Echoes").
//
// Ownership is proven by hashing the caller's creatorToken and comparing it
// to the stored creator_token_hash — there are no accounts/sessions to check
// against, this comparison IS the access control for this feature.
//
// Explicitly deletes the echo's notifications first rather than relying on
// the schema's ON DELETE CASCADE: SQLite (and D1) does not enforce foreign
// keys unless `PRAGMA foreign_keys = ON` is set on the connection, which
// this project does not assume is guaranteed across every D1 connection —
// better to delete explicitly than to silently depend on that.
import EchoValidation from "../../../echovalidation.js";
import { jsonError, jsonResponse, requireDb, CORS_HEADERS } from "./_util.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestDelete(context) {
  const { env, params, request } = context;
  const dbError = requireDb(env);
  if (dbError) return dbError;

  const id = params.id;
  if (!id) return jsonError("Missing Echo id.", 400);

  const url = new URL(request.url);
  const creatorToken = url.searchParams.get("creatorToken");
  if (!creatorToken) return jsonError("creatorToken is required to delete an Echo.", 400);

  const row = await env.DB.prepare("SELECT creator_token_hash FROM echoes WHERE id = ?").bind(id).first();
  if (!row) return jsonError("Echo not found.", 404);

  const creatorTokenHash = await EchoValidation.hashCreatorToken(creatorToken);
  if (creatorTokenHash !== row.creator_token_hash) {
    return jsonError("You can only delete your own Calm Echoes.", 403);
  }

  await env.DB.prepare("DELETE FROM echo_notifications WHERE echo_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM echoes WHERE id = ?").bind(id).run();

  return jsonResponse({ deleted: true });
}
