# Calm Navigation Companion

**Live (web/PWA):** https://calm-navigation-companion.pages.dev — installable as a home-screen PWA on iOS/Android (Share/menu → Add to Home Screen / Install app).

**Native (iOS/Android):** also available as a real installable app via Capacitor, for the one thing a PWA genuinely cannot do — keep navigating (GPS + voice + optional ambient sound) while the screen is locked or the app is backgrounded. See [NATIVE_SETUP.md](NATIVE_SETUP.md) to build it, [IOS_BACKGROUND_NAVIGATION.md](IOS_BACKGROUND_NAVIGATION.md)/[ANDROID_BACKGROUND_NAVIGATION.md](ANDROID_BACKGROUND_NAVIGATION.md) for how the background engine works, and [MOBILE_TESTING_CHECKLIST.md](MOBILE_TESTING_CHECKLIST.md) before trusting it on a real trip — **this has been implemented and reviewed but not yet built or run on a device**, since the authoring environment had no Xcode/Android SDK (see NATIVE_SETUP.md's prerequisites section). The web/PWA version above is unaffected and keeps working exactly as before.

A working prototype built from the neurodivergent-friendly sensory design Design Thinking project. Three integrated pillars, one per swipeable page:

1. **Calm routing** — a map-first screen (MapLibre GL vector map, recolored live from the app's own palette per theme) opening as a single "Where to?" search bar. Pick a destination — typed, chosen from nearby café/bar suggestions, or tapped directly on the map — and the calm route appears pre-selected with one Start tap (the fastest alternative sits behind an optional disclosure). Travel modes: **Walk, Bike** (GraphHopper road-class scoring, peak-hour heuristic, demo mode without a key) and **Transit** (real public-transport itineraries — trains/metro/trams/buses/ferries — via the open Transitous journey planner, drawn on the map with ride legs solid and walking connections dashed; turn-by-turn Start stays walk/bike-only, stated honestly in the UI). The map also shows the neighborhood's real places from OpenStreetMap at street zoom: up to 400 bars/restaurants/cafés, 400 shops, and 150 transit stops (incl. ferry terminals) per area as tappable, name-labeled dots.
2. **Auditory regulation** — an adaptive audio engine (AudioManager/AmbientEngine/VoiceEngine/EffectsEngine, see `Audio engine architecture` below): four procedurally-synthesized soundscapes (white/brown noise, ocean, nature — trimmed from eleven in a deliberate simplification pass), smooth crossfades, presets behind a collapsed Advanced disclosure, voice announcements that duck the ambient bed and queue properly, and captions. Declares an iOS 17+ "playback" audio session so installed-PWA audio isn't silenced by the ringer switch.
3. **Kalimba** — a 15-tine, three-octave pentatonic instrument (no wrong notes by construction), always playable; after a 500 m walk you can record a melody — with an optional second overlaid layer recorded against the first as a guide — and leave it at your real recording location as a Calm Echo for others to find on the map. (The earlier haptic-fidgeting page's engine remains wired behind hidden markup; the nav vibration patterns are unchanged.)

Accessibility: reduced motion toggle, high contrast mode, adjustable haptic intensity, dark/light theme — all in the settings sheet (gear icon).

## Live GPS navigation

Tap **Start** after finding a route to enter a real turn-by-turn mode: live position tracking, a route-following map, automatic step advancement, distance/ETA, and automatic rerouting if you drift off the planned route.

- **Travel mode**: Walk or Bike (pills above the search box) — sent to GraphHopper as the routing profile. Driving is deliberately not offered: the whole premise here (calm, sensory-aware public-space routing) doesn't transfer to a car.
- **Recenter**: the map follows you automatically; pan it manually and a recenter button appears instead of fighting your gesture.
- **Voice guidance**: off by default (speaker icon in the nav banner). Uses the browser's built-in text-to-speech, on-device, no network call.
- **Screen stays awake** during navigation where the browser supports the Wake Lock API (most current mobile browsers); falls back silently (screen may sleep) where it doesn't.
- **Simulate GPS (developer only)**: set `DEV_SIMULATION: true` in `config.js`, or open the page with `?simulate=1`, to reveal a "DEV: Simulate GPS" button that walks a fake position along the real fetched route — for testing navigation without physically walking. Always shows a bright "SIMULATED GPS" badge while active; never substitutes for real GPS in production use.

**Not implemented, named honestly:** full compass-up map rotation (rotation gestures are deliberately disabled — the map stays a calm, north-up surface; only the user's own marker rotates to show heading); true background navigation while the phone is locked or the app is switched away from (this is a web page — installing it as a PWA gets you an icon and offline app-shell caching, but not background execution; that needs the native app build); live real-time transit departures (Transit itineraries come from the open Transitous planner's schedule data and are labeled as such in the UI, not as live platform boards).

## Address autocomplete

Both the start and destination fields are live, location-aware comboboxes, not plain text inputs resolved only on "Find calm route."

**Architecture** — three new modules, each with a single job:
- `searchranking.js` — pure functions: normalizes a raw GraphHopper/Photon hit into a `{primary, secondary, type, lat, lon}` suggestion, removes duplicates, and scores/sorts results. No DOM, no network — fully unit-tested.
- `geocodingservice.js` — thin client wrapper around the same-origin `/api/geocode` proxy: forward search, reverse lookup, and a session-cached "current city" context (one reverse-geocode call per session, not one per GPS update).
- `autocompletecontroller.js` — the accessible combobox itself: debounce (300ms), request sequencing so a slow, stale response can never overwrite a newer one, keyboard navigation, and rendering. Wired to both fields in `app.js`.

**Ranking** — a named-weight scoring model in `searchranking.js`'s `WEIGHTS` constant, tuned so text-match strength always dominates location: `EXACT_TEXT_MATCH` (1000) > `PREFIX_TEXT_MATCH` (500) > `CONTAINS_TEXT_MATCH` (150) > `SECONDARY_CONTAINS_MATCH` (40), each tier spaced far enough apart that no combination of `CITY_MATCH` (40) + `METRO_MATCH` (20, using `state`/`county` as an honest proxy — GraphHopper's geocoder has no true metro-area field) + `COUNTRY_MATCH` (8) + type boost (15) can ever let a weak text match beat a strong one. Distance uses a capped linear decay (`DISTANCE_DECAY_PER_KM`, capped at 100km) so it only breaks ties within a tier, never across one. This is what makes "Wes" in Amsterdam surface Westerpark/Westerstraat before an unrelated same-name result in another city, while still letting you search elsewhere on purpose.

**Location awareness** — a single low-accuracy `getCurrentPosition()` call fires once, on first focus of either address field (not on page load, so the permission prompt doesn't appear until you've actually started searching). If granted, it biases GraphHopper's `point` param and resolves a city/country context (cached for the session). If denied or unavailable, autocomplete still works globally — it just ranks on text match and type alone.

**"Use my current location"** — a persistent first option in the start field only (not destination). Selecting it requests a fresh, higher-accuracy fix, shows a "Locating…" state, and reverse-geocodes for a readable label — falling back to the plain label "Current location" if reverse geocoding fails, since the coordinates themselves are already good regardless.

**Accessibility** — a standard ARIA combobox: `role="combobox"` + `aria-expanded` + `aria-controls` + `aria-autocomplete="list"` on the input, `role="listbox"`/`role="option"` + `aria-activedescendant` on the list. Selection works via mouse, touch, and keyboard (Arrow Up/Down to move, Enter to select, Escape to close); the active option is marked with a visible outline ring, not colour alone. Selecting on `pointerdown` (not `click`) is what stops the input's own blur from closing the list before a tap registers.

**Privacy** — no location history is ever written to disk; the only state kept is an in-memory, per-session "current city" cache (city/locality/state/country code + the one coordinate it was resolved from), cleared on reload. The `/api/geocode` proxy applies `cache-control: no-store`, and the service worker (`sw.js`) explicitly excludes `/api/*` from its cache so a stale reverse-geocode or suggestion list can never be served from disk.

**Known limitation:** there's no "nearby destinations" or "recent searches" quick-pick in the destination field — deliberately left out rather than half-built, since it would mean deciding on and storing search history, which the privacy approach above avoids entirely. Live text autocomplete was the actual requirement; this is a named scope cut, not an oversight.

## Running it

Two ways, depending on whether you need real (live) routing or just the UI:

```bash
cd calm-navigation-companion
npm run dev     # wrangler pages dev . — Functions-aware, real GraphHopper routing works
# or:
npm run serve   # python3 -m http.server — static only, always runs in demo mode
```

`npm run dev` needs a `.dev.vars` file (copy `.dev.vars.example`, fill in a real GraphHopper key) to get live routing locally; without one it degrades to demo mode exactly like production does with no secret configured. `npm run serve` can never reach live routing at all — `/api/*` isn't served by a plain static server, so every request 404s and falls back to demo mode. Either way, open `http://localhost:8743`, or `http://<this-Mac's-LAN-IP>:8743` from a phone on the same WiFi (`ipconfig getifaddr en0`).

## Running the tests

```bash
npm test
```

Runs `navlogic.test.js` (the navigation state machine), `routing.test.js` (GraphHopper request/fallback/timeout handling and the proxy contract), `voicequeue.test.js`, `gestureengine.test.js`, `searchranking.test.js` (autocomplete normalization/dedup/ranking), `geocodingservice.test.js` (client geocoding wrapper, timeouts, session cache), `autocompletecontroller.test.js` (debounce, stale-response sequencing, keyboard nav — DOM-free pure helpers only), `shared/routeTransfer.test.js` / `shared/rerouteBackoff.test.js` / `shared/lifecycleReconciler.test.js` (the native-app support logic — route payload validation, reroute backoff, foreground-state reconciliation), and `functions/api/geocode.test.mjs` (the actual Cloudflare Function — validation, reverse mode, error handling, run separately as ESM since Cloudflare Pages Functions require `export`) via Node's built-in test runner — 119 tests, no extra dependencies. These are the files with real logic worth unit-testing; the rest (including the `AutocompleteController` DOM-wiring class and the native Swift/Kotlin, verified by manual device testing instead — see MOBILE_TESTING_CHECKLIST.md) is verified by hand.

## Configuration / secrets

The GraphHopper key is **not** a client-side value — it's a Cloudflare Pages secret, read only by two server-side Functions (`functions/api/route.js`, `functions/api/geocode.js`) that proxy requests to GraphHopper. The browser calls same-origin `/api/route` and `/api/geocode`; it never sees the key. Verify at any time with `curl https://calm-navigation-companion.pages.dev/app.js` — it should contain zero occurrences of any key.

`functions/api/geocode.js` supports both forward search (`?q=...&point=lat,lon&limit=&locale=`) and reverse lookup (`?reverse=true&point=lat,lon`), validates every param server-side (query length, `limit` clamped to 1–10, `point` checked for real lat/lon ranges), applies a 6-second upstream timeout, and whitelists which upstream fields ever reach the client — never the API key, never an arbitrary upstream field.

- **Production**: `wrangler pages secret put GRAPHHOPPER_API_KEY --project-name=calm-navigation-companion` (already set — `wrangler pages secret list` to confirm).
- **Local dev**: copy `.dev.vars.example` to `.dev.vars` (gitignored) and fill in a real key, then `npm run dev`.
- `config.js` holds only non-secret app config (default start/end points, peak-hour windows, special-event dates) — it's safe to commit and is tracked in git.
- Without a key configured (either environment), `/api/route` and `/api/geocode` return a fast error response and the app falls back to demo mode automatically — fully usable, just not live data.

## Adding real routing (free, no payment)

1. Sign up at https://www.graphhopper.com/dashboard/ (email only, no card)
2. Create an API key
3. Set it as described above (Cloudflare secret for production, `.dev.vars` for local dev) — never in a file that gets shipped to the browser.

## Native app (iOS/Android)

Wrapped via [Capacitor](https://capacitorjs.com), not rewritten — the existing HTML/CSS/JS above is reused as-is. A custom Capacitor plugin (`plugins/calm-nav-background/`, Swift + Kotlin) adds what a PWA structurally cannot: GPS tracking, off-route/arrival detection, voice guidance, and lock-screen/notification controls that keep running when the screen locks or the app is backgrounded. Full architecture, setup commands, and — critically — exactly what has and hasn't been verified (no Xcode/Android SDK were available while building this): [NATIVE_SETUP.md](NATIVE_SETUP.md). Platform-specific background behavior: [IOS_BACKGROUND_NAVIGATION.md](IOS_BACKGROUND_NAVIGATION.md), [ANDROID_BACKGROUND_NAVIGATION.md](ANDROID_BACKGROUND_NAVIGATION.md). Required real-device test pass before trusting it: [MOBILE_TESTING_CHECKLIST.md](MOBILE_TESTING_CHECKLIST.md). What location data this adds and how it's disclosed: [PRIVACY_LOCATION_DISCLOSURE.md](PRIVACY_LOCATION_DISCLOSURE.md).

The web deployment above is untouched by any of this — same Cloudflare Pages site, same behavior, feature-detected (`window.Capacitor`) rather than device-sniffed.

## Audio engine architecture

`prefs.js` (shared settings, localStorage) → `audiomanager.js` (one AudioContext, three buses: ambient/voice/effects, ducking) → `ambientengine.js` (soundscape synthesis + crossfade) / `voicequeue.js` + `voiceengine.js` (announcement queueing, ducking, captions) / `effectsengine.js` (one-shot context cues). `navlogic.js` adds `roadClassAt()`/`suggestAmbientLevel()` — real context awareness from data this app actually has (current road class from the route itself, walking speed from GPS, nav state). **Not wired in, named honestly:** there is no traffic API or weather API in this project, so "traffic intensity" and "weather" from the original brief are not real inputs anywhere — nothing here fakes them. **"Café" is not offered as a soundscape** — every sound is synthesized live (no audio sample files in this project), and overlapping chatter/clinking doesn't synthesize convincingly; offering it would mean shipping something misleading.

## Haptic engine architecture

`hapticmanager.js` (wraps `navigator.vibrate`, intensity scaling, on/off, best-effort battery throttling) + `patternlibrary.js` (named patterns, pure data) + `gestureengine.js` (pointer-event gesture recognition — tap/doubleTap/press/longPress/swipe/drag/rub/circle, unit-tested pure classifier) + `feedbackengine.js` (gesture → pattern+tone+visual, and the nav-linked turn/off-route/arrival patterns). **Honest limitation:** `navigator.getBattery()` was removed from Chrome for privacy and was never in Safari — the battery-aware throttling code is real and will activate on the few browsers that still expose it, but won't fire on most real phones today.

## Known platform limitation

**iOS Safari does not implement the Vibration API at all** — this is Apple's own platform restriction, not a bug in this app. On iPhone, the haptic fidgeting tools still work visually (the ripple animation responds to every tap), just without the actual buzz. The app detects this automatically and shows a note explaining why, rather than silently failing.

## Next steps if this is worth taking further

- **Real App Store / Play Store:** needs your own Apple Developer ($99/yr) or Google Play Console ($25 one-time) account, a privacy policy (this touches a sensitive-use case even though nothing is currently logged), and app review time. Worth doing only after real people have tried the current prototype.
- **Real-time crowd/noise data:** the free GraphHopper/OSM tier doesn't expose this — a future version could layer in something like Google Popular Times or a crowdsourced signal, but that's a real scope increase, not a quick add.
- **Per-visitor rate limiting on the routing proxy:** the GraphHopper free-tier key is now a single quota shared by every visitor to the live URL, rather than something each developer supplies themselves. Fine for demoing/testing; worth adding (Cloudflare Rate Limiting rules on `/api/*`) before pointing real traffic at it.

## Ideas parked for later (Antonio, 2026-07-27)

Not built yet — noted so they aren't lost, not forgotten because they're missing from the code:

- **Customizable layout** — let people rearrange or resize the three pages/pillars themselves, rather than a fixed order. Ties into the "highly customizable" requirement from the original spec, currently only partly met (settings exist, layout order doesn't).
- **Record-your-own audio/visual, then hands-on edit it** — capture a sound or photo yourself and manipulate it directly (touch-based editing) rather than only choosing from preset noise types. A real scope increase over the current synthesized-noise approach — would need its own design pass (what does "edit with your hands" actually mean as an interaction: trim, filter, distort, something else?) before it's buildable.
