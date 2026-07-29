// ---------------------------------------------------------------------------
// Web BackgroundNavigationService — there is no backgrounding to hand off to
// on the web platform: the existing app.js nav loop (NavBridge.location +
// navlogic.js's processFix) already IS the whole engine, and keeps running
// exactly as before, entirely independent of this file. This adapter only
// answers "is background navigation active" (always false, with a reason)
// so app.js can check NavBridge.backgroundNav.isBackgroundActive() uniformly
// across platforms instead of branching on Capacitor.isNativePlatform()
// itself everywhere.
// ---------------------------------------------------------------------------
(function (root) {
  "use strict";

  function WebBackgroundNavigationService() {}

  WebBackgroundNavigationService.prototype.startSession = function () {
    return Promise.resolve({ backgrounded: false, reason: "Background navigation needs the native app — the web version only navigates while this tab is open and visible." });
  };
  WebBackgroundNavigationService.prototype.stopSession = function () { return Promise.resolve(); };
  WebBackgroundNavigationService.prototype.updateRoute = function () { return Promise.resolve(); };
  WebBackgroundNavigationService.prototype.onEvent = function () {};
  WebBackgroundNavigationService.prototype.isBackgroundActive = function () { return false; };

  if (typeof window !== "undefined") window.WebBackgroundNavigationService = WebBackgroundNavigationService;
})(typeof window !== "undefined" ? window : this);
