// ---------------------------------------------------------------------------
// DEVELOPER-ONLY GPS simulator. Walks a fake position along the active
// route's own coordinate array on a timer, feeding fixes through the exact
// same onNavPosition() path real GPS uses — so it exercises the real nav
// logic, not a separate scripted animation.
//
// This must never be mistaken for real navigation:
//   - it is only ever wired up when CONFIG.DEV_SIMULATION is true, or the
//     page is loaded with ?simulate=1 (app.js gates this, not this file)
//   - the nav UI shows a persistent "SIMULATED GPS" badge whenever it is
//     driving position updates (see app.js / style.css .sim-badge)
//   - it never runs in place of navigator.geolocation; it is only ever a
//     substitute the developer opts into explicitly.
// ---------------------------------------------------------------------------
(function () {
  "use strict";

  function NavSimulator(getRoute, onFix) {
    this.getRoute = getRoute; // () => current route object ({coordinates, steps})
    this.onFix = onFix;       // (fixLikeGeolocationPosition) => void
    this.timer = null;
    this.idx = 0;
    this.speedMps = 1.3;
    this.startedAt = 0;
  }

  NavSimulator.prototype.isRunning = function () {
    return this.timer != null;
  };

  // Advances by real elapsed wall-clock time rather than "one point per
  // tick" — background/inactive browser tabs throttle setInterval/rAF
  // heavily (sometimes to ~1 call/minute), and a tick-counted simulator
  // would appear to stall. Computing "how far should we be by now" from
  // Date.now() means a delayed timer just jumps further per firing instead
  // of silently falling behind.
  NavSimulator.prototype.start = function (speedMps, pollMs) {
    this.stop();
    this.idx = 0;
    this.speedMps = speedMps || 1.3;
    this.startedAt = Date.now();
    this.timer = setInterval(() => this._tick(), pollMs || 500);
  };

  NavSimulator.prototype.stop = function () {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  };

  NavSimulator.prototype._tick = function () {
    const route = this.getRoute();
    if (!route || !route.coordinates || !route.coordinates.length) return;
    const coords = route.coordinates;

    const elapsedS = (Date.now() - this.startedAt) / 1000;
    const targetDistM = elapsedS * this.speedMps;
    const idx = this._indexAtDistance(coords, targetDistM);
    if (idx >= coords.length - 1) {
      this._emit(coords, coords.length - 1);
      this.stop();
      return;
    }
    this.idx = idx;
    this._emit(coords, idx);
  };

  // Walks the route's cumulative distance to find the point index closest
  // to targetDistM along the line — O(n) per call, fine at this point count
  // and this poll rate.
  NavSimulator.prototype._indexAtDistance = function (coords, targetDistM) {
    if (typeof NavLogic === "undefined") return Math.min(this.idx + 1, coords.length - 1);
    let acc = 0;
    for (let i = 1; i < coords.length; i++) {
      const d = NavLogic.haversineM(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
      acc += d;
      if (acc >= targetDistM) return i;
    }
    return coords.length - 1;
  };

  NavSimulator.prototype._emit = function (coords, idx) {
    const [lon, lat] = coords[idx];
    let heading = null;
    if (idx > 0 && typeof NavLogic !== "undefined") {
      const [plon, plat] = coords[idx - 1];
      heading = NavLogic.bearingDeg(plat, plon, lat, lon);
    }
    // Shaped like a real GeolocationPosition so it can go through the exact
    // same callback real navigator.geolocation.watchPosition() calls.
    this.onFix({
      coords: { latitude: lat, longitude: lon, accuracy: 6, speed: this.speedMps, heading: heading },
      timestamp: Date.now(),
    });
  };

  if (typeof window !== "undefined") window.NavSimulator = NavSimulator;
})();
