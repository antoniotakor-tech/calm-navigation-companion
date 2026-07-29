# iOS Background Navigation

How `plugins/calm-nav-background/ios/Sources/CalmNavBackgroundPlugin/` keeps Calm Companion navigating with the screen locked, what it actually needs from iOS to do that, and exactly what has and hasn't been verified.

**Status: implemented, not yet run.** Everything below describes real, written Swift code — not a plan. It has not been compiled (no full Xcode in the authoring environment — see NATIVE_SETUP.md) or run on a simulator/device. Treat every claim here as "should work per Apple's documented APIs, pending a real build."

**Rebuilt 2026-07-29.** The entire `plugins/calm-nav-background/` directory (Swift, Kotlin, and the plugin's own TS/config) was lost in an unrelated local data-loss incident and did not survive — it's native code, never served by the Cloudflare Pages web deployment, so it couldn't be recovered the way every other file in this project was. This document, however, *did* survive (it's a normal file, servable like any other), and was detailed enough to serve as a faithful spec for rebuilding the plugin from scratch. Every behavior described below reflects the rebuilt source, matching this document's original intent line for line — same class names, same method contract, same CLLocationManager configuration values, same documented simplifications. The authoring environment is unchanged (still no full Xcode/CocoaPods), so the "implemented, not yet run" status is exactly as true today as it was the first time this was written.

## The single-engine invariant

There is exactly one thing allowed to process GPS fixes during active navigation: `NavigationEngine` (`NavigationEngine.swift`), owned by the plugin. `app.js`'s own `navigator.geolocation.watchPosition`-based loop is never started when `NavBridge.isNative` is true — `startNavigation()` in `app.js` branches to `startNativeNavigation()` instead, which never falls back to raw browser geolocation (WKWebView does not implement it reliably anyway, which is a separate reason this plugin exists at all, not just for backgrounding). The web-side `handleFix()` function and the native-side `handleNativeNavEvent()` function are mutually exclusive per platform — see `app.js`'s comments at both call sites.

## What genuinely survives vs. what doesn't

| Scenario | Survives? | Why |
|---|---|---|
| Screen locks, app stays in foreground process | Yes | `CLLocationManager` keeps delivering fixes; nothing special needed |
| App backgrounded (home button / swipe away, not force-quit) | Yes, **if** "Always" location was granted and `allowsBackgroundLocationUpdates` is set | Standard iOS background-location mechanism |
| App backgrounded, only "While Using" was granted | **No** | iOS suspends location delivery to backgrounded apps without "Always" — `startNavigationSession` returns `backgrounded: false` with a reason in this case; the UI is told, not left guessing |
| User force-quits the app (swipe up in the app switcher) | **No** | iOS does not resurrect a force-quit app's background location session — this is a hard OS guarantee, not a bug. Never claim otherwise. |
| iOS suspends the app under memory pressure while backgrounded (not user-quit) | Depends | With "Always" + the `location` background mode, iOS is far less likely to suspend a genuinely tracking app, but it is not impossible under extreme memory pressure — untested |

## Permission staging (never request "Always" on first launch)

1. **First navigation start**: `startNativeNavigation()` in `app.js` calls `getPermissionStatus()`; if foreground isn't granted, `requestForegroundLocationPermission()` triggers the standard "While Using" system prompt. This is the only permission requested before the user has done anything.
2. **Only if the user checks "Keep navigating when the screen locks"** (a checkbox in the routing page, hidden entirely on the web build) does `requestBackgroundLocationPermission()` ever run — and only after foreground is already granted, since iOS requires that ordering. This calls `CLLocationManager.requestAlwaysAuthorization()`, which iOS presents as an upgrade prompt ("Change to Always Allow?") rather than the harsher first-ask dialog, because foreground use already established trust.
3. If the user declines the upgrade, navigation still proceeds in foreground-only mode — `backgroundNavNote` in the UI explains this, sourced directly from the plugin's returned `reason` string, never a generic message.

`Info.plist` requires **both** `NSLocationWhenInUseUsageDescription` and `NSLocationAlwaysAndWhenInUseUsageDescription` for step 2's prompt to work at all, even though only the first is shown at step 1 — both are present (see `ios/App/App/Info.plist`).

## Capabilities and CLLocationManager configuration

- **Background Modes**: `location` and `audio`, declared in `Info.plist`'s `UIBackgroundModes`. `location` is a hard prerequisite for `allowsBackgroundLocationUpdates = true` — setting that flag without the mode present is an Apple-documented programmer error that asserts in debug builds. `audio` keeps `AVSpeechSynthesizer` and the ambient noise loop audible with the screen locked.
- **`allowsBackgroundLocationUpdates`**: only ever set `true` when `CLLocationManager.authorizationStatus == .authorizedAlways` (checked in `NavigationEngine.start()`) — never optimistically.
- **`showsBackgroundLocationIndicator = true`**: shows iOS's own blue-pill/status-bar location indicator while backgrounded, so the user always has an OS-level (not just in-app) signal that location is active.
- **`pausesLocationUpdatesAutomatically = false`**: deliberate. iOS's automatic pause heuristic is tuned to detect "car parked, stationary" and would inappropriately pause updates during a legitimate pedestrian pause (waiting at a crossing) mid-walk/bike navigation. The tradeoff is battery: this is named explicitly in `MOBILE_TESTING_CHECKLIST.md` and the in-app battery notice.
- **`activityType = .fitness`**: the closest match for walking/biking navigation among `CLActivityType`'s cases (`.otherNavigation` was the other candidate — `.fitness` was chosen since this app never supports car mode, and fitness better reflects the pace/movement pattern iOS should expect).
- **`desiredAccuracy = kCLLocationAccuracyBestForNavigation`**, **`distanceFilter = 5`** meters — appropriate for on-foot/bike precision; deliberately not used for the separate one-shot/ambient location path (`AmbientLocationManager.swift`, used by autocomplete's "use current location"), which asks for less.

## Handled failure modes

- **Permission denied** (foreground or background): surfaced via `startNavigationSession`'s `reason` string and `getPermissionStatus()`; navigation still works foreground-only if only background was denied.
- **Reduced accuracy** (`CLAccuracyAuthorization.reducedAccuracy`, iOS 14+): detected in `start()`, appended to the returned `reason` so the UI can explain that off-route detection may be less reliable — not silently ignored.
- **Location Services disabled system-wide**: checked via `CLLocationManager.locationServicesEnabled()` before starting anything.
- **Background permission revoked mid-session** (user opens Settings while navigating): `locationManagerDidChangeAuthorization` detects the downgrade, turns off `allowsBackgroundLocationUpdates`, and emits an `error` event rather than silently continuing to claim background capability.
- **App terminated by the user**: not handled, not claimed — see the table above.
- **Significant GPS accuracy degradation**: not separately thresholded beyond the existing off-route distance check (`OFF_ROUTE_M`, mirrored from `navlogic.js`) — a large accuracy value doesn't currently widen the off-route tolerance. Worth adding if real-world testing shows false off-route triggers in poor-GPS areas (tall buildings, tunnels).

## Voice, audio session, and lock-screen controls

- **Native `AVSpeechSynthesizer`**, not the WebView's Web Speech API — a suspended WKWebView does not run JavaScript at all, so Web Speech API calls from `app.js` would simply never fire once backgrounded. All nav announcements route through `NavigationEngine.speak()`, mirroring `voiceengine.js`'s distance-banding/dedup logic (`VOICE_NEAR_M`/`VOICE_FAR_M`, a `Set` of already-announced step/band keys) by hand, since Swift and JS can't share source.
- **`AVAudioSession`**: category `.playback`, mode `.voicePrompt`, options `[.duckOthers, .mixWithOthers]` — ducks (doesn't silence) other apps' audio during a spoken instruction, and mixes with music apps the rest of the time rather than claiming exclusive audio. Interruptions (phone calls, Siri) are handled via `AVAudioSession.interruptionNotification`; on `.ended` with `.shouldResume`, the session is reactivated automatically.
- **Ambient sound in the background**: a single generic filtered-noise loop (`AVAudioEngine` + a generated `AVAudioPCMBuffer`), **not** a port of the web app's 11 procedurally synthesized soundscapes (`ambientengine.js`) — Web Audio API cannot run once the WebView is suspended, so *some* native ambient implementation was required for "ambient audio continues" to be true rather than silently false. If the user had "Birds" selected on the web UI before backgrounding, the native fallback plays generic noise instead — a named simplification, not a hidden bug.
- **Lock-screen controls**: `MPNowPlayingInfoCenter` (title = current instruction, artist = destination, album = distance to next turn) + `MPRemoteCommandCenter`. `stopCommand` maps to "Stop navigation." `pauseCommand`/`playCommand` are repurposed as mute/unmute — MPRemoteCommandCenter has no native "mute this app's speech" command, and Now Playing/Control Center (built for media playback) is the most appropriate *supported* lock-screen surface available without building a full Live Activity.
- **Live Activities (iOS 16.1+, ActivityKit)**: considered, not implemented. A real Live Activity needs a separate Widget Extension target, an App Group entitlement, and its own SwiftUI layout — a substantial addition beyond what a Capacitor plugin alone provides, and explicitly not required by the brief ("do not make them a requirement for basic navigation"). Now Playing info is the actual lock-screen presentation shipped here.

## Known simplifications (stated once, not hidden)

- **Reroute** takes GraphHopper's first returned path (`performReroute()`), not routing.js's calm-vs-fastest scored choice — recomputing that scoring natively is future work.
- **Ambient audio** is one generic noise loop, not 11 soundscapes (above).
- **Road-class-aware ambient level** (`suggestAmbientLevel` in `navlogic.js`) is not ported natively — the background engine doesn't adjust ambient volume by road type the way the foreground web UI does.
- **Point-to-segment route distance** uses the same nearest-vertex approximation as the existing web app (`nearestRouteIndex`), not exact point-to-segment — consistent with, not worse than, the web app's own documented limitation.

## Keeping the ported engine in sync with navlogic.js

`NavigationEngine.swift` does not import or share code with `navlogic.js` — Swift and JavaScript can't share source. It reads its thresholds (`ARRIVE_STEP_M`, `ARRIVE_DEST_M`, `OFF_ROUTE_M`, `OFF_ROUTE_STREAK_NEEDED`, `HEADING_MIN_SPEED_MPS`) from the `NavRoutePayload` the JS side builds from `NavLogic.THRESHOLDS` directly (`shared/routeTransfer.js`), so those numbers can't silently drift apart. The *algorithm* (nearest-vertex distance, hysteresis counter, step-advance loop) is hand-mirrored and duplicated — if `navlogic.js`'s `processFix()` logic changes, `NavigationEngine.swift`'s `locationManager(_:didUpdateLocations:)` must be updated to match by hand. There is no automated check for this today.

## Files

- `CalmNavBackgroundPlugin.swift` — Capacitor-facing methods (`@objc`/`CAPBridgedPlugin`), thin delegation to `NavigationEngine`.
- `NavigationEngine.swift` — the actual engine: location math, voice, audio session, Now Playing, native reroute.
- `AmbientLocationManager.swift` — separate, foreground-only one-shot/continuous location for autocomplete, never used for the nav loop.
- `RouteModels.swift` — Codable structs mirroring `shared/routeTransfer.js`'s payload shape.
