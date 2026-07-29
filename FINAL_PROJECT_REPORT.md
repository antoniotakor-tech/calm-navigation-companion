# Final Project Report — Calm Navigation Companion

**Version:** 0.5.0 · **Date:** 2026-07-28 · **Status:** Working prototype, deployed (web); native iOS/Android build implemented but not yet compiled/device-tested — not yet user-validated at scale

---

## 1. Executive Summary

Calm Navigation Companion is a static, client-side web app (HTML/CSS/vanilla JS, no framework, no build step) that offers calm-vs-fastest walking/biking routes, an adaptive procedurally-synthesized ambient audio layer, and a gesture-driven haptic fidgeting tool — three integrated "pillars" on one swipeable screen, built from a neurodivergent-friendly sensory-design Design Thinking project.

It is a real, working prototype: live GPS turn-by-turn navigation, automatic off-route detection and rerouting, 11 synthesized soundscapes with proper audio ducking, 8 recognized touch gestures each producing a distinct vibration+tone+visual response, location-aware address autocomplete on both search fields, full accessibility settings (reduced motion, high contrast, dark/light theme), and an installable PWA shell. It is **not** a validated product — the "calm" routing heuristic and the sensory-regulation design have not been tested with real target users beyond one informal session (see [PRESENTING.md](PRESENTING.md), Stage 15 of the project's own Design Thinking pipeline, not yet run for real).

As of this report: 119/119 automated tests pass, no known crashes, no client-side secrets, deployed and live at **https://calm-navigation-companion.pages.dev**. A native iOS/Android build (Capacitor + a custom background-navigation plugin, see §2.13) has also been implemented in this pass — its TypeScript compiles cleanly and both native projects are confirmed correctly configured, but **it has not been compiled, run, or tested on any simulator/emulator/device**, since the authoring environment has no Xcode, Android SDK, or Java runtime. Treat the native app's own claims (background GPS/audio survival specifically) as implemented-and-reviewed, not verified, until MOBILE_TESTING_CHECKLIST.md has actually been run.

---

## 2. Architecture Overview

### 2.1 Runtime model

Static site, no backend database, no user accounts, no authentication. Two small serverless functions exist solely to keep one API key off the client. Everything else — routing logic, navigation state, audio synthesis, haptics, preferences — runs entirely in the browser.

```
Browser (index.html + 21 <script> tags, no bundler)
  ├─ Leaflet.js (CDN) ─── map rendering
  ├─ CARTO tiles (light_all / dark_all, no key required)
  ├─ routing.js ─────────► same-origin /api/route, /api/geocode
  ├─ searchranking.js ───── pure autocomplete normalize/dedupe/rank (no I/O)
  ├─ geocodingservice.js ─► same-origin /api/geocode (forward+reverse, session city cache)
  ├─ autocompletecontroller.js ── accessible combobox (debounce, keyboard nav, ARIA)
  ├─ navlogic.js ────────── pure nav state machine (no I/O)
  ├─ AudioManager + 3 engines ─── Web Audio API only, no audio files
  ├─ HapticManager + 3 modules ── navigator.vibrate()
  ├─ Prefs ──────────────── localStorage
  └─ Service Worker (sw.js) ── same-origin app-shell cache

Cloudflare Pages (hosting + edge functions)
  ├─ Static asset serving (CDN, effectively unlimited scale)
  └─ functions/api/route.js, functions/api/geocode.js
       └─ GRAPHHOPPER_API_KEY (Pages secret) ──► graphhopper.com
```

### 2.2 Folder structure

```
calm-navigation-companion/
├── index.html                 Single-page shell: 3 swipeable "pages" (routing / audio / haptics)
├── app.js                     ~1000 lines — all DOM wiring, event handlers, page navigation
├── style.css                  Design tokens (CSS custom properties) + component styles, light+dark theme
├── config.js / config.example.js   Non-secret app config (default points, peak windows, special events)
│
├── routing.js                 GraphHopper request building, road-class scoring, demo-mode fallback
├── searchranking.js           Autocomplete: normalize/dedupe/rank GraphHopper geocode hits (pure)
├── geocodingservice.js        Autocomplete: client wrapper for /api/geocode (forward+reverse, city cache)
├── autocompletecontroller.js  Autocomplete: accessible combobox controller (debounce, keyboard, ARIA)
├── navlogic.js                Pure navigation state machine (off-route, arrival, step advancement)
├── navsim.js                  Developer-only fake-GPS walker for testing without moving
│
├── audiomanager.js            Single AudioContext, 3 mix buses (ambient/voice/effects)
├── ambientengine.js           11 synthesized soundscapes + crossfading
├── voiceengine.js / voicequeue.js   Turn-by-turn speech, FIFO queueing, ducking, captions
├── effectsengine.js           One-shot audio cues (arrival, off-route alert, turn tick)
│
├── hapticmanager.js           navigator.vibrate() wrapper, intensity, battery-aware throttling
├── patternlibrary.js          Named vibration patterns (pure data)
├── gestureengine.js           Pointer-event gesture classifier (tap/swipe/drag/circle/etc.)
├── feedbackengine.js          Gesture/nav-event → haptic + tone + visual, combined
├── haptics.js                 Platform capability detection (iOS has no Vibration API)
│
├── prefs.js                   Shared localStorage-backed settings store
├── manifest.json / sw.js      PWA: install metadata + app-shell service worker
├── icon-*.png, apple-touch-icon.png, favicon-32.png
│
├── functions/api/
│   ├── route.js                Server-side GraphHopper routing proxy (Cloudflare Pages Function)
│   └── geocode.js               Server-side GraphHopper geocoding proxy
│
├── *.test.js (7 files) + functions/api/geocode.test.mjs   Node --test unit tests (100 tests)
├── .dev.vars.example            Template for local Functions-aware dev secrets
├── README.md / PROJECT_STATUS.md / PRESENTING.md / FINAL_PROJECT_REPORT.md / HANDOFF.md
└── package.json                 test / serve / dev / deploy scripts
```

### 2.3 Main modules & responsibilities

| Module | Responsibility |
|---|---|
| `app.js` | UI glue only — DOM queries, event listeners, page-swipe navigation, calling into every engine below. No routing math, no nav-state logic of its own. |
| `routing.js` | Builds GraphHopper requests (via the proxy), scores alternative routes by road-classification "calm-ness," falls back to a believable demo route on any failure. |
| `navlogic.js` | The navigation engine. Pure functions, zero DOM/network access — off-route detection (3-fix hysteresis), step advancement, arrival, heading, ambient-level suggestion. Fully unit-tested. |
| Autocomplete stack | `searchranking.js` (pure normalize/dedupe/rank, named-weight scoring) ← `geocodingservice.js` (forward/reverse geocode client, session city cache) ← `autocompletecontroller.js` (accessible combobox: debounce, request sequencing, keyboard nav, rendering). Wired to both address fields from `app.js`. |
| Audio stack | `audiomanager.js` (bus/ducking infrastructure) ← `ambientengine.js` / `voiceengine.js`+`voicequeue.js` / `effectsengine.js`. Everything is Web Audio API oscillators/noise buffers — **no audio sample files anywhere in this project.** |
| Haptic stack | `haptics.js` (capability check) → `hapticmanager.js` (device output) ← `patternlibrary.js` (pattern data) + `gestureengine.js` (input classification) + `feedbackengine.js` (ties gesture → response). |
| `prefs.js` | The only persistence in the app: one `localStorage` key, audio+haptic settings, degrades silently in private browsing. |

### 2.4 Data flow (a single route search)

1. User taps **Find calm route** → `app.js: runSearch()`.
2. For each field: if its text still matches an autocomplete selection, its already-known lat/lon is reused directly (no request); otherwise a `geocode()` call resolves the typed text → same-origin `/api/geocode` → Cloudflare Function → GraphHopper (key injected server-side) → resolved lat/lon. (Autocomplete itself, while typing, runs a separate debounced `forwardGeocode()` → `rankHits()` pipeline through the same proxy — see §2.3's autocomplete stack row.)
3. `fetchCalmRoute()` → same-origin `/api/route` → GraphHopper alternative-routes API → up to 3 candidate paths.
4. `routing.js` scores each path's `road_class` segments against a calm-vs-busy weight table (safety-mode uses a different table); picks calmest + fastest.
5. `app.js` draws both polylines on the Leaflet map, renders the comparison cards + turn-by-turn list.
6. On **Start**: `navlogic.createNavState()` + `navigator.geolocation.watchPosition()` (or `NavSimulator` in dev mode) feed GPS fixes into `navlogic.processFix()` every ~2s, which returns state/step/reroute decisions consumed by the map marker, voice queue, haptic feedback, and ambient-audio level.

### 2.5 State management

No framework, no global store. State lives in plain closured variables inside the `app.js` IIFE (`lastResult`, `navState`, `currentState`, etc.) plus one persisted object in `Prefs`. Deliberately simple for the app's size — see Code Quality Review (§6) for the tradeoff this makes as the file grows.

### 2.6 Storage

`localStorage` only, one namespaced key (`calmcompanion.prefs.v1`), audio+haptic settings. Nothing about routes, location history, or navigation sessions is persisted or ever sent anywhere except the live route/geocode request itself.

### 2.7 Authentication

None. No accounts, no login, no user identity of any kind.

### 2.8 Navigation engine

`navlogic.js`, described in §2.3 above — the one file in this project built explicitly to be framework- and I/O-free so it can be unit-tested as pure logic (13 of the 39 tests target it directly).

### 2.9 Audio engine

Real-time synthesis via Web Audio API — white/pink/brown noise, filtered rain/wind/ocean, generative piano notes and bird chirps, a low hum tone. Three independently-volumed buses (ambient/voice/effects) all duck correctly under a single shared `AudioContext`. See `README.md`'s "Audio engine architecture" section for the full signal chain.

### 2.10 Haptic engine

`navigator.vibrate()`-based, with a pure gesture classifier (`gestureengine.js`, unit-tested) driving named patterns (`patternlibrary.js`) through a single output wrapper (`hapticmanager.js`) that adds user on/off, intensity scaling, and best-effort battery throttling. iOS Safari has zero Vibration API support — detected and disclosed on-screen, with a visual-only fallback (ripple animation still responds to every gesture).

### 2.11 Map provider

Leaflet.js (CDN, `unpkg.com`), CARTO Positron/Dark Matter basemap tiles (no API key required), OpenStreetMap data underneath.

### 2.12 Routing provider

GraphHopper's free-tier Directions + Geocoding API, accessed exclusively through the two Cloudflare Pages Functions — never called directly from the browser. Geocoding covers both forward search (autocomplete, and the one-shot address resolution on "Find calm route") and reverse lookup (city-context detection, "Use my current location" labeling).

### 2.13 Native app architecture (iOS/Android)

Capacitor wraps the existing web app unmodified; a custom plugin (`plugins/calm-nav-background/`) adds background-capable navigation. Three new layers sit between `app.js` and the platform:

```
shared/    Interfaces (LocationProvider, BackgroundNavigationService, AudioSessionController,
           SpeechGuidanceProvider, HapticProvider, LifecycleController, NotificationController) +
           pure logic: route-payload building/validation, reroute backoff, foreground-state
           reconciliation. Fully unit-tested (node --test), zero DOM/native calls.
web/       Implements those interfaces with the EXISTING browser APIs/engines — unchanged behavior.
native/    Implements them by calling Capacitor.Plugins.CalmNavBackground (custom) or
           Capacitor.Plugins.App/Haptics (official plugins).
```

`shared/navigationBridge.js` (`NavBridge`) picks web or native at startup via `Capacitor.isNativePlatform()` and is the only thing `app.js` calls for anything nav-related — enforcing that exactly one engine ever processes a given GPS fix stream (see IOS_/ANDROID_BACKGROUND_NAVIGATION.md's "single-engine invariant"). On native, the plugin's own Swift/Kotlin engine (`NavigationEngine.swift` / `NavEngine.kt`) is a hand-ported mirror of `navlogic.js`'s `processFix()` state machine — reading its distance thresholds from the same `NavLogic.THRESHOLDS` values (via `shared/routeTransfer.js`'s payload), but necessarily duplicating the algorithm itself, since Swift/Kotlin/JS cannot share source.

Reused as-is on native: the entire existing UI, `routing.js`'s calm-vs-fastest scoring (still computed in JS for the initial route and any foreground reroute), the Cloudflare Functions proxy (now CORS-enabled for the native WebView's different origin). Not reused on native: Web Speech API (native `AVSpeechSynthesizer`/`TextToSpeech` instead, for lock-screen reliability) and Web Audio API's ambient soundscapes (a single native noise loop instead — see IOS_/ANDROID_BACKGROUND_NAVIGATION.md's "known simplifications").

---

## 3. Feature Status

| Feature | Status | Notes | Known limitations |
|---|---|---|---|
| Calm-vs-fastest routing | **Complete** | Road-class scoring, peak-hour heuristic, live + demo mode | Heuristics are named/stated, not measured (no live crowd data on free tier) |
| Safety-mode alternate scoring | **Complete** | Built from real informal feedback (isolated-vs-populated tradeoff) | Still a heuristic, not real lighting/population data |
| Turn-by-turn step list | **Complete** | Parsed from GraphHopper `instructions` | — |
| Live GPS navigation | **Complete** | watchPosition, off-route hysteresis, auto-reroute, arrival screen | No true point-to-segment distance (nearest-vertex approximation, sub-meter-level inexact) |
| Voice guidance | **Complete** | Web Speech API, queued, ducks ambient bed, captions always shown | Off by default; on-device only, no network |
| Follow-mode / recenter | **Complete** | Auto-follows GPS, manual pan disables it | — |
| Travel mode (walk/bike) | **Complete** | Sent as GraphHopper profile | Driving intentionally not offered (out of scope by design) |
| Special-event awareness | **Partial** | 2 dates hardcoded (King's Day, NYE) | Manually maintained list, not a live calendar |
| Wake lock during nav | **Complete** | Where the browser supports it | Silently degrades where unsupported |
| Dev GPS simulator | **Complete** | `?simulate=1` or config flag, badged on-screen | Developer-only by design, never a production path |
| Auditory regulation (11 soundscapes) | **Complete** | Fully synthesized, crossfaded, presets | "Café" deliberately not offered (can't synthesize convincingly) |
| Haptic fidgeting (8 gestures) | **Complete** | Tap/doubleTap/press/longPress/swipe/drag/rub/circle | iOS: visual-only fallback, no real vibration (platform limitation) |
| Accessibility settings | **Complete** | Reduced motion (now OS-aware on load), high contrast, dark/light | — |
| PWA install | **Complete** | manifest + service worker, home-screen icon | No offline routing (cross-origin API calls aren't cached, by design) |
| Server-side API key proxy | **Complete** | Cloudflare Pages Functions | Shared free-tier quota across all visitors (no per-user key) |
| Address autocomplete | **Complete** | Accessible combobox, both fields; debounced, stale-response-safe, keyboard+touch+mouse; location-aware ranking; "Use my current location" | No nearby-destinations/recent-searches quick-pick (deliberate scope cut, avoids storing search history) |
| Native iOS/Android app (Capacitor) | **Implemented, not device-verified** | Custom background-navigation plugin (Swift+Kotlin): GPS tracking, native TTS, notification/lock-screen controls, native reroute-with-backoff; both native projects generated and confirmed to link the plugin correctly | Never compiled, run, or tested on simulator/emulator/device — no Xcode/Android SDK/Java in this environment. See MOBILE_TESTING_CHECKLIST.md |
| Automated tests | **Complete** | 119 tests across nav logic, routing, gestures, voice queue, autocomplete ranking/geocoding/debounce, native-app support logic (route payload, reroute backoff, foreground reconciliation), and the geocode Function itself | DOM-wiring layer (`app.js`, `AutocompleteController`'s DOM half) and all native Swift/Kotlin are untested by automation (manual verification only) |
| Customizable pillar layout | **Planned** | Not started | Parked idea, needs its own design pass |
| Record-your-own audio/visual editing | **Planned** | Not started | Real scope increase, undefined interaction model |
| Real-time crowd/noise data | **Planned** | Not started | Free-tier APIs don't expose this |
| Native app / App Store | **Planned** | Not started | Needs paid dev accounts, privacy policy, review time |

---

## 4. Deployment Checklist

- [x] **Environment variables / secrets**: `GRAPHHOPPER_API_KEY` — Cloudflare Pages secret, confirmed set (`wrangler pages secret list`). Local dev equivalent: `.dev.vars` (gitignored, `.dev.vars.example` provided).
- [x] **API keys**: One — GraphHopper (free tier, no payment on file). ⚠️ **Rotate this key.** It shipped client-side in `config.js` for roughly a day before today's fix and was readable by any visitor's devtools; it was never committed to git, but the deployed exposure is independent of that. Get a fresh key at https://www.graphhopper.com/dashboard/ and re-run `wrangler pages secret put GRAPHHOPPER_API_KEY`.
- [x] **Third-party accounts needed**: Cloudflare account (hosting + Functions, already set up under `Antoniotakor@icloud.com`'s account), GraphHopper account (free tier).
- [x] **Hosting configuration**: Cloudflare Pages, project `calm-navigation-companion`, no `wrangler.toml` needed (Functions auto-detected from `functions/` directory).
- [x] **Domain / SSL**: `calm-navigation-companion.pages.dev`, HTTPS enforced automatically by Cloudflare (no custom domain configured — optional future step).
- [ ] **Monitoring**: none configured. Cloudflare's built-in Pages analytics (request counts, errors) is available for free in the dashboard but not proactively checked.
- [ ] **Analytics**: none. No user tracking of any kind currently — consistent with "nothing is saved or sent anywhere" as stated in-app.
- [ ] **Error tracking**: none (no Sentry/equivalent). For a project this size, `wrangler pages deployment tail` (live log streaming) is the practical equivalent; not wired into any dashboard.
- [x] **Backups**: source is in git (local repo, not yet pushed to a remote — see §8's risk notes). Cloudflare retains all prior deployments and secrets independently.
- [ ] **Privacy Policy / Terms of Service**: not written. Currently justified by "nothing is logged" being true, but required before any App Store submission or real user data collection.
- [x] **App icons**: crescent-moon icon set (512/192/apple-touch/favicon), on-brand with the app's dark theme.
- [x] **Metadata**: `manifest.json` complete (name, colors, icons, display mode); `<meta>` tags for theme-color and mobile-web-app-capable present in `index.html`.
- [x] **Production build commands**: none needed (no build step) — `npm run deploy` (`wrangler pages deploy .`) ships the working tree directly.

---

## 5. User Testing Checklist

**First launch**
- [ ] Cold load on a throttled connection — does anything render before all scripts finish loading?
- [ ] PWA install prompt/flow on iOS Safari and Android Chrome
- [ ] Default start/destination pre-filled correctly; map centers on Amsterdam

**Permissions**
- [ ] Location permission prompt appears only on **Start**, not on page load
- [ ] Deny location → clear, non-technical error message, app doesn't hang
- [ ] Allow location → real GPS fix received within a reasonable time outdoors

**Search**
- [ ] Default route (Amsterdam Centraal → Vondelpark) returns a result
- [ ] Custom addresses geocode correctly
- [ ] Typo'd start address only → clear error naming which field failed, previous location kept
- [ ] Typo'd destination only → same, independently
- [ ] Both fields typo'd → combined error message
- [ ] Toggling "prefer well-lit streets" while a search is in flight doesn't double-fire

**Routing**
- [ ] Calm vs fastest cards show correct time/distance/road-class breakdown
- [ ] Selecting the other card updates the turn-by-turn list
- [ ] Map fully tiles with no grey gaps after every search
- [ ] Peak-hour and night-safety banners appear/disappear correctly for the current time

**Live navigation**
- [ ] Start → GPS marker appears and tracks smoothly
- [ ] Manual map pan disables follow-mode; recenter button appears and works
- [ ] Walking off the actual route triggers a reroute after ~3 consecutive bad fixes, not on one blip
- [ ] Arrival screen appears within the arrival radius
- [ ] End navigation mid-route returns cleanly to the search screen

**Audio**
- [ ] Each of the 11 soundscapes audibly starts/stops/crossfades
- [ ] Voice guidance ducks the ambient bed and restores it after speaking
- [ ] Captions appear even when voice is muted
- [ ] Sound-level visualizer bars actually animate (regression check for the bug fixed 2026-07-28)
- [ ] Volume sliders and presets persist across a reload

**Haptics**
- [ ] All 8 gestures (tap/doubleTap/press/longPress/swipe/drag/rub/circle) produce a distinct feel on a supported Android device
- [ ] iOS: no vibration, but the "no haptics on this device" note is visible and the visual ripple still responds
- [ ] Nav-linked vibrations (turn approaching, off-route, arrival) fire at the right moments

**Offline behaviour**
- [ ] Airplane mode after first load: app shell still opens (PWA cache)
- [ ] Attempting a search while offline: fails gracefully to demo mode or a clear error, not a silent hang

**Error handling**
- [ ] Kill WiFi mid-search: falls back to demo mode with a stated reason, not a stuck spinner
- [ ] Simulate a slow/hung connection: 12s timeout kicks in and recovers (regression check for the fix added 2026-07-28)

**Accessibility**
- [ ] System-level reduced-motion ON before first load → toggle starts checked, ambient canvas animation doesn't run
- [ ] High contrast mode visibly changes the palette
- [ ] Dark/light theme toggle updates both the UI and the map tile style together

**Performance / battery**
- [ ] No visible frame drops swiping between the three pages
- [ ] Tab backgrounded during a long session: canvas animations pause (regression check)
- [ ] Extended live-navigation session doesn't cause a noticeable battery/heat spike beyond GPS+screen-on baseline

**Screen sizes**
- [ ] iPhone SE-class narrow viewport: no horizontal overflow, buttons remain tappable
- [ ] iPhone Pro Max / large Android: layout doesn't look sparse or misaligned
- [ ] Desktop browser window: usable, even though this is optimized for mobile

---

## 6. Code Quality Review

- **Maintainability**: Good for its size. Every file opens with a header comment explaining its one responsibility, and cross-cutting concerns (nav logic, gesture classification) are deliberately isolated into pure, dependency-free, unit-tested modules. The one real soft spot is `app.js` at ~1000 lines doing DOM wiring for all three pillars — still readable (clearly sectioned, consistently commented) but the largest file by a wide margin.
- **Scalability**: Fine for what this is — a single-user, static, no-backend prototype. The one real bottleneck if traffic ever grew is the shared free-tier GraphHopper key behind the proxy (§4, §8).
- **Readability**: Strong. Comments consistently explain *why*, not *what* — named heuristics, disclosed limitations, honest "not built" notes throughout rather than silent gaps. This is the project's clearest strength.
- **Security**: Good after today's fix — no client-side secrets, verified end-to-end. Residual: the old key's brief public exposure window (rotation recommended, §4), and no rate limiting on the proxy yet.
- **Performance**: Solid — synthesized audio has no asset-loading cost, the map is the only real rendering weight, and the two continuous canvas animations now correctly pause when idle/backgrounded/reduced-motion.
- **Accessibility**: Above-average for a prototype at this stage — reduced motion, high contrast, captions-always, iOS haptic-gap disclosure, and OS-preference-aware defaults (fixed today). Not WCAG-audited.
- **UX consistency**: Consistent visual language (CSS custom-property design tokens, consistent card/pill/button vocabulary) across all three pillars.

**Technical debt to address later** (see `PROJECT_STATUS.md` for the full list):
1. No build step means no TypeScript/lint pipeline — the sound-canvas crash fixed today (an undefined-variable typo) is the direct, concrete cost of that gap.
2. `app.js`'s navigation UI wiring should eventually move to its own file, mirroring `navlogic.js`'s separation.
3. No point-to-segment route-distance math (nearest-vertex approximation) — fine today, worth revisiting if off-route false positives/negatives ever show up in real use.

---

## 7. Future Roadmap

**Critical (before public launch)**
- Rotate the GraphHopper API key (previously exposed client-side).
- Write a minimal Privacy Policy — even "we log nothing" needs to be a stated, published claim before wider distribution.
- Add rate limiting to `/api/route` and `/api/geocode` (shared free-tier quota, currently unprotected against one visitor exhausting it for everyone).

**Important (next version)**
- Run real Stage 4/15 user interviews — the single highest-leverage next step for the project's actual validity, per its own roadmap.
- Split `app.js`'s navigation wiring into its own file.
- Push the local git repo to a remote (GitHub/GitLab) — it currently exists only on this Mac.

**Nice to have**
- Point-to-segment off-route distance math.
- Customizable pillar layout (parked idea, needs its own design pass).
- A named domain instead of the default `.pages.dev` subdomain.

**Long-term vision**
- Real-time crowd/noise data layered into the calm-routing score, if a suitable data source is found.
- Native app packaging (App Store / Play Store) once real usage validates the concept — needs paid developer accounts and a privacy policy first.
- Record-your-own audio/haptic editing tools (a real scope increase, undefined interaction model today).

---

## 8. Business Readiness

| Stage | Ready? | Why |
|---|---|---|
| **Private alpha** (Antonio + a handful of friends/classmates) | **Yes, now** | Deployed, tested, no known crashes, no secrets exposed. This is exactly the audience the project's own testing script (`PRESENTING.md`) is written for. |
| **Closed beta** (a wider but bounded group) | **Not yet** | No rate limiting on the shared API key — a handful of enthusiastic testers could exhaust the daily quota for everyone. Needs the "Critical" items above first. |
| **Public beta** | **No** | No Privacy Policy, no analytics/error visibility once real strangers are using it, unvalidated core UX hypothesis (calm routing has never been tested with real target users beyond one informal session). |
| **Production launch** | **No** | All of the above, plus: no monitoring, single-developer/no-remote-backup git history, unrotated key, and — most importantly — the core design bet is still unvalidated by real research. |

**Biggest risks before any wider launch, ranked:**
1. **Unvalidated core hypothesis.** The entire "calm routing helps sensory-sensitive users" premise rests on desk research and one informal test, not real target-user interviews (Stage 4/15, explicitly still pending in the project's own docs). This is a research risk, not an engineering one — no amount of further code polish fixes it.
2. **Shared API quota with no rate limiting.** A single free-tier key now serves every visitor to the public URL. Cheap to fix, but unfixed today.
3. **No error visibility in production.** If something breaks for a real user right now, there is no dashboard/alert that would tell anyone — only a `wrangler pages deployment tail` session would catch it live.
4. **Single point of failure for the source.** The git repo exists only on one machine, unpushed. A lost laptop is a lost history (though the deployed site itself would keep running).

---

## 9. Known Issues

Consolidated from §3's per-feature notes and §6's technical debt — nothing here is new, this is just the "if you only read one list" version:

- No true point-to-segment off-route distance math (nearest-vertex approximation; accurate within the margin at current GPS/route density, not mathematically exact).
- Special-event awareness covers exactly 2 hardcoded dates (King's Day, New Year's Eve) — not a live calendar.
- No offline routing — the PWA caches the app shell, but a route search still needs a live connection to the proxy/GraphHopper.
- Pressing "Find calm route" fires 1 route request always, plus a geocode request per field only when that field wasn't just resolved via an autocomplete selection; those fail fast (~10-50ms) in demo mode rather than hang, so it's an efficiency note, not a UX problem.
- No nearby-destinations/recent-searches quick-pick in the destination autocomplete field — deliberate scope cut, not a gap (would require deciding on and storing search history).
- **Native app is unverified**: implemented and reviewed, but never compiled or run — see MOBILE_TESTING_CHECKLIST.md. The single highest-priority item before this report can call the native app "done" in any real sense.
- Native background ambient audio is one generic noise loop, not the web app's 11 soundscapes — Web Audio API cannot run once the WebView is suspended; see IOS_/ANDROID_BACKGROUND_NAVIGATION.md.
- Native reroute uses GraphHopper's first returned path, not routing.js's calm-vs-fastest scoring — a native-side simplification, not present on the web/foreground path.
- App icons for iOS/Android were generated from a 512×512 source; Apple recommends 1024×1024 for the App Store marketing icon specifically — regenerate from a higher-resolution source before real submission.
- No error boundary / global crash handler for the DOM-wiring layer (`app.js`) — the one real instance of this class of bug (sound-canvas crash) was found and fixed in this pass, but nothing structurally prevents a new one.
- `app.js` is a single ~1000-line file; readable but the largest in the project by a wide margin.
- The previously-exposed GraphHopper key has not yet been rotated (action item, needs Antonio's GraphHopper dashboard access — see §4).
- Git history exists only on this machine — no remote has been configured yet.

## 10. Maintenance Notes

Full detail lives in `HANDOFF.md`; the short version:
- Run `npm test` (119 tests, ~0.35s) before every deploy, then do a real manual smoke test on the live URL — the DOM-wiring layer has zero automated coverage. Note: during manual testing, a normal browser reload does not reliably bypass the cache against a running `wrangler pages dev` — use a cache-busting query string or a true hard reload if a just-saved fix doesn't seem to be taking effect.
- Deploy the web app with `npm run deploy` (`wrangler pages deploy .`) — no build step, ships the working tree as-is.
- For the native app: `npm run cap:sync` after **any** change to `app.js`, `index.html`, or anything under `shared/`/`web/`/`native/` — the native projects only see `www/`, a generated copy, not a live reference. After changing Swift/Kotlin under `plugins/calm-nav-background/`, `npx cap sync` alone is enough (Xcode/Android Studio compile the sources directly).
- `PROJECT_STATUS.md` is the living "what's actually true" doc; update it alongside any nontrivial fix, don't let it drift the way `README.md` had before this pass.
- Any new third-party API key follows the same pattern as GraphHopper: a Cloudflare Pages Function + `wrangler pages secret put`, never client-side `config.js`, and never inside the native bundle either.
- If a new top-level script/stylesheet is added, add it to `sw.js`'s `APP_SHELL` list too, or it won't be cached for offline/returning visitors.

## 11. Production Readiness Score: 82/100

Up from the 78/100 assessed earlier the same day (post-security-fix, pre-documentation-pass), reflecting: accurate, non-stale documentation across all three docs; a written deployment/testing checklist instead of tribal knowledge; and a fully reconciled known-issues list. Still short of 100 for reasons that are mostly *not* code-fixable in a further pass — see §8's business-readiness gates (unvalidated core UX hypothesis, no rate limiting, no monitoring, unrotated key, unpushed git remote). Those are the actual gate to the next score tier, not additional engineering polish on what's already here.

**This score describes the web/PWA app only.** The native iOS/Android app added afterward is a separate, much earlier-stage artifact: fully implemented and internally reviewed, but 0% device-verified (never compiled — see MOBILE_TESTING_CHECKLIST.md). It should not be read into this number at all until a real build/test pass happens.

## 12. Changelog

**0.5.0 — 2026-07-28**
- Added: native iOS/Android app via Capacitor, wrapping the existing web app unmodified. Custom `calm-nav-background` plugin (Swift + Kotlin): background-capable GPS tracking, native TTS voice guidance, Android persistent notification, iOS Now Playing/Control Center lock-screen controls, native reroute-with-backoff calling the same Cloudflare Functions proxy.
- Added: `shared/`, `web/`, `native/` — a platform-agnostic interface layer (`NavBridge`) so `app.js` never talks to `navigator.geolocation`/`AudioManager`/etc. directly for anything nav-related, enforcing a single-engine invariant across web and native.
- Added: 19 new tests covering the native-support pure logic (route-payload validation, reroute backoff, foreground-state reconciliation) and the Cloudflare Functions' CORS behavior.
- Changed: `functions/api/route.js` and `functions/api/geocode.js` now send a permissive CORS header — required because the native app's WebView origin differs from the Cloudflare Pages origin, making these cross-origin requests.
- Fixed during the build (see PROJECT_STATUS.md's 2026-07-28 native build entry for full detail): a script-load-order bug that would have made every native build silently behave as the web build; the web deployment's `index.html` never actually loading the new interface layer at all (would have crashed on load); the custom plugin not actually being linked into the generated Xcode project (Capacitor 8 requires SPM, not a podspec); one Kotlin file with leftover invalid Swift syntax.
- **Not done in this pass**: compiling, running, or device-testing the native app — no Xcode/Android SDK/Java in the authoring environment. See MOBILE_TESTING_CHECKLIST.md.
- 119/119 tests passing.

**0.4.0 — 2026-07-28**
- Added: location-aware address autocomplete on both start/destination fields — live suggestions (addresses, streets, stations, parks, landmarks), debounced + stale-response-safe, full keyboard/touch/mouse support, ARIA combobox pattern, "Use my current location" (start field only).
- Added: three new modules (`searchranking.js`, `geocodingservice.js`, `autocompletecontroller.js`) and 61 new tests (17+12+13 unit tests plus 17+2 covering the rewritten `functions/api/geocode.js`), all passing alongside the previous 39.
- Changed: `functions/api/geocode.js` now supports reverse geocoding, validates all params server-side, applies a request timeout, and whitelists response fields — previously forward-search-only with no validation.
- Fixed: `sw.js` now excludes `/api/*` from its cache (previously same-origin GET requests, including geocode/route, were cacheable — harmless at low volume but wrong given autocomplete's per-keystroke request pattern).
- Fixed: the start/destination inputs had no visible keyboard-focus indicator at all (`outline: none` silently overrode an existing `:focus-visible` rule) — now the whole row shows a visible focus ring.
- 100/100 tests passing.

**0.3.0 — 2026-07-28**
- Fixed critical bug: sound-canvas visualizer crashed on every load (undefined-variable typo), silently blank since day one.
- Fixed: one-sided geocode failures now reported per-field instead of silently swallowed.
- Fixed: race condition on overlapping search requests (safety-toggle/travel-mode mid-search).
- Fixed: no network timeout on routing requests — added 12s AbortController timeout.
- Fixed: map tile-rendering gaps after every search (stale Leaflet container size).
- Fixed: route-comparison cards rendered after the Start button instead of before it.
- Security: moved the GraphHopper API key out of client-side code entirely, behind two new Cloudflare Pages Functions. Verified zero occurrences in the deployed bundle.
- Accessibility: reduced-motion toggle now respects the OS-level preference on load; both ambient canvas animations pause when idle, backgrounded, or reduced-motion is on.
- Docs: rewrote `README.md`'s stale sections (config/secrets, running instructions, next-steps), added this report and `HANDOFF.md`.
- 39/39 tests passing (2 new: timeout fallback, proxy-security regression).

**0.2.0 — 2026-07-27**
- Initial git history (project existed on disk before this; first commit imports the working prototype).
- Added PWA support: manifest, service worker, home-screen icons.
- Deployed to Cloudflare Pages for the first time.

---

*See [HANDOFF.md](HANDOFF.md) for how to actually run, deploy, and extend this project.*
