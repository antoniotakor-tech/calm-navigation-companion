// ---------------------------------------------------------------------------
// EffectsEngine — short, one-shot context cues (not looping ambience, not
// speech). Gentle by construction: short envelopes, no square waves, capped
// gain — "never harsh or annoying".
// ---------------------------------------------------------------------------
(function () {
  "use strict";

  function EffectsEngine(audioManager) {
    this.am = audioManager;
  }

  // Peak gain scale for mode/night-mode — "slightly stronger navigation
  // effects" in Concentrate, "lower effects intensity" in Relax, capped
  // further at night ("avoid unnecessarily loud alerts"). See
  // audioregulation.js's computeEffectsScale for the actual numbers.
  EffectsEngine.prototype._scale = function () {
    if (typeof AuditoryRegulation === "undefined") return 1;
    return AuditoryRegulation.computeEffectsScale(this.am.regulationMode, this.am.nightMode);
  };

  EffectsEngine.prototype._tone = function (freq, duration, type) {
    this.am.ensureCtx();
    const ctx = this.am.ctx;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.value = freq;
    env.gain.value = 0;
    osc.connect(env);
    env.connect(this.am.getBus("effects"));
    const now = ctx.currentTime;
    const peak = 0.4 * this._scale();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(peak, now + 0.02);
    env.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  };

  // Soft two-note downward tick — "heads up", not alarming.
  EffectsEngine.prototype.playOffRouteAlert = function () {
    this._tone(392, 0.18, "triangle");
    setTimeout(() => this._tone(311, 0.22, "triangle"), 140);
  };

  // Gentle rising sweep — "working on it".
  EffectsEngine.prototype.playRecalculating = function () {
    this.am.ensureCtx();
    const ctx = this.am.ctx;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "sine";
    env.gain.value = 0;
    osc.connect(env);
    env.connect(this.am.getBus("effects"));
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(260, now);
    osc.frequency.linearRampToValueAtTime(420, now + 0.4);
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.3 * this._scale(), now + 0.05);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc.start(now);
    osc.stop(now + 0.5);
  };

  // A small three-note major-triad flourish — a satisfying "done", not a fanfare.
  EffectsEngine.prototype.playArrival = function () {
    [523.25, 659.25, 784.0].forEach((f, i) => setTimeout(() => this._tone(f, 0.55, "triangle"), i * 130));
  };

  // A single soft tick, used just before an imminent turn as a non-verbal cue.
  EffectsEngine.prototype.playTurnTick = function () {
    this._tone(660, 0.09, "sine");
  };

  if (typeof window !== "undefined") window.EffectsEngine = EffectsEngine;
})();
