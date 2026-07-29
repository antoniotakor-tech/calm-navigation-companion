// ---------------------------------------------------------------------------
// Web LocationProvider — wraps navigator.geolocation.watchPosition exactly
// as app.js already called it directly before this layer existed. Behavior
// on the web build is unchanged; this only adds a layer app.js can call the
// same way regardless of platform.
// ---------------------------------------------------------------------------
(function (root) {
  "use strict";

  function WebLocationProvider() {
    this._watchId = null;
  }

  WebLocationProvider.prototype.start = function (onFix, onError) {
    if (!navigator.geolocation) {
      onError({ code: 0, message: "Geolocation is not available in this browser." });
      return;
    }
    this._watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        onFix({
          lat: c.latitude,
          lon: c.longitude,
          accuracyM: c.accuracy,
          headingDeg: c.heading,
          speedMps: c.speed,
          timestampMs: pos.timestamp,
        });
      },
      (err) => onError(err),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
  };

  WebLocationProvider.prototype.stop = function () {
    if (this._watchId != null) navigator.geolocation.clearWatch(this._watchId);
    this._watchId = null;
  };

  WebLocationProvider.prototype.isActive = function () {
    return this._watchId != null;
  };

  WebLocationProvider.prototype.getCurrentPosition = function () {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject({ code: 0, message: "Geolocation is not available in this browser." }); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const c = pos.coords;
          resolve({ lat: c.latitude, lon: c.longitude, accuracyM: c.accuracy, headingDeg: c.heading, speedMps: c.speed, timestampMs: pos.timestamp });
        },
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    });
  };

  if (typeof window !== "undefined") window.WebLocationProvider = WebLocationProvider;
})(typeof window !== "undefined" ? window : this);
