// ---------------------------------------------------------------------------
// Native LocationProvider — one-shot/ambient location via the custom
// CalmNavBackground plugin (autocomplete's "use current location" and
// city-bias detection). NOT used for the active nav loop — see
// nativeBackgroundNavigationService.js, which owns the nav session's own
// location stream entirely inside the native plugin.
// ---------------------------------------------------------------------------
(function (root) {
  "use strict";

  function plugin() {
    return root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.CalmNavBackground;
  }

  function NativeLocationProvider() {
    this._active = false;
    this._listenerHandle = null;
  }

  NativeLocationProvider.prototype.start = function (onFix, onError) {
    const p = plugin();
    if (!p) { onError({ message: "CalmNavBackground plugin unavailable." }); return; }
    p.addListener("navEvent", (event) => {
      if (event.type === "fix" && event.fix) onFix(event.fix);
    }).then((handle) => { this._listenerHandle = handle; });
    p.startLocationUpdates({ desiredAccuracy: "high", distanceFilterM: 5 })
      .then(() => { this._active = true; })
      .catch((err) => onError(err));
  };

  NativeLocationProvider.prototype.stop = function () {
    const p = plugin();
    if (p) p.stopLocationUpdates().catch(() => {});
    if (this._listenerHandle) { this._listenerHandle.remove(); this._listenerHandle = null; }
    this._active = false;
  };

  NativeLocationProvider.prototype.isActive = function () {
    return this._active;
  };

  NativeLocationProvider.prototype.getCurrentPosition = function () {
    const p = plugin();
    if (!p) return Promise.reject({ message: "CalmNavBackground plugin unavailable." });
    return p.getCurrentPosition();
  };

  if (typeof window !== "undefined") window.NativeLocationProvider = NativeLocationProvider;
})(typeof window !== "undefined" ? window : this);
