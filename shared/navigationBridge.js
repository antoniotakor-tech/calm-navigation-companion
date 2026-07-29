// ---------------------------------------------------------------------------
// Navigation bridge — the one place that decides "web implementation or
// native implementation" for every interface in shared/interfaces.js, and
// the only thing app.js talks to for anything nav-related. This is what
// makes "never two simultaneous engines processing the same GPS updates" an
// enforceable invariant instead of a hope: app.js never touches
// navigator.geolocation, AudioManager, HapticManager, or the Web Speech API
// directly for navigation purposes — only NavBridge.*.
//
// Not unit-tested: it's a thin runtime switch with a browser-global
// dependency (window.Capacitor), same category as autocompletecontroller.js's
// DOM-wiring half. The logic worth testing (reconciliation, backoff, route
// payload building) lives in the pure sibling files and is tested there.
// ---------------------------------------------------------------------------

(function (root) {
  "use strict";

  function isNative() {
    return !!(root.Capacitor && root.Capacitor.isNativePlatform && root.Capacitor.isNativePlatform());
  }

  const NavBridge = {
    isNative: isNative(),

    // Populated by app.js at startup from the Web*/Native* concrete classes.
    location: null,
    backgroundNav: null,
    audioSession: null,
    speech: null,
    haptics: null,
    lifecycle: null,
    notification: null,

    // Called once by app.js after all web/native adapter files have loaded.
    init({ location, backgroundNav, audioSession, speech, haptics, lifecycle, notification }) {
      this.location = location;
      this.backgroundNav = backgroundNav;
      this.audioSession = audioSession;
      this.speech = speech;
      this.haptics = haptics;
      this.lifecycle = lifecycle;
      this.notification = notification;
    },
  };

  root.NavBridge = NavBridge;
})(typeof window !== "undefined" ? window : this);
