// v1 -> v2 (2026-07-28, Calm Echoes) -> v3 (2026-07-29, Flow Mode) -> v4-v14
// (2026-07-29, Navigation Polish + product audit fixes) -> v15 (2026-07-29,
// duplicate-navigation-session bugfix — app.js + style.css) -> v16 (2026-07-29,
// visual redesign: design-token system, Fraunces/Inter typography, always-on
// Kalimba with 500m Echo-record gate) -> v17 (2026-07-29, map-first layout +
// Kalimba moved to page 3 + simplified auditory-regulation page + iOS voice-
// guidance unlock fix) -> v18 (2026-07-29, Kalimba recolored to app tokens,
// picking a soundscape now auto-enables auditory regulation, restored the
// iPhone mute-switch note to the simplified audio page) -> v19 (2026-07-29,
// subtraction pass step 1: soundscapes trimmed to white/brown/ocean/nature,
// presets moved behind a real collapsed Advanced disclosure) -> v20
// (2026-07-29, subtraction pass step 2: destination field auto-focused +
// pre-selected on load, zero-decision first run) -> v21 (2026-07-30,
// nav-bar legibility: labeled controls, always-visible Stop pill exempt
// from auto-hide, real kalimba icon replacing the banjo emoji) -> v22
// (2026-07-30: one-route default + Other routes disclosure, Echo placement
// fixed to a fresh record-time fix, Echoes fetch on map pan, kalimba
// extended to 15 tines with two-layer recording) -> v23 (2026-07-30:
// tap-to-navigate + Overpass POI markers) -> v24 (2026-07-30: MapLibre GL
// vector map themed from the app palette, replacing Leaflet + CARTO raster
// tiles; SW no longer registers on localhost) -> v25 (2026-07-30: search
// re-lock fix after stopping navigation, standalone-PWA audio session fix,
// POIs expanded with transit places incl. ferries) -> v26 (2026-07-30:
// search-bar-first layout — collapsed "Where to?" bar, map-first screen,
// auto-search on destination pick) -> v27 (2026-07-30: comprehensive
// bars/restaurants — more venue kinds, per-kind caps so food is never
// crowded out, POI dots from zoom 14) -> v28 (2026-07-30: public
// transport options — Transit travel mode, Transitous journey planner
// proxy, itinerary cards + ride/walk leg drawing) -> v29 (2026-07-30:
// shop cap raised to parity with food, 150 per area) -> v30 (2026-07-30:
// POIs at density — 400 food/400 shops/150 transit incl. ferry-terminal
// ways, Overpass mirror fallback chain, GL circle rendering) -> v31
// (2026-07-30: nearby cafés & bars by name as instant search-bar
// suggestions around your location) -> v32 (2026-07-30: custom map
// layers repaint on theme switch) -> v33 (2026-08-03: accessibility pass —
// pinch-zoom re-enabled, all font-sizes converted px->rem, three sub-44pt
// touch targets fixed) -> v34 (2026-08-03: calm-by-measurement pass — real
// haversine-distance road-class weighting (was point-index span), a new
// greenscore.js + functions/api/greenspace.js measuring actual OSM green-
// space coverage and blending it into calmScore, stereo-decorrelated +
// reverb soundscapes instead of dead-center mono, stale SOUNDSCAPE_LABELS
// entries removed) -> v35 (2026-08-03: curated CalmSpots map layer (10 real
// quiet bars/hidden gardens), localStorage recent-routes + pinned places
// (placesstore.js) with a save-pin destination-field control, 48h Echo
// visibility window (hide, not delete), 4 selectable kalimba key presets
// that never affect saved-Echo playback) -> v36 (2026-08-03: map pin popups
// — POI and CalmSpot — get a real "Go here" action instead of just showing
// a name with nothing to do about it; a clear/change-destination "✕"
// button so a mistaken destination can be fixed in place instead of
// reloading the app): bumping
// this is what actually forces already-installed/previously-visited clients
// onto the new app shell. The fetch handler below is cache-first ("cached
// || network" always prefers a cached hit if one exists), which means a
// same-named cache silently never updates what a returning visitor sees, no
// matter how many times the background revalidation fetch below refreshes
// its stored copy — only a new cache NAME (triggering activate's old-cache
// cleanup + a fresh `cache.addAll`) actually surfaces new content. Bump
// this on every future deploy that changes any file in APP_SHELL, not just
// this one.
// v41 (2026-10-09): empty destination on open, Stop resets to a clean
// planning screen, no auto-resuming soundscape, labelled page tabs.
// v42 (2026-10-09): maps-app pass — long-press to drop a pin, Show-my-location
// button + blue dot on the planning map, route framed in the visible map area,
// folded turn-by-turn list, full-height map (privacy note moved to Settings).
// v43 (2026-10-10): one delayed retry for the flaky places (/api/pois) layer.
// v44 (2026-10-10): arrow keys no longer flip pages from the map or during
// navigation; nearby places in search; map-centre search bias; D1 places cache.
// v45 (2026-10-10): search loads nearby places on demand + category words.
// v46 (2026-10-10): nearby search results deduplicated by name.
// v47 (2026-10-10): iPhone fit — 16px inputs (no auto-zoom), no double safe-area, compact header.
// v48 (2026-10-10): remaining iPhone fit items (title, kalimba height, keyboard-aware suggestions, toast).
// v49 (2026-10-10): Kalimba button during navigation + Back to navigation.
const CACHE_NAME = "calm-companion-v49";
const APP_SHELL = [
  "/",
  "/index.html",
  "/style.css",
  "/manifest.json",
  "/app.js",
  "/ambientengine.js",
  "/audiomanager.js",
  "/effectsengine.js",
  "/feedbackengine.js",
  "/gestureengine.js",
  "/hapticmanager.js",
  "/haptics.js",
  "/navlogic.js",
  "/navsim.js",
  "/patternlibrary.js",
  "/prefs.js",
  "/placesstore.js",
  "/routing.js",
  "/greenscore.js",
  "/calmspots.js",
  "/voiceengine.js",
  "/voicequeue.js",
  "/config.js",
  "/icon-192.png",
  "/icon-512.png",
  // Calm Echoes (2026-07-28) — precached like every other app-shell script.
  "/echovalidation.js",
  "/kalimbaengine.js",
  "/kalimbacontroller.js",
  "/echorecorder.js",
  "/explorationtracker.js",
  "/echomarkerclustering.js",
  // Flow Mode (2026-07-29).
  "/flowtheme.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET" || url.pathname.startsWith("/api/")) {
    // Cross-origin (map tiles), non-GET, and our own /api/* proxies all hit the
    // network normally — geocode/route responses must never be served stale,
    // and autocomplete's per-keystroke requests would otherwise bloat the cache.
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
