// ---------------------------------------------------------------------------
// HapticManager — the one place that actually calls navigator.vibrate().
// Wraps haptics.js's HapticSupport/HapticFidget primitives with: a user
// on/off override (independent of device support), intensity scaling via
// PatternLibrary, and best-effort battery-aware throttling.
//
// Honest limitation: the Battery Status API (navigator.getBattery) was
// removed from Chrome for privacy reasons and was never implemented in
// Safari — it is NOT available on the large majority of real phones this
// app will run on today. Battery throttling below is real code that DOES
// activate on the browsers that still expose it, but on iPhone/most modern
// Chrome it will simply never fire. That's a platform gap, not a bug here.
// ---------------------------------------------------------------------------
(function () {
  "use strict";

  function HapticManager(prefs) {
    this.prefs = prefs;
    this.battery = null;
    this.lowBattery = false;
    this._initBattery();
  }

  HapticManager.prototype._initBattery = function () {
    if (typeof navigator === "undefined" || typeof navigator.getBattery !== "function") return; // not available on this browser — see file header
    navigator.getBattery().then((battery) => {
      this.battery = battery;
      const update = () => { this.lowBattery = battery.level <= 0.2 && !battery.charging; };
      update();
      battery.addEventListener("levelchange", update);
      battery.addEventListener("chargingchange", update);
    }).catch(() => {});
  };

  HapticManager.prototype.isEnabled = function () {
    return HapticSupport.available && this.prefs.get().haptics.enabled;
  };

  HapticManager.prototype.intensity = function () {
    return this.prefs.get().haptics.intensity;
  };

  HapticManager.prototype.vibratePattern = function (pattern) {
    if (!this.isEnabled()) return;
    let p = pattern;
    if (this.lowBattery) p = PatternLibrary.degradeForLowBattery(p);
    const scaled = PatternLibrary.scale(p, this.intensity());
    try { navigator.vibrate(scaled); } catch (e) {}
  };

  HapticManager.prototype.vibratePulse = function (ms) {
    this.vibratePattern([ms]);
  };

  if (typeof window !== "undefined") window.HapticManager = HapticManager;
})();
