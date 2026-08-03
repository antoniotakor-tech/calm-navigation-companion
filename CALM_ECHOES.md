# Calm Echoes

Added 2026-07-28. Calm Echoes is Calm Navigation Companion's signature feature: after walking for a while, a person can leave a short Kalimba melody — and, optionally, a brief message — at the place they're standing. Another walker who passes by later can choose whether to hear it. It is one unified experience (premium instrument + recording + unlock mechanic + map discovery), not four separate features bolted together.

This document is the complete deliverables writeup: architecture, schema, API, files touched, and honest analysis of performance/privacy/security/accessibility/production-readiness, plus a manual testing checklist and deployment steps.

## Core philosophy, as implemented

- **Calm, not addictive.** No likes, comments, followers, shares, play counts, leaderboards, streaks, or engagement-optimized notifications. The only notification that exists is "Someone discovered your Calm Echo." — nothing else.
- **A discovery, not a feed.** Echoes never autoplay. A marker glows quietly on the map; a person chooses to open it, and chooses to press Play.
- **Anonymous by construction.** There are no user accounts anywhere in this app. A per-device pseudonymous token is generated client-side and immediately hashed before it is ever sent — the server never stores or sees the raw token.
- **No microphone, no imports.** A Calm Echo is a performance on the in-app Kalimba, recorded as a small sequence of note events (which tine, when, how hard) — the exact same representation the engine uses to play a *live* pluck is replayed to recreate a *saved* one. There is no audio file anywhere in this feature, consistent with the rest of the app's "everything is synthesized live, zero audio samples" convention.

## Architecture

```
Kalimba (premium instrument)          Echo lifecycle                 Discovery
──────────────────────────           ─────────────────              ─────────────
kalimbaengine.js                     echorecorder.js                 echomarkerclustering.js
  KalimbaEngine.pluck()                Record/Stop/Redo/Play/Save     clusterEchoes()
  (Web Audio synthesis,                 state machine + validation
   pentatonic tuning)                                                 app.js
                                       echovalidation.js                nearby-fetch, glowing
kalimbacontroller.js                   (shared client+server            L.divIcon markers,
  pointer/multi-touch hit-testing       validation + fuzzing +          discovery detail sheet
  (tap/doubleTap/sweep/hold)            hashing — single source
                                        of truth)                     explorationtracker.js
                                                                        unlock-rule state machine
                                                                        (500m + ~3min, speed-
                                                                         plausibility heuristic)

Backend (Cloudflare Pages Functions + D1)
──────────────────────────────────────────
functions/api/echoes/index.js         POST   /api/echoes                (create)
functions/api/echoes/nearby.js        GET    /api/echoes/nearby         (discover)
functions/api/echoes/[id]/play.js     POST   /api/echoes/:id/play       (reveal melody + notify)
functions/api/echoes/[id].js          DELETE /api/echoes/:id            (creator deletes own)
functions/api/echoes/notifications.js GET    /api/echoes/notifications  (poll, fetch-and-consume)
```

**Why a melody is a JSON array, not a media file.** The Kalimba's entire sound comes from `KalimbaEngine.pluck(tineIndex, velocity)` — a pure function of (which of 11 tines, how hard). Recording a performance is therefore just capturing the sequence of `{t, tine, v}` events as they happen (`echorecorder.js`'s `applyRecorderAction` reducer), and playback is replaying that exact sequence through the exact same engine. This sidesteps microphone permissions, `MediaRecorder`, audio encoding, and object storage entirely — a melody is typically a few hundred bytes of JSON, not a media blob — while structurally guaranteeing "Kalimba performances only" (there is no code path that accepts any other kind of audio).

**Why the Kalimba is pentatonic (11 tines, C major pentatonic across ~2 octaves).** On a pentatonic scale, no combination or order of notes is dissonant. This is what makes "anyone can create something that sounds good, no music lesson required" true by construction rather than by hoping the user plays carefully.

**Why exploration tracking uses its own location watch** (`NavBridge.location.start()` in `app.js`), separate from the turn-by-turn navigation watch (`navWatchId`). Calm Echoes is a property of real-world walking, independent of whether the user is actively following a route — coupling it to the nav-specific fix pipeline would mean unlock progress stalls unless a route is active, which contradicts the feature's own premise. The tradeoff, stated plainly: during active navigation this means two concurrent GPS subscriptions running at once, a modest battery cost accepted in exchange for correctness and architectural independence.

**Why "remain in the area" is a session timer, not a geofenced dwell-region.** The unlock rule (walk ≥500m AND spend ~3 minutes) is implemented as continuous distance-walked and continuous session-elapsed-time since the last Echo was left (or since the app started), reset only when an Echo is actually left (`explorationtracker.js`'s `consumeUnlock`). A true "stayed within one physical area" concept would require clustering GPS fixes into visited regions, which the spec's own wording doesn't strictly require and which the simpler session-based interpretation already satisfies in practice: it prevents exactly the failure mode the rule exists to prevent (instantly re-triggering the CTA without having gone anywhere or spent any time).

## Database schema

Cloudflare D1 (`calm-echoes` database, binding `DB`), first database this project has ever provisioned. Full SQL in `migrations/0001_create_echoes.sql`.

```sql
CREATE TABLE echoes (
  id TEXT PRIMARY KEY,                 -- uuid, generated server-side
  lat REAL NOT NULL,                   -- FUZZED display latitude (10-20m offset, see Privacy)
  lon REAL NOT NULL,                   -- FUZZED display longitude
  created_at INTEGER NOT NULL,         -- unix ms
  message TEXT,                        -- <=100 chars, nullable
  nickname TEXT,                       -- <=24 chars, nullable ("Anonymous" applied client-side)
  melody_json TEXT NOT NULL,           -- [{t,tine,v}, ...] — see Architecture
  duration_ms INTEGER NOT NULL,        -- 2000-20000
  creator_token_hash TEXT NOT NULL,    -- sha-256 hex of the client's device token — NEVER the raw token
  moderation_status TEXT NOT NULL DEFAULT 'visible',
  play_count INTEGER NOT NULL DEFAULT 0 -- internal only; no API response ever exposes this
);
-- Indexes: lat, lon (bounding-box prefilter for nearby search),
--          (creator_token_hash, created_at) (rate limiting + ownership)

CREATE TABLE echo_notifications (
  id TEXT PRIMARY KEY,
  echo_id TEXT NOT NULL REFERENCES echoes(id) ON DELETE CASCADE,
  creator_token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0
);
```

No `users` table exists anywhere — there are no accounts. `creator_token_hash` is the entire identity model, and it cannot be reversed to recover the device token that produced it.

## API endpoints

All under `/api/echoes`, implemented as individual Cloudflare Pages Functions (file-based routing) in `functions/api/echoes/`. Every endpoint validates through `echovalidation.js` — the same module `echorecorder.js` uses client-side — so client and server can never silently disagree on what's valid.

| Method | Path | Purpose | Notes |
|---|---|---|---|
| `POST` | `/api/echoes` | Create an Echo | Validates payload, checks the 5/day rate limit (`creator_token_hash` + `created_at` in the last 24h), fuzzes the location 10-20m before storing, hashes the creator token, never echoes the raw token back |
| `GET` | `/api/echoes/nearby?lat=&lon=&radiusM=` | Discover nearby Echoes | Bounding-box prefilter (indexed columns) + exact haversine filter (D1/SQLite has no native great-circle function); `radiusM` is clamped server-side (max 2000m) regardless of what's requested; **48h visibility window** (added 2026-08-03) — a `created_at > ?` cutoff excludes anything older; **never returns the melody** — only enough for a marker + detail sheet |
| `POST` | `/api/echoes/:id/play` | Reveal + play an Echo | The *only* endpoint that ever returns a melody; increments `play_count` (internal-only); creates a "Someone discovered your Calm Echo" notification, but only if the listener's hashed token differs from the creator's (replaying your own Echo never notifies you) |
| `DELETE` | `/api/echoes/:id?creatorToken=` | Delete your own Echo | Ownership is proven by hashing the caller's token and comparing to the stored hash — this comparison *is* the entire access-control model, since there are no sessions/accounts |
| `GET` | `/api/echoes/notifications?creatorToken=` | Poll for discoveries | Fetch-and-consume: every unseen notification returned is marked seen in the same request, so a second poll never re-delivers it |

All five endpoints were exercised end-to-end against a real local D1 instance (`wrangler pages dev`), not just unit tests — see Manual testing checklist below.

**On the 48h visibility window being hide-not-delete (2026-08-03):** the requested behavior was "Echoes last 48 hours on the map." The simplest, safest way to get that is a query-time filter — one line, fully reversible, no data actually destroyed, no destructive cron job to get wrong. A real deletion/retention policy (actually removing rows past some age, e.g. via a scheduled Worker) is a bigger, separate decision — it touches the rate-limit table's own `created_at` lookups, the `play_count`/discovery-notification history, and moderation records, none of which this pass touched. If "actually delete old Echoes" is ever wanted, treat it as its own scoped change, not a natural extension of this one.

## Files created

- `wrangler.toml` — Pages + D1 binding config (first for this project)
- `migrations/0001_create_echoes.sql` — schema
- `kalimbaengine.js` / `kalimbaengine.test.js` — synthesis engine (pentatonic tuning, pluck synthesis)
- `kalimbacontroller.js` / `kalimbacontroller.test.js` — pointer/multi-touch hit-testing, gesture-to-velocity mapping
- `echorecorder.js` / `echorecorder.test.js` — record/playback state machine
- `explorationtracker.js` / `explorationtracker.test.js` — unlock-rule pure logic
- `echovalidation.js` / `echovalidation.test.js` — shared client+server validation, fuzzing, hashing
- `echomarkerclustering.js` / `echomarkerclustering.test.js` — grid-snap map marker clustering
- `functions/api/echoes/_util.js` — shared HTTP/CORS/JSON helpers (underscore-prefixed: excluded from Pages routing)
- `functions/api/echoes/_testdb.mjs` — scriptable fake D1 for endpoint unit tests
- `functions/api/echoes/index.js` + `.test.mjs` — create endpoint
- `functions/api/echoes/nearby.js` + `.test.mjs` — nearby-discovery endpoint
- `functions/api/echoes/[id].js` + `.test.mjs` — delete endpoint
- `functions/api/echoes/[id]/play.js` + `.test.mjs` — play endpoint
- `functions/api/echoes/notifications.js` + `.test.mjs` — notifications endpoint
- `CALM_ECHOES.md` — this document

## Files modified

- `audiomanager.js` — added a 4th "instrument" mix bus (Kalimba is a live-performed instrument, distinct from ambient/voice/effects; reusing "effects" would have made its volume confusingly tied to the effects slider)
- `index.html` — new script tags; unlock CTA + shared toast inside `#mapWrap`; Kalimba overlay (wooden instrument, accessible tine buttons, record controls, message field); discovery detail sheet
- `style.css` — full Calm Echoes visual section (unlock CTA, toast, Kalimba wood/metal styling, glowing map markers); **also fixes a pre-existing latent bug**: `#map` had `position: relative` but no explicit `z-index`, so per the CSS stacking-context spec it never contained Leaflet's internal panes (which go up to `z-index: 1000` for controls) — meaning `.recenter-btn`, `.nav-banner`, `.nav-caption`, and `.nav-bottom` were all silently at risk of painting *behind* the map tiles. Discovered while debugging why the new `.echo-toast`/`.echo-unlock-cta` weren't rendering; fixed with one line (`#map { z-index: 0; }`), which also happens to fix it for the pre-existing elements
- `app.js` — the full Calm Echoes wiring section: creator-token management, exploration tracking loop, unlock CTA, Kalimba overlay open/close + recording controls + accessible-tine-button click handling, nearby-echo fetch/cluster/render, discovery detail sheet, playback wiring, notification polling
- `package.json` — `test` script extended with all new test files
- `scripts/build-web.sh` — all new root-level `.js` files added to the native-app bundle's `FILES` array

## Performance analysis

- **Audio**: every pluck is 1 short (20ms) filtered-noise transient + 3 oscillator partials — the same lightweight primitives `ambientengine.js` already uses, no new synthesis technique. A rapid sweep across all 11 tines is 11 near-simultaneous small graphs of Web Audio nodes, well within what a phone-class `AudioContext` handles.
- **Map**: nearby-fetch is throttled (only refetches on >50m movement or a 20s-elapsed fallback), and results are grid-clustered (`echomarkerclustering.js`) before rendering — a park with 30 Echoes in one corner renders as 1 marker with a count, not 30 overlapping pins. Markers use CSS animations (`transform`/`opacity`), which the existing project-wide `prefers-reduced-motion`/`data-motion="reduced"` gate already disables.
- **Network**: nearby-fetch bounding box is indexed on `lat`/`lon`; `radiusM` is capped at 2000m server-side so a client can't force a full-table scan. Melody payloads are small JSON (typically well under 5KB even at the 20s/500-event cap).
- **Battery**: the one real, disclosed cost — an independent GPS watch runs continuously while the app is open (separate from the nav-specific watch), per the architecture rationale above.

## Privacy analysis

- **Location fuzzing is real, not cosmetic.** `echovalidation.js`'s `fuzzLocation()` offsets the stored point by 10-20m at a random bearing; this happens **server-side**, and the exact coordinates a client submits are used once to compute the offset and are never written to disk anywhere. Verified live: a created Echo's stored `lat`/`lon` differs from the submitted value by ~17m in the end-to-end test run.
- **No accounts, no reversible identity.** `creator_token_hash` is a SHA-256 digest of a client-generated random token; the raw token never reaches the database, and the hash cannot be reversed. It exists only to support the 5/day rate limit and "delete your own Echo" — nothing else.
- **No location history retention.** Only the current, already-fuzzed Echo location is stored — there is no track log, no history of where a device has been, anywhere in this schema.
- **Notifications carry no location or content**: `echo_notifications` stores only an echo id and a timestamp — the fixed message text ("Someone discovered your Calm Echo.") is a constant in the endpoint code, not stored per-row.
- **Known, disclosed limitation**: the fake-GPS heuristic (below) is a speed-plausibility check only. A determined, slow, physically-plausible GPS spoof would not be caught by this or any other part of the current implementation. True mock-location detection needs native OS APIs (e.g. Android's `Location.isFromMockProvider()`) unavailable to a web build.

## Security analysis

- **Every write is server-validated**, never trusting client-side validation alone: `validateEchoCreatePayload` re-checks coordinates, duration bounds, per-event tine/velocity/timing bounds, and message/nickname length, regardless of what the client already checked.
- **Rate limiting is authoritative server-side** (5 Echoes / rolling 24h per hashed token), enforced via a `COUNT(*)` query before every insert — not just a client-side UI nicety.
- **Ownership checks use hash comparison**, not a client-supplied "is this mine" flag — a client cannot delete an Echo it doesn't hold the original token for.
- **No secrets in the client bundle**: the D1 binding is a Cloudflare Pages Functions binding, never exposed to the browser; the existing `GRAPHHOPPER_API_KEY` pattern (Pages secret, server-only) is unaffected by this feature.
- **CORS**: all five endpoints send the same permissive-but-safe `Access-Control-Allow-Origin: *` header already used by `route.js`/`geocode.js`, for the same reason (the native app's WebView is cross-origin from Cloudflare Pages; none of these endpoints use cookies/sessions, so a permissive header carries no CSRF-relevant risk).
- **Melody payload bounds**: capped at 500 note-events and a 2-20s duration window, preventing an oversized/malformed payload from being accepted as a "melody."

## Accessibility improvements

- **The Kalimba's 11 tines are real `<button>` elements**, not canvas-only — every tine is independently focusable, has a descriptive `aria-label` ("Note 1 of 11, lowest" … "Note 11 of 11, highest"), and is fully operable via keyboard (Enter/Space) or a screen reader, laid out in the same visual left-to-right order a sighted user sees. Pointer/touch users get the same tines via `kalimbacontroller.js`'s multi-touch pointer handling; the two paths are mutually exclusive per interaction (`event.detail === 0` distinguishes a keyboard-triggered click from a pointer-synthesized one), so neither double-plucks nor is neglected.
- **Both modal sheets (Kalimba, discovery detail) use the existing accessible-dialog pattern**: `role="dialog"`, `aria-modal`, `aria-labelledby`, Escape-to-close, click-outside-to-close, and return-focus-to-trigger on close — matching the app's pre-existing Settings sheet convention exactly rather than inventing a new one.
- **Reduced motion**: the marker glow-pulse, unlock-CTA glow, and toast entrance animation are all plain CSS `animation`/`transition`, already caught by the project-wide `prefers-reduced-motion`/`data-motion="reduced"` global override — no separate accessibility work was needed here because the convention was already load-bearing.
- **High contrast**: `.echo-sheet`, `.kalimba-tine-btn`, and `.echo-marker-pin` are added to the existing thicker-border high-contrast rule; the Kalimba's warm wood/metal palette is overridden to flat `--surface`/`--ink` in high-contrast mode (a themed wood gradient isn't a high-contrast-safe visual, so it's replaced outright rather than just darkened).
- **Live regions**: the record status text and both toasts use `aria-live="polite"`/`role="status"`, so a screen-reader user following along hears state changes (recording started, too short, saved) without needing to re-focus anything.
- **Known gap**: no explicit captions/haptic-off path was added specifically for Calm Echoes playback beyond what already exists app-wide (the existing captions toggle and haptics-enabled toggle both still apply, since playback reuses `AudioManager`/`HapticManager`, but there's no Calm-Echoes-specific caption of a played melody's *content* — there's no text content to caption beyond the optional message, which is already shown in the detail sheet before Play is pressed).

## Production readiness score: 6/10

Calibrated the same way `PROJECT_STATUS.md` calibrates the rest of this project: against "a coursework Design Thinking prototype," not a funded, venture-scale launch.

**What's genuinely solid (would hold up in real use):**
- The entire backend (all 5 endpoints) was verified end-to-end against a real D1 instance, not just mocked — create → fuzzed storage → nearby discovery → play + notification → ownership-checked delete, all confirmed working live.
- 99 new unit tests, all passing, covering every pure-logic module (synthesis tuning, hit-testing geometry, the recorder state machine, the unlock-rule state machine, all shared validation/fuzzing/hashing, clustering, and all 5 endpoints via a scriptable fake D1).
- The Kalimba's actual DOM/interaction wiring (record → tap tines → stop → playback → redo → cancel, and the "still finding your location" save-guard) was verified live in a browser with zero console errors.
- Privacy/security posture (fuzzing, hashing, rate limiting, ownership checks) is real, not aspirational — verified by inspecting actual stored values and actual rejected requests, not just by reading the code.

**What genuinely still needs real-device verification before calling this "done":**
- The GPS-dependent path — real walking accumulating distance/dwell time, the unlock CTA actually flipping to "ready," and a Save actually succeeding with a real device fix — was **not** exercised with real or simulated GPS in this session (the sandboxed browser environment has no path to inject fake geolocation fixes into this app's existing `NavBridge.location` watch). This is the single largest remaining gap, and it is the same category of gap this project has been honest about before (see the native-app phase's GPS/audio disclosure in `PROJECT_STATUS.md`).
- No nickname-entry UI was built (the message field exists; nickname always saves as `null`/"Anonymous"). A legitimate, disclosed scope cut for this pass, not a bug.
- Map clustering is a simple fixed-grid snap, not distance-aware/zoom-aware clustering — correct and tested, but unsophisticated at very high zoom-out levels.
- Kalimba audio has not been listened to by a human in this session (only verified: it executes without errors and the pluck/gesture logic is unit-tested) — a real listen-through on a phone speaker is worth doing before calling the instrument's *feel* finished.
- Notification polling (60s interval) is simple `setInterval` — untested at the timer-scheduling level (consistent with this project's existing convention of leaving timer/DOM-driven code to manual verification rather than unit tests).

## Manual testing checklist

Everything below marked **[done]** was actually run in this session; everything marked **[ ]** still needs a real device or a longer manual session.

- [done] Full backend round trip via `wrangler pages dev` + `curl`: create → nearby → play (with notification) → notifications poll → delete (wrong token rejected, correct token succeeds)
- [done] All 99 new unit tests + all 144 pre-existing tests pass together (243 total)
- [done] Kalimba overlay opens/closes, tine buttons pluck with no console errors, keyboard-style (`detail:0`) clicks work independently of pointer clicks
- [done] Record → Stop → (success path: message field + Redo/Play back/Save all appear correctly) → Play back (ambient duck, no errors) → Redo (clean reset) → Cancel (closes correctly)
- [done] Save correctly blocked with a clear message when no location fix exists yet (guards against a crash/silent failure)
- [done] Visual check: Kalimba wood/tine rendering, discovery detail sheet, unlock CTA + toast + recenter button all render distinctly and correctly above the map (after the z-index fix)
- [ ] Real walking test: confirm 500m + ~3min genuinely unlocks the CTA, and the progress message updates sensibly along the way
- [ ] Save an Echo with a real GPS fix, confirm it appears in `GET /api/echoes/nearby` from a second device/session nearby
- [ ] Discover a real Echo on the map, tap it, confirm the detail sheet + Play works, and the creator receives the notification on their own device
- [ ] A real "too short" recording (stop under 2s) — confirm the Redo-required message and flow
- [ ] Hit the 5th Echo of a day and confirm the 429 rate-limit message surfaces cleanly
- [ ] Screen-reader pass (VoiceOver/TalkBack) over the Kalimba tine buttons and both modal sheets
- [ ] Listen to actual Kalimba audio output on a phone speaker/headphones and judge the "premium, calm, no harsh sounds" feel subjectively
- [ ] High-contrast mode + dark mode visual pass specifically on the new Calm Echoes screens
- [ ] Confirm `npm run build:web` (the native-app bundler) still produces a working `www/` build with all the new files present

## Deployment steps

1. `npm test` — confirm all 243 tests still pass.
2. `npx wrangler d1 execute calm-echoes --remote --file=./migrations/0001_create_echoes.sql` — **already run this session**; the remote D1 database already has this schema. Only needed again if the schema changes.
3. `npx wrangler pages deploy .` — deploys the static site + all Functions (including the new `functions/api/echoes/*` routes) to `calm-navigation-companion.pages.dev`. The `[[d1_databases]]` binding in `wrangler.toml` means the deployed Functions automatically get the same `DB` binding used in local testing — no separate secret/binding setup needed beyond what's already committed.
4. Verify post-deploy: `curl https://calm-navigation-companion.pages.dev/api/echoes/nearby?lat=52.3676&lon=4.9041` should return `{"echoes":[]}` (or real data), not a 501/error.
5. For the native app: `npm run cap:sync` (runs `build:web`, which now includes every new Calm Echoes file, then `cap sync`) before the next `ios:open`/`android:open`.

**Not yet done in this session**: step 3 (the actual production deploy) — everything above it is complete and verified, but deploying to the live, publicly-reachable `pages.dev` URL is a production push affecting a real, shared deployment, so it's held for an explicit go-ahead rather than done automatically.
