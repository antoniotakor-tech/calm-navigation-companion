// Shared helpers for the /api/echoes/* Cloudflare Pages Functions. Prefixed
// with an underscore so Pages' file-based router excludes it from routing
// (same convention Cloudflare documents for shared non-route helpers) while
// still letting every route file import it directly.
//
// Not re-exporting echovalidation.js's fuzzing/hashing/validation from here —
// each route imports that shared module directly, so there is exactly one
// place (echovalidation.js) that owns the actual rules, and this file only
// owns HTTP-shaped plumbing (CORS, JSON responses, body parsing).

// The native app's WebView runs on a different origin than this Cloudflare
// Pages deployment (see geocode.js/route.js for the identical rationale) —
// every Echoes endpoint needs the same header for the same reason.
export const CORS_HEADERS = { "access-control-allow-origin": "*" };

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS_HEADERS },
  });
}

export function jsonError(message, status) {
  return jsonResponse({ error: message }, status);
}

/** Parses the request body as JSON, returning null (never throwing) on malformed input — callers turn a null into their own 400. */
export async function parseJsonBody(request) {
  try {
    return await request.json();
  } catch (e) {
    return null;
  }
}

export function requireDb(env) {
  if (!env.DB) return jsonError("Calm Echoes storage is not configured on this deployment.", 501);
  return null;
}
