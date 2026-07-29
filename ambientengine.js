// ---------------------------------------------------------------------------
// AmbientEngine — soundscape synthesis and smooth crossfading. Everything
// here is procedurally generated with the Web Audio API (oscillators,
// filtered noise, scheduled notes) — there are no audio sample files in this
// project, so "café" is deliberately NOT offered: overlapping chatter and
// clinking cups doesn't synthesize convincingly, and faking it with noise
// would be misleading rather than calming. Every soundscape below IS a real,
// audible signal, not a placeholder.
//
// Soundscapes: off, white, pink, brown, tone (hum), rain, wind, ocean,
// piano (soft generative notes), birds (sparse chirps), forest (wind + birds
// + a low noise floor), nature (wind + birds, lighter).
// ---------------------------------------------------------------------------
(function () {
  "use strict";

  // Fallback only — used if audioregulation.js hasn't loaded for some reason.
  // Normal operation always goes through AuditoryRegulation.computeCrossfadeMs
  // so relax/concentrate/night-mode actually change fade speed (see that
  // file for what "actually change" means here).
  const CROSSFADE_MS = 800;

  function AmbientEngine(audioManager) {
    this.am = audioManager;
    this.soundscape = "off";
    this.mode = "relax"; // relax | concentrate — shifts tone/register AND fade speed
    this.nightMode = false;
    this.layers = [];    // active {gain, stop()} objects for the current soundscape
    this._scheduleTimers = [];
  }

  function crossfadeMs(engine) {
    return (typeof AuditoryRegulation !== "undefined")
      ? AuditoryRegulation.computeCrossfadeMs(engine.mode, engine.nightMode)
      : CROSSFADE_MS;
  }

  AmbientEngine.prototype._ctx = function () { this.am.ensureCtx(); return this.am.ctx; };
  AmbientEngine.prototype._bus = function () { return this.am.getBus("ambient"); };

  // ---- noise buffer generators (white/pink/brown — same math as the
  // original Peil/Calm-Companion synthesis, unchanged) ----
  AmbientEngine.prototype._noiseBuffer = function (type) {
    const ctx = this._ctx();
    const size = 2 * ctx.sampleRate;
    const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    if (type === "white") {
      for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
    } else if (type === "pink") {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < size; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
        data[i] = out * 0.11;
      }
    } else if (type === "brown") {
      let last = 0;
      for (let i = 0; i < size; i++) {
        const wn = Math.random() * 2 - 1;
        last = (last + 0.02 * wn) / 1.02;
        data[i] = last * 3.5;
      }
    }
    return buffer;
  };

  function makeLayerGain(engine, target) {
    const ctx = engine._ctx();
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(engine._bus());
    const now = ctx.currentTime;
    g.gain.linearRampToValueAtTime(target, now + crossfadeMs(engine) / 1000);
    return g;
  }

  function fadeOutAndStop(ctx, gainNode, stopFn, ms) {
    const durationMs = ms || CROSSFADE_MS;
    const now = ctx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(gainNode.gain.value, now);
    gainNode.gain.linearRampToValueAtTime(0, now + durationMs / 1000);
    setTimeout(() => { try { stopFn(); } catch (e) {} try { gainNode.disconnect(); } catch (e) {} }, durationMs + 60);
  }

  // ---- layer builders — each returns { gain, stop() } ----
  AmbientEngine.prototype._loopNoiseLayer = function (type, level) {
    const ctx = this._ctx();
    const gain = makeLayerGain(this, level);
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(type);
    src.loop = true;
    src.connect(gain);
    src.start(0);
    return { gain, stop: () => src.stop() };
  };

  AmbientEngine.prototype._toneLayer = function (level) {
    const ctx = this._ctx();
    const gain = makeLayerGain(this, level);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = this.mode === "relax" ? 110 : 144;
    osc.connect(gain);
    osc.start();
    return { gain, stop: () => osc.stop() };
  };

  // Filtered white noise + a slow gain LFO for variable "intensity" — reads
  // as rainfall rather than static.
  AmbientEngine.prototype._rainLayer = function (level) {
    const ctx = this._ctx();
    const gain = makeLayerGain(this, level);
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer("white");
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 3200;
    filter.Q.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.18;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    src.connect(filter);
    filter.connect(gain);
    src.start(0);
    lfo.start();
    return { gain, stop: () => { src.stop(); lfo.stop(); } };
  };

  // Bandpassed noise with a slow filter-frequency sweep — reads as gusting
  // wind rather than a fixed hiss.
  AmbientEngine.prototype._windLayer = function (level) {
    const ctx = this._ctx();
    const gain = makeLayerGain(this, level);
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer("pink");
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 500;
    filter.Q.value = 0.7;
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 300;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    src.connect(filter);
    filter.connect(gain);
    src.start(0);
    lfo.start();
    return { gain, stop: () => { src.stop(); lfo.stop(); } };
  };

  // Brown noise + a slow (~7s period) swell — reads as waves, not surf detail.
  AmbientEngine.prototype._oceanLayer = function (level) {
    const ctx = this._ctx();
    const gain = makeLayerGain(this, level);
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer("brown");
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    const swell = ctx.createOscillator();
    swell.type = "sine";
    swell.frequency.value = 1 / 7;
    const swellGain = ctx.createGain();
    swellGain.gain.value = level * 0.35;
    swell.connect(swellGain);
    swellGain.connect(gain.gain);
    src.connect(filter);
    filter.connect(gain);
    src.start(0);
    swell.start();
    return { gain, stop: () => { src.stop(); swell.stop(); } };
  };

  // Generative layers (piano, birds) schedule their own notes recursively —
  // "stop" just needs to cancel the pending timer, the already-triggered
  // oscillators finish their own short envelopes naturally.
  AmbientEngine.prototype._pianoLayer = function (level) {
    const ctx = this._ctx();
    const gain = makeLayerGain(this, level);
    const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25]; // C major-ish, calm
    let timerId = null;
    let stopped = false;
    const playNote = () => {
      if (stopped) return;
      const freq = scale[Math.floor(Math.random() * scale.length)];
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      env.gain.value = 0;
      osc.connect(env);
      env.connect(gain);
      const now = ctx.currentTime;
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(0.5, now + 0.03);
      env.gain.exponentialRampToValueAtTime(0.001, now + 2.2);
      osc.start(now);
      osc.stop(now + 2.3);
      timerId = setTimeout(playNote, 2200 + Math.random() * 2600);
    };
    timerId = setTimeout(playNote, 400);
    return { gain, stop: () => { stopped = true; clearTimeout(timerId); } };
  };

  AmbientEngine.prototype._birdsLayer = function (level) {
    const ctx = this._ctx();
    const gain = makeLayerGain(this, level);
    let timerId = null;
    let stopped = false;
    const chirp = () => {
      if (stopped) return;
      const bursts = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < bursts; i++) {
        setTimeout(() => {
          if (stopped) return;
          const osc = ctx.createOscillator();
          const env = ctx.createGain();
          osc.type = "sine";
          const base = 2200 + Math.random() * 1400;
          osc.frequency.setValueAtTime(base, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(base * 1.4, ctx.currentTime + 0.08);
          env.gain.setValueAtTime(0, ctx.currentTime);
          env.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.015);
          env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
          osc.connect(env);
          env.connect(gain);
          osc.start();
          osc.stop(ctx.currentTime + 0.16);
        }, i * 140);
      }
      timerId = setTimeout(chirp, 3000 + Math.random() * 5000);
    };
    timerId = setTimeout(chirp, 1000);
    return { gain, stop: () => { stopped = true; clearTimeout(timerId); } };
  };

  const BUILDERS = {
    white: (e, lvl) => [e._loopNoiseLayer("white", lvl)],
    pink: (e, lvl) => [e._loopNoiseLayer("pink", lvl)],
    brown: (e, lvl) => [e._loopNoiseLayer("brown", lvl)],
    tone: (e, lvl) => [e._toneLayer(lvl)],
    rain: (e, lvl) => [e._rainLayer(lvl)],
    wind: (e, lvl) => [e._windLayer(lvl)],
    ocean: (e, lvl) => [e._oceanLayer(lvl)],
    piano: (e, lvl) => [e._pianoLayer(lvl)],
    birds: (e, lvl) => [e._birdsLayer(lvl)],
    forest: (e, lvl) => [e._windLayer(lvl * 0.5), e._birdsLayer(lvl), e._loopNoiseLayer("brown", lvl * 0.25)],
    nature: (e, lvl) => [e._windLayer(lvl * 0.6), e._birdsLayer(lvl * 0.9)],
  };

  AmbientEngine.prototype.availableSoundscapes = function () {
    return ["off"].concat(Object.keys(BUILDERS));
  };

  AmbientEngine.prototype.setMode = function (mode) {
    this.mode = mode;
    this.layers.forEach((l) => { if (l.setMode) l.setMode(mode); });
  };

  AmbientEngine.prototype.setNightMode = function (on) {
    this.nightMode = !!on;
  };

  AmbientEngine.prototype.setSoundscape = function (type, level) {
    this.am.ensureCtx();
    const ctx = this.am.ctx;
    const oldLayers = this.layers;
    const fadeMs = crossfadeMs(this);
    this.layers = [];
    oldLayers.forEach((l) => fadeOutAndStop(ctx, l.gain, l.stop, fadeMs));

    // Fail loudly, not silently: a soundscape key the UI offers but this
    // engine has no builder for would otherwise just do nothing, with no
    // signal to anyone about why. Every key this app's UI actually offers
    // has a real builder below — this only fires for a genuinely unknown key.
    if (type !== "off" && !BUILDERS[type]) {
      console.warn(`AmbientEngine: no synthesis builder for soundscape "${type}" — playing silence instead of guessing.`);
    }

    this.soundscape = type;
    if (type === "off" || !BUILDERS[type]) return;
    this.layers = BUILDERS[type](this, level != null ? level : 1);
  };

  // Live level control (0..1) for the whole current soundscape, ramped
  // smoothly rather than jumped, distinct from AudioManager's bus volume
  // (this is "how loud is the soundscape at its own base level", the bus
  // volume on top of it is the user's overall ambient slider).
  AmbientEngine.prototype.setLevel = function (level) {
    if (!this.am.ctx) return;
    const now = this.am.ctx.currentTime;
    this.layers.forEach((l) => {
      l.gain.gain.cancelScheduledValues(now);
      l.gain.gain.setValueAtTime(l.gain.gain.value, now);
      l.gain.gain.linearRampToValueAtTime(level, now + 0.6);
    });
  };

  if (typeof window !== "undefined") window.AmbientEngine = AmbientEngine;
})();
