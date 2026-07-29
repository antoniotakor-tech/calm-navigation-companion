// ---------------------------------------------------------------------------
// Native NotificationController — the persistent Android notification and
// iOS Now Playing/lock-screen info are shown and kept updated entirely
// inside the native plugin, driven automatically by the nav session's own
// events (see NavigationForegroundService.kt's buildNotification()/
// updateNotification(), and NavigationEngine.swift's updateNowPlaying()) —
// there is no separate "please show a notification now" JS call to make.
// show()/update()/hide() are therefore no-ops here; onAction(cb) is the
// real, useful part — it's how app.js finds out the user tapped "Stop
// navigation" or muted/unmuted from the lock screen/notification.
// ---------------------------------------------------------------------------
(function (root) {
  "use strict";

  function plugin() {
    return root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.CalmNavBackground;
  }

  function NativeNotificationController() {
    this.isSupported = true;
    this._actionCb = null;
    const p = plugin();
    if (p) {
      p.addListener("notificationAction", (event) => {
        if (this._actionCb) this._actionCb(event);
      });
    }
  }

  NativeNotificationController.prototype.show = function () { return Promise.resolve(); };
  NativeNotificationController.prototype.update = function () { return Promise.resolve(); };
  NativeNotificationController.prototype.hide = function () { return Promise.resolve(); };
  NativeNotificationController.prototype.onAction = function (cb) { this._actionCb = cb; };

  if (typeof window !== "undefined") window.NativeNotificationController = NativeNotificationController;
})(typeof window !== "undefined" ? window : this);
