// Cloudflare Pages Function — server-side proxy for GraphHopper's routing API.
//
// The client never sees GRAPHHOPPER_API_KEY: it's injected here from the
// Pages secret (set with `wrangler pages secret put GRAPHHOPPER_API_KEY`),
// server-side only. The browser calls same-origin /api/route instead of
// graphhopper.com directly, so devtools/Network never exposes the key.
//
// Only the specific params routing.js actually sends are forwarded — this is
// a routing proxy, not an open passthrough to GraphHopper's full API surface.
const ALLOWED_PARAMS = [
  "point", "profile", "algorithm", "max_paths", "max_weight_factor",
  "max_share_factor", "details", "points_encoded", "locale",
];

// The native app's WebView runs on a different origin than this Cloudflare
// Pages deployment, making every call here cross-origin from that app's
// point of view — without this header the response would be fetched but JS
// wouldn't be allowed to read it. Safe to leave permissive: no cookies/auth,
// no per-user data, just routing results built from public OSM data.
const CORS_HEADERS = { "access-control-allow-origin": "*" };

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.GRAPHHOPPER_API_KEY) {
    return new Response(JSON.stringify({ error: "Routing is not configured on this deployment." }), {
      status: 501,
      headers: { "content-type": "application/json", ...CORS_HEADERS },
    });
  }

  const incoming = new URL(request.url);
  const upstream = new URL("https://graphhopper.com/api/1/route");
  for (const key of ALLOWED_PARAMS) {
    for (const value of incoming.searchParams.getAll(key)) {
      upstream.searchParams.append(key, value);
    }
  }
  upstream.searchParams.set("key", env.GRAPHHOPPER_API_KEY);

  let resp;
  try {
    resp = await fetch(upstream.toString());
  } catch (e) {
    return new Response(JSON.stringify({ error: "Upstream routing service unreachable." }), {
      status: 502,
      headers: { "content-type": "application/json", ...CORS_HEADERS },
    });
  }

  const body = await resp.text();
  return new Response(body, {
    status: resp.status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS_HEADERS },
  });
}
