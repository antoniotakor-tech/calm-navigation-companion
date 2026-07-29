# Android Background Navigation

How `plugins/calm-nav-background/android/` keeps Calm Companion navigating with the screen locked, what it needs from Android to do that, and exactly what has and hasn't been verified.

**Status: implemented, not yet run.** Everything below describes real, written Kotlin code — not a plan. It has not been compiled (no JDK/Android SDK in the authoring environment — see NATIVE_SETUP.md) or run on an emulator/device. Treat every claim here as "should work per Android's documented APIs, pending a real build."

**Rebuilt 2026-07-29.** The entire `plugins/calm-nav-background/` directory was lost in an unrelated local data-loss incident and did not survive — it's native code, never served by the Cloudflare Pages web deployment, so it couldn't be recovered the way every other file in this project was. This document survived, and was detailed enough to serve as a faithful spec for rebuilding the plugin from scratch — same class names, same method contract, same foreground-service configuration, same documented simplifications. The authoring environment is unchanged (still no JDK/Android SDK), so "implemented, not yet run" is exactly as true today as the first time this was written. One implementation detail worth flagging as genuinely new (not just restored): `CalmNavBackgroundPlugin.kt`'s `proceedStart()` binds to `NavigationForegroundService` and calls `startNavigation()` after a fixed 300ms delay to let the async bind complete, rather than a proper `onServiceConnected`-triggered continuation — a pragmatic simplification flagged here for real-device verification of actual bind timing, not a hidden bug.

## The single-engine invariant

`NavEngine.kt` (business logic) is fed location fixes exclusively by `NavigationForegroundService.kt` (the Android system resource owner — `LocationManager`, the persistent notification, audio focus). `app.js` never starts its own `navigator.geolocation.watchPosition` loop when `NavBridge.isNative` is true — see `app.js`'s `startNativeNavigation()`, which never falls back to raw browser geolocation (Android's WebView doesn't reliably implement it either, a separate reason this plugin exists). `handleFix()` (web) and `handleNativeNavEvent()` (native) are mutually exclusive per platform.

## What genuinely survives vs. what doesn't

| Scenario | Survives? | Why |
|---|---|---|
| Screen locks, app stays in the foreground process | Yes | `LocationManager` keeps delivering fixes regardless |
| App backgrounded (home button / switched away, not force-stopped) | Yes | `NavigationForegroundService` is a genuine Android foreground service with a persistent notification — the OS is far less likely to kill it than a background service, by design of the platform |
| User force-stops the app from Android's own Settings/recent-apps "remove" | **No** | Android tears down the whole process, service included — no different from any other Android app. Never claim otherwise. |
| OEM battery-optimization / "aggressive doze" (Xiaomi, Huawei, OnePlus, Samsung, etc.) kills the service anyway | Possible, not guaranteed prevented | These manufacturer-specific battery managers routinely kill foreground services despite doing everything Android's own APIs ask for. This is a well-known, widely-documented platform-fragmentation problem, not something a foreground service declaration can fully defeat. Users on affected OEMs may need to manually exempt the app in their battery settings (`MOBILE_TESTING_CHECKLIST.md` calls this out explicitly as a test case, not a guarantee) |
| OS kills the service under genuine memory pressure | Possible | `onStartCommand` deliberately returns `START_NOT_STICKY` — if the OS kills the process, navigation ends rather than silently restarting with no route state. This is an honest choice: a silent restart-with-no-context would be worse than a clearly ended session |

## Permission staging (never request background permission on first launch)

1. **First navigation start**: `startNativeNavigation()` in `app.js` calls `getPermissionStatus()`; if foreground (`ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION`) isn't granted, `requestForegroundLocationPermission()` triggers Android's standard runtime permission dialog.
2. **Only if the user checks "Keep navigating when the screen locks"** does `requestBackgroundLocationPermission()` run — and only on Android 10+ (`ACCESS_BACKGROUND_LOCATION` doesn't exist as a separate grant before that), and only after foreground is already granted, since Android 11+ actively refuses to show the background prompt otherwise (it requires going through Settings' "Allow all the time" option, which the OS presents at its own discretion once foreground trust is established).
3. **Android 13+ notification permission (`POST_NOTIFICATIONS`)**: requested just-in-time, immediately before the foreground service actually starts (`startNavigationSession`'s permission-callback chain in `CalmNavBackgroundPlugin.kt`) — not on first launch, and not bundled with the location request, since it's a conceptually separate permission for a separate reason (the user needs to *see* the notification, not just allow location).
4. If background location is declined, navigation still proceeds in foreground-only mode via the same foreground service (still no raw WebView geolocation fallback) — `backgroundNavNote` explains this using the plugin's own returned `reason` string.

## Foreground service configuration

- **`NavigationForegroundService`** is declared with `android:foregroundServiceType="location"` in the plugin's `AndroidManifest.xml` (merged into the app manifest by Gradle automatically) — required on Android 10+, enforced more strictly on Android 14 (both the manifest declaration and the runtime `ServiceCompat.startForeground(..., FOREGROUND_SERVICE_TYPE_LOCATION)` call are present, per Android 14's stricter requirement that both agree).
- **Started only when the app is visible and the user explicitly starts navigation** — `context.startForegroundService(intent)` is called exclusively from `CalmNavBackgroundPlugin.startNavigationSession()`, itself only reachable from `app.js`'s user-initiated `startNativeNavigation()`. Never started from a background trigger, satisfying Android's restricted-foreground-service-launch rules by construction, not by a runtime check.
- **Persistent notification** (`buildNotification()` in `NavigationForegroundService.kt`) shows: current instruction, distance to next turn + destination, a "Stop navigation" action, and a "Mute"/"Unmute" action, plus tapping the notification body returns to the app. Rebuilt on every maneuver event (`updateNotification()`), never silently stale.
- **`LocationManager.GPS_PROVIDER`** with a 2-second minimum interval and 3-meter distance filter — chosen over Google Play Services' Fused Location Provider specifically to avoid adding a Play Services dependency to this plugin; a fused/network blend is a named future enhancement, not implemented here.
- **Audio focus**: `AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE` + transient gain (`AUDIOFOCUS_GAIN_TRANSIENT`) — ducks rather than silences other apps' audio during speech, and the focus-change listener detects when a phone call or another app takes priority (`onState("audio-interrupted")`) instead of fighting it.

## Handled failure modes

- **Permission denied** (foreground, background, or notifications): each surfaced with its own `reason` string rather than a generic failure.
- **GPS provider disabled in system settings mid-session**: `LocationListener.onProviderDisabled` emits an explicit error rather than silently going quiet.
- **Notification permission denied (Android 13+)**: navigation proceeds anyway — `proceedStartNavigation` deliberately does not block on this, since the underlying location/foreground-service mechanics don't strictly require a visible notification to function, even though not seeing one is a worse user experience (documented in `MOBILE_TESTING_CHECKLIST.md` as a case to verify by hand: does the service actually keep running without a visible notification on a real device, since Android's real-world behavior here isn't fully guaranteed by the docs alone).
- **Battery optimization interference**: not (and cannot be) prevented from Kotlin code alone — see the table above. `MOBILE_TESTING_CHECKLIST.md` calls out testing on at least one aggressive-OEM device as a real test case, not optional.
- **Service recreated** (process killed and the OS later restarts it): `START_NOT_STICKY` means this deliberately does not happen automatically — a fresh `startNavigationSession` call is required, which only comes from the user restarting navigation in the app.

## Voice, audio, and notification

- **Native `android.speech.tts.TextToSpeech`**, not the WebView's Web Speech API — a backgrounded Android WebView's JS execution is throttled/paused, so Web Speech API calls from `app.js` are not reliable once backgrounded. All nav announcements route through `NavEngine.speak()`, mirroring `voiceengine.js`'s distance-banding/dedup logic (`VOICE_NEAR_M`/`VOICE_FAR_M`, an announced-keys set) by hand.
- **Ambient sound in the background**: `AmbientNoisePlayer.kt`, a single generic filtered-noise loop via streaming `AudioTrack` — same named simplification as iOS: not a port of the web app's 11 soundscapes, since Web Audio API cannot run once backgrounded and *some* native ambient implementation was required for "ambient audio continues" to be genuinely true. Ducks around TTS via `NavEngine`'s `onSpeakStart`/`onSpeakEnd` callbacks, restoring after a fixed 3s (matching iOS's fixed-duration approach, since Android TextToSpeech's own precise "done speaking" callback wasn't wired up in this pass, in favor of directly comparable behavior across both platforms).

## Known simplifications (stated once, not hidden)

- **Reroute** takes GraphHopper's first returned path, not routing.js's calm-vs-fastest scored choice.
- **Ambient audio** is one generic noise loop, not 11 soundscapes.
- **Road-class-aware ambient level** is not ported natively.
- **`GPS_PROVIDER` only**, no fused/network blend (see above).
- **Point-to-segment route distance** uses the same nearest-vertex approximation as the web app, not exact point-to-segment.

## Keeping the ported engine in sync with navlogic.js

Same caveat as iOS: `NavEngine.kt` doesn't share source with `navlogic.js`. Thresholds come from the JS-built `NavRoutePayload` (`shared/routeTransfer.js`, sourced from `NavLogic.THRESHOLDS`), so those numbers can't drift. The algorithm itself is hand-mirrored and must be updated by hand if `navlogic.js`'s `processFix()` changes.

## Files

- `CalmNavBackgroundPlugin.kt` — Capacitor-facing methods (`@PluginMethod`), permission staging, binds to the Service.
- `NavigationForegroundService.kt` — the foreground Service: notification, `LocationManager`, audio focus, action `PendingIntent`s.
- `NavEngine.kt` — the actual engine: location math, voice, native reroute.
- `AmbientLocation.kt` — separate, foreground-only one-shot/continuous location for autocomplete, never used for the nav loop.
- `AmbientNoisePlayer.kt` — the native ambient noise loop.
- `NavModels.kt` — data classes (parsed via `org.json`, no extra dependency) mirroring `shared/routeTransfer.js`'s payload shape.
