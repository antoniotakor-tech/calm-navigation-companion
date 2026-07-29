// ---------------------------------------------------------------------------
// Shared interfaces — the contracts every web/native adapter implements.
//
// Plain JS base classes, not TypeScript: this project has no build step and
// stays that way (classic <script> tags, globals), same convention as every
// other file here. Each base class documents the contract and throws if a
// method isn't overridden, so a missing implementation fails loudly instead
// of silently doing nothing.
//
// Concrete implementations:
//   web/web*.js       — wraps existing browser APIs (navigator.geolocation,
//                        the existing AudioManager/VoiceQueue/HapticManager,
//                        Wake Lock, visibilitychange). Used when
//                        !Capacitor.isNativePlatform().
//   native/native*.js — calls into the CalmNavBackground Capacitor plugin
//                        (Swift/Kotlin). Used when Capacitor.isNativePlatform().
//
// shared/navigationBridge.js picks between them at runtime. app.js only ever
// talks to the bridge, never to navigator.geolocation / AudioManager /
// HapticManager directly for anything nav-related — that's what makes "no
// two simultaneous engines processing the same GPS updates" enforceable in
// one place instead of scattered across app.js.
// ---------------------------------------------------------------------------

function notImplemented(className, methodName) {
  throw new Error(`${className}.${methodName}() has no implementation — this is a bug in the adapter, not a caller error.`);
}

// Supplies GPS fixes. Exactly one LocationProvider is ever "active" at a
// time across the whole app (enforced by navigationBridge.js), whether that's
// the web's navigator.geolocation.watchPosition or the native plugin's own
// background location updates.
class LocationProvider {
  // onFix({lat, lon, accuracyM, headingDeg, speedMps, timestampMs}), onError(reason)
  start(onFix, onError) { notImplemented("LocationProvider", "start"); }
  stop() { notImplemented("LocationProvider", "stop"); }
  isActive() { notImplemented("LocationProvider", "isActive"); }
  // One-shot fix — used by autocomplete's "use current location" and
  // city-bias detection, never by the active nav loop.
  async getCurrentPosition() { notImplemented("LocationProvider", "getCurrentPosition"); }
}

// Owns the background-capable navigation session: on native, this hands the
// route to the native plugin so it keeps running the nav state machine (via
// its own ported copy of navlogic.js's rules — see IOS_/ANDROID_BACKGROUND_
// NAVIGATION.md) even while the WebView is suspended. On web, this is a thin
// pass-through to the existing in-page navlogic.js engine, since there is no
// backgrounding to hand off to.
class BackgroundNavigationService {
  // routePayload: see shared/routeTransfer.js's buildNavRoutePayload().
  // Returns a promise resolving to {backgrounded: boolean, reason?: string} —
  // backgrounded is false (with a reason) whenever true background operation
  // isn't actually available (permission denied, web platform, etc.); callers
  // must not claim "background navigation active" unless this says so.
  async startSession(routePayload, options) { notImplemented("BackgroundNavigationService", "startSession"); }
  async stopSession() { notImplemented("BackgroundNavigationService", "stopSession"); }
  async updateRoute(routePayload) { notImplemented("BackgroundNavigationService", "updateRoute"); }
  // cb(event) where event.type is one of:
  // 'fix' | 'maneuver' | 'offroute' | 'reroute-needed' | 'rerouted' | 'arrived' | 'error' | 'state'
  onEvent(cb) { notImplemented("BackgroundNavigationService", "onEvent"); }
  isBackgroundActive() { notImplemented("BackgroundNavigationService", "isBackgroundActive"); }
}

// Configures the audio session for spoken guidance + optional ambient sound
// and reports interruptions (phone call, Siri, other app audio, route
// changes) so the UI/engines can react honestly instead of assuming audio is
// still playing.
class AudioSessionController {
  // options: { allowMixing: boolean } — whether ambient sound should duck
  // other apps' audio or mix with it; voice guidance always ducks briefly.
  async configure(options) { notImplemented("AudioSessionController", "configure"); }
  async duckForSpeech() { notImplemented("AudioSessionController", "duckForSpeech"); }
  async restoreAfterSpeech() { notImplemented("AudioSessionController", "restoreAfterSpeech"); }
  async stop() { notImplemented("AudioSessionController", "stop"); }
  // cb({ type: 'began'|'ended'|'route-changed'|'other-audio-started'|'other-audio-stopped', reason })
  onInterruption(cb) { notImplemented("AudioSessionController", "onInterruption"); }
}

// Speaks turn-by-turn instructions. On web this is the existing Web Speech
// API voice queue; on native (needed for lock-screen reliability, per
// IOS_BACKGROUND_NAVIGATION.md / ANDROID_BACKGROUND_NAVIGATION.md) this is
// native AVSpeechSynthesizer / android.speech.tts.TextToSpeech instead —
// Web Speech API is not relied on for background speech on either platform.
class SpeechGuidanceProvider {
  async speak(text, opts) { notImplemented("SpeechGuidanceProvider", "speak"); }
  async stop() { notImplemented("SpeechGuidanceProvider", "stop"); }
  isSpeaking() { notImplemented("SpeechGuidanceProvider", "isSpeaking"); }
}

// Vibration feedback. On web, wraps the existing HapticManager/navigator.vibrate
// stack unchanged; on native, prefers the platform haptics API (works even
// where the Vibration API doesn't, e.g. iOS).
class HapticProvider {
  async vibrate(patternName) { notImplemented("HapticProvider", "vibrate"); }
  async stop() { notImplemented("HapticProvider", "stop"); }
}

// Reports app lifecycle transitions and exposes enough state for
// shared/lifecycleReconciler.js to reconcile the web UI with whatever
// happened while backgrounded.
class LifecycleController {
  onForeground(cb) { notImplemented("LifecycleController", "onForeground"); }
  onBackground(cb) { notImplemented("LifecycleController", "onBackground"); }
  getCurrentState() { notImplemented("LifecycleController", "getCurrentState"); } // 'foreground' | 'background'
}

// Surfaces navigation status without requiring the phone to be unlocked:
// Android's persistent foreground-service notification, iOS's Now
// Playing/Control Center info + remote commands. Never shows a state the
// native side hasn't actually confirmed (see BackgroundNavigationService's
// isBackgroundActive()) — this is what "the app does not silently pretend
// background navigation is active" is enforced by.
class NotificationController {
  // info: { instruction, distanceToManeuverM, etaMs, destinationLabel, muted }
  async show(info) { notImplemented("NotificationController", "show"); }
  async update(info) { notImplemented("NotificationController", "update"); }
  async hide() { notImplemented("NotificationController", "hide"); }
  // cb({ action: 'stop' | 'mute' | 'unmute' | 'open' })
  onAction(cb) { notImplemented("NotificationController", "onAction"); }
}

if (typeof module === "object" && module.exports) {
  module.exports = {
    LocationProvider, BackgroundNavigationService, AudioSessionController,
    SpeechGuidanceProvider, HapticProvider, LifecycleController, NotificationController,
  };
}
