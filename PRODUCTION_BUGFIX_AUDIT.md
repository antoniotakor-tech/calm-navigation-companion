# Production Bugfix Audit — 2026-07-29

Two release-blocking bugs found in manual testing, root-caused and fixed. Both trace back to the **same underlying defect**: `startNavigation()` had no protection against being invoked more than once while a session was already active.

## Bug #1 — Navigation audio "hopping" / stuttering

### Root cause

`startNavigation()` created a new `navigator.geolocation.watchPosition()` subscription every time it ran, but never checked whether one was already active and never cleared the previous one — it simply overwrote the `navWatchId` variable, silently leaking the old subscription. Any of the following real-world sequences left **two or more independent watchers alive at once**, all feeding the same shared `navState`:

- A double-tap on "Start Navigation" (trivially easy on a touchscreen, especially with any UI lag)
- Tapping "Start Navigation" then "DEV: Simulate GPS" (or vice versa) before the first had visibly taken over
- Any retry of the async native-permission flow

Every GPS fix was then processed **once per leaked watcher**: `NavLogic.processFix()` ran redundantly, the camera-pan animation restarted mid-flight from a second, near-simultaneous call, the marker tween kept getting cancelled and re-started, haptic turn-tick sounds fired multiple times per real turn, and — the reported symptom — `voice.announce()` calls piled up faster than `VoiceQueue` could cleanly sequence them, producing the audible "hop/stutter/brief repeat."

This is a single root cause, not five separate ones — but it happens to match nearly every mechanism listed in the request (duplicate playback, multiple listeners, state sync, race conditions, timing) because a leaked location source touches all of them at once.

### Fix

Not a debounce or a delay — a structural guarantee. A new `stopActiveLocationSource()` function unconditionally tears down *any* possibly-active location source (real GPS watch, the dev simulator, or a native background session) and is now called **unconditionally at the top of `startNavigation()`**, before anything else runs. This makes "at most one location source is ever active" true by construction, regardless of how many times or in what order the function is triggered. `startNavBtn`/`simBtn` are also disabled for the duration of a session (re-enabled only in `endNavigation()`) as a second, independent layer that stops a rapid double-tap from ever reaching the function body at all.

The identical defect existed in the native plugin rebuilt in the previous session, for the same reason (never having been exercised, since it can't be run in this environment):
- **iOS**: `NavigationEngine.swift`'s `setupNowPlaying()` called `MPRemoteCommandCenter`'s `addTarget()` on every `start()`, which *adds* a handler rather than replacing one — a second `start()` would have registered duplicate Stop/Mute command targets, firing a single lock-screen tap's JS event twice.
- **Android**: `NavigationForegroundService.kt`'s `startLocationUpdates()` registered a new `LocationManager` listener without removing the previous one — the exact same leak as the web bug, one layer down.

Both were fixed the same way: unconditionally tear down (`stop()` / `stopLocationUpdates()`+`ambientNoise.stop()`+`engine.stop()`) before starting.

### Verification

- **Reproduced live, before the fix**: patched `navigator.geolocation.watchPosition`/`clearWatch` to count real calls. Three rapid clicks on Start produced **three separate watch IDs, zero clears** — confirmed the exact leak.
- **After the fix**: the same three-click test produced **exactly one** watch call; both buttons correctly locked after the first click.
- **Cross-path test** (Start, then Simulate, with geolocation stubbed to remove timing noise from this environment's permission auto-denial): the second trigger was fully blocked — no new watch, no new clear, simulate badge never appeared.
- **Clean restart cycle**: End → re-enables both buttons → Start again creates a fresh single watcher, old one properly cleared.
- **Stress test** (explicitly requested): started simulated navigation with a **triple-click** (the exact bug trigger), instrumented `speechSynthesis.speak()`, and let the session run ~3.5 minutes of simulated walking. Result: 3 distinct announcements, correctly spaced (98s and 108s apart), **zero duplicate text**, navigation state (distance/ETA) progressing smoothly throughout.
- `npm test` — 257/257 passing, no regressions.

## Bug #2 — Unexpected text-edit/undo popup during navigation

### Root cause

Two contributing gaps, both real:

1. **Lingering focus.** The route-search page's `startInput`/`endInput` fields are still present in the DOM during full-screen navigation (just resized to zero size by `.nav-active`'s CSS), not removed or disabled. If a user tapped "Start Navigation" while one of these fields still had focus (e.g., they were mid-edit and tapped Start without dismissing the keyboard first), nothing in `startNavigation()` ever cleared that focus. Confirmed this matters specifically for the real target platform: this test browser happens to move focus to a tapped `<button>` automatically (masking the issue here), but **iOS Safari/WKWebView does not** — a real iPhone could carry a focused-but-invisible text input straight into navigation mode, where a later long-press or system gesture can surface the OS's own text-edit/undo popup for that still-focused field.
2. **No selection/callout hardening.** Nothing in the stylesheet disabled text selection or iOS's long-press callout menu for the navigation UI's own text (instruction, distance, ETA). A long-press or press-drag on that text — very plausible while walking and glancing at the phone — could trigger the native text-selection magnifier and its Cut/Copy/Look Up bubble on a real device, independent of the focus issue above.

### Fix (three independent layers, not a single patch)

1. **`app.js`** — `startNavigation()` now explicitly blurs `document.activeElement` before entering full-screen mode, unconditionally, regardless of what browser-specific click-focus behavior might otherwise have done.
2. **`style.css`** — `.app-shell.nav-fullscreen` now sets `user-select: none` and `-webkit-touch-callout: none`. Deliberately *not* exempting inputs within that scope — the only inputs present (`startInput`/`endInput`) have no legitimate reason to be selectable or editable while navigation owns the screen.
3. **`app.js`** — a `contextmenu` listener scoped to `nav-fullscreen` calls `preventDefault()`, as a platform-agnostic backstop in case any browser/WebView combination still surfaces a native menu despite the CSS (Android WebView's long-press handling doesn't always fully respect `user-select`).

### Verification

- Focused `startInput` directly, then started simulated navigation: `document.activeElement` was confirmed `<body>` (blurred), not the input — before the fix this browser's own click-focus behavior masked the bug, so this was tested by focusing the input via script immediately before the button click, not relying on a real tap's side effects.
- Confirmed `getComputedStyle` on `.nav-fullscreen` reports `user-select: none`.
- Dispatched a synthetic `contextmenu` event while in nav mode — confirmed `preventDefault()` was called; dispatched the same event with navigation ended — confirmed it was *not* prevented (the fix doesn't leak outside navigation).
- `npm test` — 257/257 passing, no regressions.

## Files modified

- `app.js` — `stopActiveLocationSource()` (new), `startNavigation()` (guard, teardown-first, focus blur), `endNavigation()` (delegates teardown to the shared function, re-enables buttons), new `contextmenu` listener.
- `style.css` — `.app-shell.nav-fullscreen` selection/callout hardening.
- `plugins/calm-nav-background/ios/Sources/CalmNavBackgroundPlugin/NavigationEngine.swift` — `start()` now tears down an existing session first.
- `plugins/calm-nav-background/android/src/main/java/com/calmnav/background/NavigationForegroundService.kt` — `startNavigation()` now tears down an existing session first.

## Re-audit of these two systems

Re-examined both systems fresh against the same "would I ship this" bar as the earlier production audit, specifically for anything else in the same class:

- Checked every other place a location/audio session can be torn down (`reroute()`, `handleFix()`'s arrival branch, `endNavigation()` itself) — all correctly guarded (`navRerouting` flag, single `stopActiveLocationSource()` call site) with no other leak pattern found.
- Checked `VoiceQueue`/`VoiceEngine` directly for race conditions in the dedup logic itself (not just the multi-watcher symptom) — the FIFO queue, urgent-clears-pending-not-current behavior, and `spoken` Set dedup are all correct as designed; no changes needed there.
- Checked `NavSimulator.start()` — already self-guards (`stop()` first) independent of this fix; confirmed as already-correct, not newly touched.
- Checked for other focusable elements that survive into nav-fullscreen mode besides `startInput`/`endInput` — none found; the new CSS hardening covers the nav card text broadly, not just those two fields.
- No regressions: full existing test suite (257 tests) passes unchanged; manually re-verified the full search → start → smart-controls → camera/marker → stop flow still works correctly end-to-end after these changes.

**Verdict**: both fixed at the root cause, not patched at the symptom. Confident to ship.
