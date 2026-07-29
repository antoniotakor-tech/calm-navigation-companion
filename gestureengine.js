// ---------------------------------------------------------------------------
// GestureEngine — recognizes tap / doubleTap / press / longPress / swipe /
// drag / rub / circle from raw pointer events on a target element.
//
// classifyGesture() is a pure function over a recorded {x,y,t} path — no DOM,
// unit-tested in gestureengine.test.js. GestureEngine itself is the thin
// stateful wrapper that records pointer events into a path and calls it.
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GestureEngineLib = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TAP_DIST_PX = 10;
  const TAP_TIME_MS = 250;
  const LONG_PRESS_MS = 550;
  const SWIPE_TIME_MS = 320;
  const DOUBLE_TAP_MS = 320;
  const DOUBLE_TAP_DIST_PX = 40;

  function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

  function pathStats(path) {
    let totalDist = 0;
    let turningSum = 0;
    let reversals = 0;
    let prevAngle = null;
    let prevDx = null;
    for (let i = 1; i < path.length; i++) {
      const dx = path[i].x - path[i - 1].x;
      const dy = path[i].y - path[i - 1].y;
      const segDist = Math.hypot(dx, dy);
      totalDist += segDist;
      if (segDist > 0.5) {
        const angle = Math.atan2(dy, dx);
        if (prevAngle != null) {
          let delta = angle - prevAngle;
          while (delta > Math.PI) delta -= 2 * Math.PI;
          while (delta < -Math.PI) delta += 2 * Math.PI;
          turningSum += delta;
        }
        prevAngle = angle;
        if (prevDx != null && Math.sign(dx) !== 0 && Math.sign(prevDx) !== 0 && Math.sign(dx) !== Math.sign(prevDx)) reversals++;
        if (Math.abs(dx) > 1) prevDx = dx;
      }
    }
    const net = dist(path[0], path[path.length - 1]);
    return { totalDist, netDist: net, turningSum, reversals, straightness: totalDist > 0 ? net / totalDist : 1 };
  }

  // path: [{x,y,t}, ...] from pointerdown through pointerup, at least 1 point.
  // sensitivity (0..1, default 0.5): higher makes small movement register as
  // a gesture sooner and a hold count as longPress sooner — the "sensitivity"
  // personalization setting from prefs.haptics.
  function classifyGesture(path, sensitivity) {
    if (!path || path.length === 0) return null;
    const s = sensitivity == null ? 0.5 : Math.max(0, Math.min(1, sensitivity));
    const tapDistPx = Math.max(4, TAP_DIST_PX - (s - 0.5) * 12);
    const longPressMs = Math.max(250, LONG_PRESS_MS - (s - 0.5) * 300);

    const first = path[0], last = path[path.length - 1];
    const duration = last.t - first.t;
    const stats = pathStats(path);

    if (stats.totalDist < tapDistPx) {
      if (duration >= longPressMs) return { type: "longPress", duration };
      if (duration >= TAP_TIME_MS) return { type: "press", duration };
      return { type: "tap", duration, x: last.x, y: last.y };
    }

    const turningDeg = Math.abs(stats.turningSum) * (180 / Math.PI);
    if (turningDeg >= 300 && stats.straightness < 0.45 && stats.totalDist > 60) {
      return { type: "circle", duration, turningDeg };
    }
    if (stats.reversals >= 3 && stats.netDist < 50) {
      return { type: "rub", duration, reversals: stats.reversals };
    }
    if (duration <= SWIPE_TIME_MS && stats.straightness > 0.7) {
      const dx = last.x - first.x, dy = last.y - first.y;
      const direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
      return { type: "swipe", duration, direction, distance: stats.totalDist };
    }
    return { type: "drag", duration, distance: stats.totalDist };
  }

  // getSensitivity: optional () => 0..1, higher = easier to trigger a
  // movement gesture (swipe/drag/rub/circle) instead of a tap/press, and a
  // shorter hold counts as longPress. Defaults to a fixed 0.5 (the
  // classifyGesture() defaults above) when omitted.
  function GestureEngine(el, onGesture, getSensitivity) {
    this.el = el;
    this.onGesture = onGesture;
    this.getSensitivity = getSensitivity || (() => 0.5);
    this.path = [];
    this.active = false;
    this.lastTap = null; // { x, y, t }

    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    el.addEventListener("pointerdown", this._onDown);
  }

  GestureEngine.prototype._onDown = function (e) {
    this.active = true;
    this.path = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
    window.addEventListener("pointermove", this._onMove);
    window.addEventListener("pointerup", this._onUp);
    window.addEventListener("pointercancel", this._onUp);
  };
  GestureEngine.prototype._onMove = function (e) {
    if (!this.active) return;
    this.path.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
  };
  GestureEngine.prototype._onUp = function (e) {
    if (!this.active) return;
    this.active = false;
    this.path.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    window.removeEventListener("pointermove", this._onMove);
    window.removeEventListener("pointerup", this._onUp);
    window.removeEventListener("pointercancel", this._onUp);

    const result = classifyGesture(this.path, this.getSensitivity());
    if (!result) return;

    if (result.type === "tap") {
      const now = result.duration != null ? this.path[this.path.length - 1].t : e.timeStamp;
      if (this.lastTap && now - this.lastTap.t <= DOUBLE_TAP_MS && dist(this.lastTap, { x: result.x, y: result.y }) <= DOUBLE_TAP_DIST_PX) {
        this.onGesture({ type: "doubleTap", x: result.x, y: result.y });
        this.lastTap = null;
        return;
      }
      this.lastTap = { x: result.x, y: result.y, t: now };
    }
    this.onGesture(result);
  };

  const api = { classifyGesture, GestureEngine, TAP_DIST_PX, TAP_TIME_MS, LONG_PRESS_MS, SWIPE_TIME_MS };
  return api;
});

if (typeof window !== "undefined" && typeof window.GestureEngineLib !== "undefined") {
  window.classifyGesture = window.GestureEngineLib.classifyGesture;
  window.GestureEngine = window.GestureEngineLib.GestureEngine;
}
