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
  // ?calm=1 (2026-10-13): ask GraphHopper for a calm-weighted route with a
  // FIXED server-side custom model (main roads strongly avoided, foot/cycle
  // paths and quiet streets preferred). The client can't send its own model.
  if (incoming.searchParams.get("calm") === "1") return calmRoute(incoming, env);
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


const CALM_MODEL = {
  priority: [
    { if: "road_class == MOTORWAY || road_class == TRUNK", multiply_by: "0.05" },
    { else_if: "road_class == PRIMARY", multiply_by: "0.25" },
    { else_if: "road_class == SECONDARY", multiply_by: "0.4" },
    { else_if: "road_class == TERTIARY", multiply_by: "0.7" },
    { else_if: "road_class == FOOTWAY || road_class == PATH || road_class == PEDESTRIAN || road_class == CYCLEWAY || road_class == LIVING_STREET", multiply_by: "1" },
    { else: "", multiply_by: "0.9" },
  ],
  distance_influence: 30,
};

async function calmRoute(incoming, env) {
  const points = incoming.searchParams.getAll("point").slice(0, 2).map((p) => p.split(",").map(Number).reverse()); // [lon,lat]
  const profile = incoming.searchParams.get("profile") === "bike" ? "bike" : "foot";
  if (points.length !== 2 || points.flat().some((n) => !Number.isFinite(n))) {
    return new Response(JSON.stringify({ error: "Two points are required." }), { status: 400, headers: { "content-type": "application/json", ...CORS_HEADERS } });
  }
  const body = {
    points, profile, "ch.disable": true, custom_model: CALM_MODEL,
    points_encoded: false, locale: "en", instructions: true,
    details: incoming.searchParams.getAll("details").filter((d) => /^[a-z_]{2,30}$/.test(d)).slice(0, 8),
  };
  let resp;
  try {
    resp = await fetch("https://graphhopper.com/api/1/route?key=" + encodeURIComponent(env.GRAPHHOPPER_API_KEY), {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Upstream routing service unreachable." }), { status: 502, headers: { "content-type": "application/json", ...CORS_HEADERS } });
  }
  return new Response(await resp.text(), { status: resp.status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS_HEADERS } });
}
