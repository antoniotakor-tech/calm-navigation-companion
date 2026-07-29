// ---------------------------------------------------------------------------
// Native LifecycleController — uses the official @capacitor/app plugin's
// appStateChange event (isActive: true/false), the real native signal for
// foreground/background transitions on both iOS and Android — far more
// reliable inside a native shell than the Page Visibility API this project
// also has (web/webLifecycleController.js), which is kept as-is for the web
// build only.
// ---------------------------------------------------------------------------
(function (root) {
  "use strict";

  function appPlugin() {
    return root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.App;
  }

  function NativeLifecycleController() {
    this._fgCb = null;
    this._bgCb = null;
    this._state = "foreground";
    const app = appPlugin();
    if (app) {
      app.addListener("appStateChange", (state) => {
        this._state = state.isActive ? "foreground" : "background";
        if (state.isActive && this._fgCb) this._fgCb();
        if (!state.isActive && this._bgCb) this._bgCb();
      });
    }
  }

  NativeLifecycleController.prototype.onForeground = function (cb) { this._fgCb = cb; };
  NativeLifecycleController.prototype.onBackground = function (cb) { this._bgCb = cb; };
  NativeLifecycleController.prototype.getCurrentState = function () { return this._state; };

  if (typeof window !== "undefined") window.NativeLifecycleController = NativeLifecycleController;
})(typeof window !== "undefined" ? window : this);
