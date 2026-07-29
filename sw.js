// v1 -> v2 (2026-07-28, Calm Echoes) -> v3 (2026-07-29, Flow Mode) -> v4-v12
// (2026-07-29, Navigation Polish — each of v4-v12 fixed a real bug found
// during local testing, and each required its own bump to actually reach a
// returning tab, a live demonstration of why this has to happen on every
// change, not just once per feature): bumping this is what actually forces
// already-installed/previously-visited clients onto the new app shell. The
// fetch handler below is cache-first ("cached || network" always prefers a
// cached hit if one exists), which means a same-named cache silently never
// updates what a returning visitor sees, no matter how many times the
// background revalidation fetch below refreshes its stored copy — only a
// new cache NAME (triggering activate's old-cache cleanup + a fresh
// `cache.addAll`) actually surfaces new content. Bump this on every future
// deploy that changes any file in APP_SHELL, not just this one.
const CACHE_NAME = "calm-companion-v13";
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
  "/routing.js",
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
