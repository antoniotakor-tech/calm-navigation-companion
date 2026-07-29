// ---------------------------------------------------------------------------
// FeedbackEngine — the "Feedback Engine" box from the spec: given a gesture
// (from GestureEngine) or a navigation event, decides the combined
// haptic + tone + visual response and plays all three together. Visuals stay
// injected (this file has no canvas/DOM code of its own) so it's reusable
// without dragging the ripple-canvas implementation along with it.
//
// Accessibility: haptics and sound can each be independently disabled via
// prefs; the visual callback always still fires regardless — feedback is
// never sound- or haptic-only.
// ---------------------------------------------------------------------------
(function () {
  "use strict";

  const PENTATONIC = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];

  const GESTURE_MAP = {
    tap: { pattern: "softTap", notes: 1 },
    doubleTap: { pattern: "doubleTap", notes: 2 },
    press: { pattern: "wavePulse", notes: 1 },
    longPress: { pattern: "heartbeat", notes: 1 },
    swipe: { pattern: "wavePulse", notes: 2 },
    drag: { pattern: "rollingPulse", notes: 1 },
    rub: { pattern: "textureSimulation", notes: 3 },
    circle: { pattern: "breathingPulse", notes: 3 },
  };

  function signToNavPattern(sign) {
    if (sign === 4 || sign === 5) return "arrival";
    if (sign === 6) return "roundabout";
    if (sign <= -1) return "turnLeft";
    if (sign >= 1) return "turnRight";
    return "continueStraight";
  }

  function FeedbackEngine(hapticManager, audioManager, prefs) {
    this.haptic = hapticManager;
    this.am = audioManager;
    this.prefs = prefs;
    this.visualFn = null; // (payload) => void — set by app.js
    this._spokenSteps = new Set();
  }

  FeedbackEngine.prototype._tone = function (freq, duration) {
    if (!this.prefs.get().haptics.soundOn) return;
    this.am.ensureCtx();
    const ctx = this.am.ctx;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    env.gain.value = 0;
    osc.connect(env);
    env.connect(this.am.getBus("effects"));
    const now = ctx.currentTime;
    const intensity = this.prefs.get().haptics.intensity;
    const vol = intensity * 0.18 + 0.04;
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(vol, now + 0.012);
    env.gain.exponentialRampToValueAtTime(0.001, now + (duration || 0.45));
    osc.start(now);
    osc.stop(now + (duration || 0.45) + 0.05);
  };

  FeedbackEngine.prototype.toneForY = function (clientY, rectTop, rectHeight) {
    const t = Math.max(0, Math.min(1, (clientY - rectTop) / rectHeight));
    const idx = Math.floor((1 - t) * (PENTATONIC.length - 1));
    return PENTATONIC[idx];
  };

  // Called with a classified gesture ({type, x, y, ...}) from GestureEngine.
  FeedbackEngine.prototype.onGesture = function (gesture, rectForPitch) {
    const map = GESTURE_MAP[gesture.type] || GESTURE_MAP.tap;
    if (this.haptic) this.haptic.vibratePattern(PatternLibrary.PATTERNS[map.pattern]);
    for (let i = 0; i < map.notes; i++) {
      const freq = rectForPitch && gesture.y != null
        ? this.toneForY(gesture.y, rectForPitch.top, rectForPitch.height)
        : PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)];
      setTimeout(() => this._tone(freq, 0.4), i * 110);
    }
    if (this.visualFn) this.visualFn(gesture);
  };

  // Called on every processed GPS fix; only actually fires a pattern once
  // per step (on the fix where NavLogic reports passedStep), same no-repeat
  // discipline as VoiceEngine.
  FeedbackEngine.prototype.onNavStep = function (info) {
    if (!info.passedStep || !this.haptic) return;
    const key = "step:" + info.stepIdx;
    if (this._spokenSteps.has(key)) return;
    this._spokenSteps.add(key);
    const name = signToNavPattern(info.step && info.step.sign);
    this.haptic.vibratePattern(PatternLibrary.NAV_PATTERNS[name]);
  };
  FeedbackEngine.prototype.onOffRoute = function () {
    if (this.haptic) this.haptic.vibratePattern(PatternLibrary.NAV_PATTERNS.offRoute);
  };
  FeedbackEngine.prototype.onRecalculating = function () {
    if (this.haptic) this.haptic.vibratePattern(PatternLibrary.NAV_PATTERNS.recalculating);
  };
  FeedbackEngine.prototype.onArrival = function () {
    if (this.haptic) this.haptic.vibratePattern(PatternLibrary.NAV_PATTERNS.arrival);
    this._spokenSteps.clear();
  };
  FeedbackEngine.prototype.reset = function () { this._spokenSteps.clear(); };

  if (typeof window !== "undefined") window.FeedbackEngine = FeedbackEngine;
})();
