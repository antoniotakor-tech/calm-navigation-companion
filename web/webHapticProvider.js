// ---------------------------------------------------------------------------
// Web HapticProvider — wraps the EXISTING HapticManager instance
// (navigator.vibrate + PatternLibrary). feedbackengine.js keeps calling
// HapticManager directly for gesture/nav-linked patterns exactly as before;
// this adapter is the platform-agnostic surface for anything going through
// NavBridge.haptics instead.
// ---------------------------------------------------------------------------
(function (root) {
  "use strict";

  function WebHapticProvider(hapticManager) {
    this.hm = hapticManager;
  }

  WebHapticProvider.prototype.vibrate = function (patternName) {
    let pattern = [40];
    if (typeof PatternLibrary !== "undefined") {
      pattern = PatternLibrary.NAV_PATTERNS[patternName] || PatternLibrary.PATTERNS[patternName] || pattern;
    }
    this.hm.vibratePattern(pattern);
    return Promise.resolve();
  };
  WebHapticProvider.prototype.stop = function () {
    try { navigator.vibrate(0); } catch (e) {}
    return Promise.resolve();
  };

  if (typeof window !== "undefined") window.WebHapticProvider = WebHapticProvider;
})(typeof window !== "undefined" ? window : this);
