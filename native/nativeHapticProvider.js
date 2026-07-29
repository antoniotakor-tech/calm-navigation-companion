// ---------------------------------------------------------------------------
// Native HapticProvider — uses the official @capacitor/haptics plugin
// (Capacitor.Plugins.Haptics), not the custom CalmNavBackground plugin: this
// is a solved, standard need with a well-tested official plugin, so no
// custom native code was written for it (per the brief's "official plugins
// where they cover the need" guidance).
//
// Known simplification: @capacitor/haptics exposes impact/notification/
// vibrate(duration) primitives, not arbitrary custom rhythm arrays the way
// navigator.vibrate(pattern) does on web — so nav-linked/fidget patterns are
// mapped to the closest primitive below rather than reproduced exactly.
// Native haptics (especially iOS's Taptic Engine via Core Haptics) can feel
// materially better than the web patterns despite this; they just won't be
// rhythmically identical. A true 1:1 port would mean authoring custom
// AHAP/waveform patterns per platform — not done in this pass.
// ---------------------------------------------------------------------------
(function (root) {
  "use strict";

  const IMPACT_MAP = {
    turnLeft: "MEDIUM", turnRight: "MEDIUM", continueStraight: "LIGHT",
    roundabout: "MEDIUM", recalculating: "LIGHT",
  };
  const NOTIFICATION_MAP = { arrival: "SUCCESS", offRoute: "WARNING" };

  function haptics() {
    return root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.Haptics;
  }

  function NativeHapticProvider() {}

  NativeHapticProvider.prototype.vibrate = function (patternName) {
    const h = haptics();
    if (!h) return Promise.resolve();
    if (NOTIFICATION_MAP[patternName]) {
      return h.notification({ type: NOTIFICATION_MAP[patternName] }).catch(() => {});
    }
    if (IMPACT_MAP[patternName]) {
      return h.impact({ style: IMPACT_MAP[patternName] }).catch(() => {});
    }
    // Fidget-canvas patterns (softTap, ripple, etc.) — no rhythm equivalent
    // available, fall back to a short generic vibration.
    return h.vibrate({ duration: 40 }).catch(() => {});
  };

  NativeHapticProvider.prototype.stop = function () {
    return Promise.resolve(); // @capacitor/haptics has no "cancel in-flight" call; its effects are all short one-shots anyway
  };

  if (typeof window !== "undefined") window.NativeHapticProvider = NativeHapticProvider;
})(typeof window !== "undefined" ? window : this);
