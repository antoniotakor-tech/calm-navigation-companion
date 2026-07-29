// ---------------------------------------------------------------------------
// AudioManager — owns the single shared AudioContext and the four mix buses
// (ambient / voice / effects / instrument), each a GainNode feeding a master
// GainNode feeding destination. Nothing else in the app should touch
// ctx.destination directly — AmbientEngine, VoiceEngine, EffectsEngine, and
// KalimbaEngine (Calm Echoes) all connect into the bus this hands them, so
// ducking/muting/volume always composes correctly instead of every engine
// fighting over one raw gain node.
//
// "instrument" was added for Calm Echoes' Kalimba — a live-performed
// instrument is a distinct category from ambient background, spoken
// navigation, and brief UI cues, and reusing "effects" for it would have
// meant the effects volume slider also (confusingly) controlling kalimba
// loudness. No separate user-facing slider is exposed for it today; it uses
// a fixed comfortable default and responds to the same mute conventions.
// ---------------------------------------------------------------------------
(function () {
  "use strict";

  const BUSES = ["ambient", "voice", "effects", "instrument"];

  function AudioManager() {
    this.ctx = null;
    this.master = null;
    this.buses = {};       // name -> GainNode (user-facing volume)
    this.duckGains = {};   // name -> GainNode (engine-controlled ducking, multiplies the bus)
    this.busVolume = { ambient: 0.55, voice: 0.75, effects: 0.25, instrument: 0.7 };
    this.muted = { ambient: false, voice: false, effects: false, instrument: false };
    this._visibilityBound = false;
    // Read by VoiceEngine/EffectsEngine (which only hold a reference to this
    // manager, not to AmbientEngine) so mode/night-mode actually change
    // ducking speed and effect intensity — see audioregulation.js.
    this.regulationMode = "relax";
    this.nightMode = false;
  }

  AudioManager.prototype.setRegulationMode = function (mode) {
    this.regulationMode = mode;
  };
  AudioManager.prototype.setNightMode = function (on) {
    this.nightMode = !!on;
  };

  AudioManager.prototype.ensureCtx = function () {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);

      BUSES.forEach((name) => {
        const bus = this.ctx.createGain();
        const duck = this.ctx.createGain();
        bus.gain.value = this.busVolume[name];
        duck.gain.value = 1;
        bus.connect(duck);
        duck.connect(this.master);
        this.buses[name] = bus;
        this.duckGains[name] = duck;
      });

      // iOS Safari: contexts start suspended until a real user-gesture unlock,
      // and need one silent buffer actually played through them in that same
      // gesture or later playback can stay silent despite ctx.state=="running".
      const unlockBuffer = this.ctx.createBuffer(1, 1, 22050);
      const unlockSource = this.ctx.createBufferSource();
      unlockSource.buffer = unlockBuffer;
      unlockSource.connect(this.ctx.destination);
      unlockSource.start(0);

      this._bindInterruptionHandling();
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  };

  // "Handle incoming phone interruptions gracefully": the web platform gives
  // no direct phone-call-interrupted event, but a call/other-app-audio
  // interruption on mobile reliably suspends the AudioContext, and
  // backgrounding the tab reliably fires visibilitychange. Resuming on both
  // is the practical web equivalent of "recover after an interruption".
  AudioManager.prototype._bindInterruptionHandling = function () {
    if (this._visibilityBound || typeof document === "undefined") return;
    this._visibilityBound = true;
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && this.ctx && this.ctx.state === "suspended") {
        this.ctx.resume().catch(() => {});
      }
    });
  };

  AudioManager.prototype.getBus = function (name) {
    this.ensureCtx();
    return this.buses[name];
  };

  AudioManager.prototype.setMasterVolume = function (v01) {
    this.ensureCtx();
    this.master.gain.setTargetAtTime(Math.max(0, Math.min(1, v01)), this.ctx.currentTime, 0.05);
  };

  AudioManager.prototype.setBusVolume = function (name, v01) {
    this.busVolume[name] = v01;
    if (!this.buses[name]) return;
    const target = this.muted[name] ? 0 : v01;
    this.buses[name].gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
  };

  AudioManager.prototype.setBusMuted = function (name, muted) {
    this.muted[name] = muted;
    if (!this.buses[name]) return;
    const target = muted ? 0 : this.busVolume[name];
    this.buses[name].gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
  };

  // Smoothly reduce a bus to `mult` of its current level (e.g. 0.35 = duck to
  // 35%) over `ms`, without touching the user's own volume setting — restore()
  // ramps back to 1x over its own duration. This is what makes voice
  // announcements duck the ambient bed instead of talking over it.
  AudioManager.prototype.duck = function (name, mult, ms) {
    const g = this.duckGains[name];
    if (!g) return;
    const now = this.ctx.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(g.gain.value, now);
    g.gain.linearRampToValueAtTime(mult, now + (ms || 250) / 1000);
  };
  AudioManager.prototype.restore = function (name, ms) {
    const g = this.duckGains[name];
    if (!g) return;
    const now = this.ctx.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(g.gain.value, now);
    g.gain.linearRampToValueAtTime(1, now + (ms || 400) / 1000);
  };

  if (typeof window !== "undefined") window.AudioManager = AudioManager;
})();
