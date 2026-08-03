// ---------------------------------------------------------------------------
// AmbientEngine — soundscape synthesis and smooth crossfading. Everything
// here is procedurally generated with the Web Audio API (oscillators,
// filtered noise, scheduled notes) — there are no audio sample files in this
// project, so "café" is deliberately NOT offered: overlapping chatter and
// clinking cups doesn't synthesize convincingly, and faking it with noise
// would be misleading rather than calming. Every soundscape below IS a real,
// audible signal, not a placeholder.
//
// Soundscapes: off, white, brown, ocean, nature (wind + birds).
// Trimmed from eleven to four (product decision, 2026-07-29) — pink/tone/
// rain/wind/birds/piano/forest are no longer offered as standalone choices.
// wind/birds/pink-noise-buffer synthesis code stays below regardless: nature
// is built from _windLayer + _birdsLayer, and _windLayer itself is built on
// the "pink" noise buffer, so none of that is actually dead code even though
// it's no longer independently selectable. _toneLayer/_rainLayer/_pianoLayer
// WERE deleted outright — nothing left in this file calls them.
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
  // original Peil/Calm-Companion synthesis, now generated per-channel
  // instead of mono) ----
  //
  // Real 2-channel noise, each channel its own independent random draw —
  // not a mono signal duplicated to both ears. Two truly decorrelated noise
  // sources is the standard technique for perceived stereo "width" (the
  // same reason real recorded nature audio uses spaced/stereo mics rather
  // than a single mono capsule); a duplicated-mono signal collapses to a
  // single point dead-center no matter how loud it is. This alone is what
  // makes white/brown/wind/ocean stop sounding like they're playing from
  // one spot inside the listener's head.
  AmbientEngine.prototype._noiseBuffer = function (type) {
    const ctx = this._ctx();
    const size = 2 * ctx.sampleRate;
    const buffer = ctx.createBuffer(2, size, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
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
    }
    return buffer;
  };

  // Short (1.1s), procedurally-generated exponentially-decaying noise
  // impulse response — no external audio files, same synthesis-only
  // convention as every sound in this file. Gives the ambient bed a sense
  // of open space (reflections, not a dead-center point source) instead of
  // sounding like it's playing right at the eardrum. Built once per engine
  // instance and reused across every soundscape switch.
  AmbientEngine.prototype._reverbImpulse = function (seconds, decay) {
    const ctx = this._ctx();
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  };

  // Lazily-created shared reverb send every layer's gain also feeds,
  // alongside its normal dry connection to the ambient bus (see
  // makeLayerGain below). Kept deliberately subtle (low wet gain) — this is
  // meant to read as "outdoors", not as a cave or a plugin demo.
  AmbientEngine.prototype._reverbSend = function () {
    if (this._reverbWetGain) return this._reverbWetGain;
    const ctx = this._ctx();
    const convolver = ctx.createConvolver();
    convolver.buffer = this._reverbImpulse(1.1, 2.2);
    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.22;
    convolver.connect(wetGain);
    wetGain.connect(this._bus());
    this._reverbWetGain = wetGain;
    this._reverbConvolver = convolver;
    return wetGain;
  };

  function makeLayerGain(engine, target) {
    const ctx = engine._ctx();
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(engine._bus());
    // Every layer feeds the shared reverb send too, in parallel with its dry
    // path to the bus above — same source, two destinations, standard
    // wet/dry mix wiring. _reverbSend() lazily builds the convolver -> wet
    // gain -> bus chain on first call and just returns it on every later one.
    engine._reverbSend();
    g.connect(engine._reverbConvolver);
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

  // Generative layer (birds) schedules its own notes recursively — "stop"
  // just needs to cancel the pending timer, the already-triggered
  // oscillators finish their own short envelopes naturally.
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
          // A slight randomized stereo position per chirp — real birdsong
          // doesn't come from dead center, and a fixed position on every
          // single chirp would read as one robotic bird on a loop rather
          // than an ambient flock scattered around the listener.
          if (ctx.createStereoPanner) {
            const panner = ctx.createStereoPanner();
            panner.pan.value = Math.random() * 1.2 - 0.6;
            env.connect(panner);
            panner.connect(gain);
          } else {
            env.connect(gain);
          }
          osc.start();
          osc.stop(ctx.currentTime + 0.16);
        }, i * 140);
      }
      timerId = setTimeout(chirp, 3000 + Math.random() * 5000);
    };
    timerId = setTimeout(chirp, 1000);
    return { gain, stop: () => { stopped = true; clearTimeout(timerId); } };
  };

  // wind/birds are no longer independently selectable (see file header) but
  // stay as the two calls nature's own builder makes directly below.
  const BUILDERS = {
    white: (e, lvl) => [e._loopNoiseLayer("white", lvl)],
    brown: (e, lvl) => [e._loopNoiseLayer("brown", lvl)],
    ocean: (e, lvl) => [e._oceanLayer(lvl)],
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
