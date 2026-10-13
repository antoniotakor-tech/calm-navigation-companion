// In-app "Report a problem / idea" (2026-10-13).
// POST /api/feedback { kind: "bug"|"idea"|"other", text, contact?, meta? }  → stored privately
// GET  /api/feedback?since=<ms>  (Authorization: Bearer <ADMIN_TOKEN>) → for the daily review
// Reports never contain location; meta is app version / screen / device type only.
import { jsonError, jsonResponse, parseJsonBody, requireDb, CORS_HEADERS } from "../echoes/_util.js";

let ready = false;
async function ensure(db) {
  if (ready) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, contact TEXT, meta TEXT, status TEXT NOT NULL DEFAULT 'new')").bind().run();
  ready = true;
}
const KINDS = ["bug", "idea", "other"];

export async function onRequestOptions() { return new Response(null, { status: 204, headers: CORS_HEADERS }); }

export async function onRequestPost({ request, env }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;
  const b = (await parseJsonBody(request)) || {};
  const text = typeof b.text === "string" ? b.text.trim().slice(0, 2000) : "";
  if (text.length < 3) return jsonError("Tell us a little more.", 400);
  const kind = KINDS.includes(b.kind) ? b.kind : "other";
  const contact = typeof b.contact === "string" ? b.contact.trim().slice(0, 120) : "";
  const meta = b.meta && typeof b.meta === "object" ? JSON.stringify({
    version: String(b.meta.version || "").slice(0, 20), screen: String(b.meta.screen || "").slice(0, 30),
    device: String(b.meta.device || "").slice(0, 160), theme: String(b.meta.theme || "").slice(0, 10),
  }) : null;
  await ensure(env.DB);
  // light spam guard: max 20 reports per minute overall
  const recent = await env.DB.prepare("SELECT COUNT(*) AS c FROM feedback WHERE created_at > ?").bind(Date.now() - 60000).first();
  if (recent && recent.c > 20) return jsonError("Please try again in a minute.", 429);
  await env.DB.prepare("INSERT INTO feedback (id, created_at, kind, text, contact, meta) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), Date.now(), kind, text, contact || null, meta).run();
  return jsonResponse({ ok: true }, 201);
}

export async function onRequestGet({ request, env }) {
  const dbError = requireDb(env);
  if (dbError) return dbError;
  const auth = request.headers.get("authorization") || "";
  if (!env.ADMIN_TOKEN || auth !== "Bearer " + env.ADMIN_TOKEN) return jsonError("Not allowed.", 401);
  await ensure(env.DB);
  const since = Number(new URL(request.url).searchParams.get("since")) || 0;
  const { results } = await env.DB.prepare("SELECT id, created_at, kind, text, contact, meta, status FROM feedback WHERE created_at > ? ORDER BY created_at DESC LIMIT 200").bind(since).all();
  return jsonResponse({ feedback: results || [] });
}
