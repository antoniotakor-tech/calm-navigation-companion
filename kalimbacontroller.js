// ---------------------------------------------------------------------------
// KalimbaController — DOM/canvas/pointer half of the Kalimba (see
// kalimbaengine.js for the synthesis half). Same split as
// autocompletecontroller.js: pure geometry/decision helpers at the top
// (DOM-free, unit-tested in kalimbacontroller.test.js), the pointer-wiring
// class below (untested here, same convention as AutocompleteController and
// app.js — no jsdom/browser-test dependency in this project; covered by the
// manual test checklist instead).
//
// Deliberately NOT built on GestureEngine/classifyGesture (gestureengine.js).
// That engine classifies one gesture for an entire element from a single
// pointer path. A kalimba needs the opposite: many simultaneous pointers,
// each one continuously hit-testing WHICH tine it's currently over, so a
// single drag can pluck five tines in a row. Reusing GestureEngine here
// would mean fighting its element-level state machine instead of building
// on it — this was a reasoned scope decision, not an oversight.
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KalimbaControllerLib = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const LONG_PRESS_MS = 550;
  const DOUBLE_TAP_MS = 320;
  const DOUBLE_TAP_TINE_TOLERANCE = 0; // must be the exact same tine to count as a double tap

  // ---- Pure geometry/decision helpers ---------------------------------------

  /**
   * Maps a horizontal position on the instrument (0..1, left to right) to the
   * tine (pitch) index under it, using the same center-out visual layout as
   * kalimbaengine.js's TINE_VISUAL_ORDER. Returns null for out-of-range input
   * (a stray pointer that slipped off the canvas edge) rather than clamping,
   * so callers can tell "no tine here" apart from "tine 0".
   * @param {number} xFraction 0..1
   * @param {number[]} tineVisualOrder e.g. KalimbaTuning.TINE_VISUAL_ORDER
   */
  function tineIndexForPosition(xFraction, tineVisualOrder) {
    if (xFraction == null || xFraction < 0 || xFraction >= 1) return null;
    const count = tineVisualOrder.length;
    const visualPos = Math.min(count - 1, Math.floor(xFraction * count));
    return tineVisualOrder[visualPos];
  }

  /** A sweep/drag re-plucks only when the pointer has entered a genuinely new tine. */
  function shouldRegisterSweepPluck(prevTineIndex, newTineIndex) {
    return newTineIndex != null && newTineIndex !== prevTineIndex;
  }

  /**
   * True when a tap on `tineIndex` at time `nowMs` completes a double tap,
   * given the last tap this pointer-target recorded. Same tine only — a
   * quick tap on a neighboring tine is two intentional single notes, not a
   * double tap, so it must not swallow the second note's own pluck.
   */
  function isDoubleTap(lastTap, tineIndex, nowMs) {
    if (!lastTap) return false;
    if (Math.abs(lastTap.tineIndex - tineIndex) > DOUBLE_TAP_TINE_TOLERANCE) return false;
    return nowMs - lastTap.t <= DOUBLE_TAP_MS;
  }

  /** The octave-harmony accent note a double tap adds on top of the primary tine (kalimbaengine.js's 11-tine, 2-octave-ish layout puts the octave 5 tines up). Null when the instrument has no tine that far up. */
  function octaveHarmonyTine(tineIndex, tineCount) {
    const harmony = tineIndex + 5;
    return harmony < tineCount ? harmony : null;
  }

  // ---- DOM/pointer controller ------------------------------------------------

  // options:
  //   canvas: the <canvas> element the kalimba is drawn/hit-tested on.
  //   engine: a KalimbaEngine instance (kalimbaengine.js).
  //   tuning: KalimbaTuning (KALIMBA_PITCHES/TINE_COUNT/TINE_VISUAL_ORDER/velocityFromGesture).
  //   hapticManager: optional — vibratePulse(ms) called once per pluck.
  //   onPluck(tineIndex, velocity01, gestureType): optional — called for every
  //     pluck this controller triggers, so a recorder (echorecorder.js) can
  //     capture the same note-events being played, without this file needing
  //     to know anything about recording.
  //   reducedMotion(): optional () => bool — when true, visual flourish calls
  //     the controller may trigger elsewhere are expected to be skipped by
  //     the caller; this controller itself has no animation of its own.
  function KalimbaController(options) {
    this.canvas = options.canvas;
    this.engine = options.engine;
    this.tuning = options.tuning;
    this.hapticManager = options.hapticManager || null;
    this.onPluck = options.onPluck || (() => {});

    // One entry per active pointerId — genuine multi-touch, not "last pointer wins".
    this.pointers = new Map(); // pointerId -> { tineIndex, downAt, longPressFired }
    this.lastTapByTine = null; // { tineIndex, t } — double-tap tracking is instrument-wide, not per-finger

    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this.canvas.addEventListener("pointerdown", this._onDown);
    this.canvas.addEventListener("pointermove", this._onMove);
    this.canvas.addEventListener("pointerup", this._onUp);
    this.canvas.addEventListener("pointercancel", this._onUp);
  }

  KalimbaController.prototype.destroy = function () {
    this.pointers.forEach((state) => this._clearLongPressTimer(state));
    this.pointers.clear();
    this.canvas.removeEventListener("pointerdown", this._onDown);
    this.canvas.removeEventListener("pointermove", this._onMove);
    this.canvas.removeEventListener("pointerup", this._onUp);
    this.canvas.removeEventListener("pointercancel", this._onUp);
  };

  KalimbaController.prototype._xFraction = function (e) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width) return null;
    return (e.clientX - rect.left) / rect.width;
  };

  KalimbaController.prototype._clearLongPressTimer = function (state) {
    if (state && state.longPressTimer) {
      clearTimeout(state.longPressTimer);
      state.longPressTimer = null;
    }
  };

  KalimbaController.prototype._triggerPluck = function (tineIndex, gestureType, intensity01) {
    const velocity = this.tuning.velocityFromGesture(gestureType, intensity01);
    this.engine.pluck(tineIndex, velocity);
    if (this.hapticManager) this.hapticManager.vibratePulse(gestureType === "doubleTap" ? 18 : 12);
    this.onPluck(tineIndex, velocity, gestureType);

    if (gestureType === "doubleTap") {
      const harmonyTine = octaveHarmonyTine(tineIndex, this.tuning.TINE_COUNT);
      if (harmonyTine != null) {
        const harmonyVelocity = this.tuning.velocityFromGesture("doubleTap") * 0.7;
        this.engine.pluck(harmonyTine, harmonyVelocity);
        this.onPluck(harmonyTine, harmonyVelocity, "doubleTap");
      }
    }
  };

  KalimbaController.prototype._onDown = function (e) {
    const xFraction = this._xFraction(e);
    const tineIndex = tineIndexForPosition(xFraction, this.tuning.TINE_VISUAL_ORDER);
    if (tineIndex == null) return;
    this.canvas.setPointerCapture && this.canvas.setPointerCapture(e.pointerId);

    const now = e.timeStamp;
    const state = { tineIndex, downAt: now, longPressTimer: null, longPressFired: false };
    this.pointers.set(e.pointerId, state);

    if (isDoubleTap(this.lastTapByTine, tineIndex, now)) {
      this.lastTapByTine = null;
      this._triggerPluck(tineIndex, "doubleTap");
    } else {
      this.lastTapByTine = { tineIndex, t: now };
      this._triggerPluck(tineIndex, "tap");
    }

    state.longPressTimer = setTimeout(() => {
      state.longPressFired = true;
      this._triggerPluck(state.tineIndex, "hold");
    }, LONG_PRESS_MS);
  };

  KalimbaController.prototype._onMove = function (e) {
    const state = this.pointers.get(e.pointerId);
    if (!state) return;
    const xFraction = this._xFraction(e);
    const newTineIndex = tineIndexForPosition(xFraction, this.tuning.TINE_VISUAL_ORDER);
    if (!shouldRegisterSweepPluck(state.tineIndex, newTineIndex)) return;

    // Any real movement across tines cancels the still-holding-one-tine
    // long-press timer — this pointer is now sweeping, not holding.
    this._clearLongPressTimer(state);
    state.tineIndex = newTineIndex;
    this._triggerPluck(newTineIndex, "sweep");
  };

  KalimbaController.prototype._onUp = function (e) {
    const state = this.pointers.get(e.pointerId);
    if (!state) return;
    this._clearLongPressTimer(state);
    this.pointers.delete(e.pointerId);
  };

  const api = {
    tineIndexForPosition, shouldRegisterSweepPluck, isDoubleTap, octaveHarmonyTine,
    KalimbaController, LONG_PRESS_MS, DOUBLE_TAP_MS,
  };
  return api;
});

if (typeof window !== "undefined" && typeof window.KalimbaControllerLib !== "undefined") {
  window.KalimbaController = window.KalimbaControllerLib.KalimbaController;
}
