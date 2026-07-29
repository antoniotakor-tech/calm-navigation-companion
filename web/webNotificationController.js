// ---------------------------------------------------------------------------
// Web NotificationController — there is no web equivalent of Android's
// foreground-service notification or iOS's lock-screen Now Playing info.
// This is an honest no-op, not a fake/partial implementation: `isSupported`
// is false, and app.js uses that to show its own in-page banner explaining
// that locked-screen controls need the native app, per the spec's "web
// version must clearly state that locked-screen navigation is unavailable"
// requirement — see the "background-native-notice" banner in app.js.
// ---------------------------------------------------------------------------
(function (root) {
  "use strict";

  function WebNotificationController() {
    this.isSupported = false;
  }

  WebNotificationController.prototype.show = function () { return Promise.resolve(); };
  WebNotificationController.prototype.update = function () { return Promise.resolve(); };
  WebNotificationController.prototype.hide = function () { return Promise.resolve(); };
  WebNotificationController.prototype.onAction = function () {};

  if (typeof window !== "undefined") window.WebNotificationController = WebNotificationController;
})(typeof window !== "undefined" ? window : this);
