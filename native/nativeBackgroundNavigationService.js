// ---------------------------------------------------------------------------
// Native BackgroundNavigationService — hands the active route to the custom
// CalmNavBackground plugin, which runs the actual navigation engine
// (off-route/maneuver/arrival detection, native TTS, notification/lock-
// screen updates, reroute-with-backoff) entirely natively — see
// IOS_BACKGROUND_NAVIGATION.md / ANDROID_BACKGROUND_NAVIGATION.md.
//
// isBackgroundActive() only ever returns what the native side actually
// confirmed via startNavigationSession's `backgrounded` result — never
// optimistically true. This is the enforcement point for "the app does not
// silently pretend background navigation is active."
// ---------------------------------------------------------------------------
(function (root) {
  "use strict";

  function plugin() {
    return root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.CalmNavBackground;
  }

  function NativeBackgroundNavigationService() {
    this._sessionActive = false;
    this._backgrounded = false;
    this._eventCb = null;
    this._navListenerHandle = null;
  }

  NativeBackgroundNavigationService.prototype.startSession = async function (routePayload, options) {
    const p = plugin();
    if (!p) return { backgrounded: false, reason: "CalmNavBackground plugin unavailable." };

    const validation = validateNavRoutePayload(routePayload);
    if (!validation.valid) {
      return { backgrounded: false, reason: "Invalid route payload: " + validation.errors.join("; ") };
    }

    if (!this._navListenerHandle) {
      const handle = await p.addListener("navEvent", (event) => {
        if (this._eventCb) this._eventCb(event);
      });
      this._navListenerHandle = handle;
    }

    const opts = options || {};
    const result = await p.startNavigationSession({
      route: routePayload,
      wantsBackground: !!opts.wantsBackground,
      muted: !!opts.muted,
      allowAmbient: !!opts.allowAmbient,
      apiBaseUrl: opts.apiBaseUrl || "",
    });
    this._sessionActive = true;
    this._backgrounded = !!result.backgrounded;
    return result;
  };

  NativeBackgroundNavigationService.prototype.stopSession = async function () {
    const p = plugin();
    if (p) await p.stopNavigationSession();
    this._sessionActive = false;
    this._backgrounded = false;
  };

  NativeBackgroundNavigationService.prototype.updateRoute = async function (routePayload) {
    const p = plugin();
    if (!p || !this._sessionActive) return;
    const validation = validateNavRoutePayload(routePayload);
    if (!validation.valid) return;
    await p.updateNavigationRoute({ route: routePayload });
  };

  NativeBackgroundNavigationService.prototype.onEvent = function (cb) {
    this._eventCb = cb;
  };

  NativeBackgroundNavigationService.prototype.isBackgroundActive = function () {
    return this._sessionActive && this._backgrounded;
  };

  // Not part of the shared interface (web has no equivalent) — used by
  // shared/lifecycleReconciler.js via app.js on resume.
  NativeBackgroundNavigationService.prototype.getSnapshot = async function () {
    const p = plugin();
    if (!p) return { active: false };
    return p.getNavigationSnapshot();
  };

  if (typeof window !== "undefined") window.NativeBackgroundNavigationService = NativeBackgroundNavigationService;
})(typeof window !== "undefined" ? window : this);
