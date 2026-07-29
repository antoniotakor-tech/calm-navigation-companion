// ---------------------------------------------------------------------------
// Web LifecycleController — reports foreground/background transitions via
// the Page Visibility API. Screen Wake Lock stays managed directly in
// app.js (requestWakeLock/releaseWakeLock, unchanged) since it's a distinct
// concern from "is the tab visible" and already worked correctly.
// ---------------------------------------------------------------------------
(function (root) {
  "use strict";

  function WebLifecycleController() {
    this._fgCb = null;
    this._bgCb = null;
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) { if (this._bgCb) this._bgCb(); }
        else if (this._fgCb) this._fgCb();
      });
    }
  }

  WebLifecycleController.prototype.onForeground = function (cb) { this._fgCb = cb; };
  WebLifecycleController.prototype.onBackground = function (cb) { this._bgCb = cb; };
  WebLifecycleController.prototype.getCurrentState = function () {
    return (typeof document !== "undefined" && document.hidden) ? "background" : "foreground";
  };

  if (typeof window !== "undefined") window.WebLifecycleController = WebLifecycleController;
})(typeof window !== "undefined" ? window : this);
