// ---------------------------------------------------------------------------
// KalimbaEngine — synthesis only, no DOM/pointer handling (see
// kalimbacontroller.js for that half — same split as autocompletecontroller.js's
// pure-vs-DOM division). Everything here is procedurally generated with the
// Web Audio API, using the same primitives already used throughout this
// project (filtered noise bursts, detuned oscillators, gain envelopes — see
// ambientengine.js) — no audio sample files, no new synthesis technique
// introduced, just the existing toolkit retuned for a plucked metal tine
// instead of noise/wind/birds.
//
// 11 tines, a single pentatonic scale (no semitones at all) — this is a
// deliberate constraint, not a limitation: on a pentatonic scale, ANY
// combination or order of tines played together is consonant. There is no
// wrong note. That's what makes "anyone can create something that sounds
// good" possible without a formal music lesson, and what guarantees "no
// harsh sounds" structurally rather than by trusting careful playing.
// ---------------------------------------------------------------------------
(function (root) {
  "use strict";

  // C major pentatonic across ~3 octaves — warm, calm, unambiguous.
  // Extended from 11 to 15 tines (2026-07-30): two lower (G3/A3) and two
  // higher (D6/E6) notes, still strictly the same pentatonic scale, so the
  // "no wrong note" guarantee in this file's header holds unchanged.
  const KALIMBA_PITCHES = [
    196.0, 220.0,                           // G3 A3
    261.63, 293.66, 329.63, 392.0, 440.0,   // C4 D4 E4 G4 A4
    523.25, 587.33, 659.25, 783.99, 880.0,  // C5 D5 E5 G5 A5
    1046.5, 1174.66, 1318.51,               // C6 D6 E6
  ];
  const TINE_COUNT = KALIMBA_PITCHES.length;

  // Selectable keys (2026-08-03, direct request: "more sound like different
  // keys") — each one is a real equal-tempered TRANSPOSITION of the exact
  // same pentatonic shape above, computed from KALIMBA_PITCHES rather than
  // hand-typed, so every key is guaranteed to be the same interval pattern
  // at a different pitch center (still "no wrong note" — see this file's
  // header). Deliberately NOT offering a same-notes "relative minor" preset
  // (e.g. "A minor pentatonic" uses the identical pitch classes as C major
  // pentatonic) — on an instrument with no drone/bass to establish a tonal
  // center, that would be a cosmetic label change with no audible
  // difference, not a real "different key".
  function transposeSemitones(pitches, semitones) {
    const ratio = Math.pow(2, semitones / 12);
    return pitches.map((f) => f * ratio);
  }
  const KALIMBA_KEYS = {
    C: KALIMBA_PITCHES, // canonical — see KalimbaEngine.pluck's forceCanonicalKey param
    G: transposeSemitones(KALIMBA_PITCHES, 7),
    D: transposeSemitones(KALIMBA_PITCHES, 2),
    F: transposeSemitones(KALIMBA_PITCHES, 5),
  };
  const KEY_NAMES = Object.keys(KALIMBA_KEYS);
  function isValidKeyName(name) { return KEY_NAMES.indexOf(name) !== -1; }

  // Screen left-to-right tine order (an index into KALIMBA_PITCHES for each
  // physical position), matching a real kalimba's layout: the lowest tine
  // sits in the center, and pitch rises alternating outward to each side —
  // not a plain ascending left-to-right row. Center tine (screen position 8
  // of 15) is the lowest pitch (index 0); the highest pitch (index 14) ends
  // up at the far right. Even pitch ranks fan left, odd fan right — the
  // same rule the old 11-tine order followed.
  const TINE_VISUAL_ORDER = [14, 12, 10, 8, 6, 4, 2, 0, 1, 3, 5, 7, 9, 11, 13];

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  /**
   * Maps a raw interaction signal to a 0..1 pluck velocity (loudness/brightness).
   * @param {string} gestureType one of "tap" | "sweep" | "hold" | "doubleTap"
   * @param {number} [intensity01] optional extra input (e.g. drag speed, already 0..1) — callers
   *   that have no natural intensity signal (a plain tap) omit this and get a fixed sensible default.
   * @returns {number} velocity in 0..1, never exactly 0 (a silent "pluck" isn't a pluck) or above 1.
   */
  function velocityFromGesture(gestureType, intensity01) {
    const base = { tap: 0.7, doubleTap: 0.85, sweep: 0.55, hold: 0.6 }[gestureType];
    if (base === undefined) return 0.6; // unrecognized gesture — a safe, audible middle velocity, not silence
    if (intensity01 == null) return base;
    return clamp01(base * 0.6 + clamp01(intensity01) * 0.4);
  }

  /** True only for a tine index this engine can actually play — guards against a bad recorded/received note. */
  function isValidTineIndex(i) {
    return Number.isInteger(i) && i >= 0 && i < TINE_COUNT;
  }

  function KalimbaEngine(audioManager) {
    this.am = audioManager;
    this.keyName = "C";
  }

  KalimbaEngine.prototype._ctx = function () { this.am.ensureCtx(); return this.am.ctx; };
  KalimbaEngine.prototype._bus = function () { return this.am.getBus("instrument"); };

  // Changes the key used by live plucking (on-screen taps AND the local
  // preview of a just-recorded melody) — see pluck()'s forceCanonicalKey
  // param for why saved-Echo discovery playback deliberately does NOT
  // follow this. Falls back to "C" (canonical) for an unrecognized name.
  KalimbaEngine.prototype.setKey = function (name) {
    this.keyName = isValidKeyName(name) ? name : "C";
  };
  KalimbaEngine.prototype.getKey = function () { return this.keyName; };

  // A short burst of filtered noise for the pluck's attack transient — same
  // technique as ambientengine.js's rain/wind layers, just much shorter and
  // brighter, since a metal tine's attack is a click, not a hiss.
  KalimbaEngine.prototype._pluckTransient = function (ctx, destination, velocity, pan) {
    const dur = 0.02;
    const size = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 1800;
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    if (panner) { panner.pan.value = pan; gain.connect(panner); panner.connect(destination); }
    else { gain.connect(destination); }
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.18 * velocity, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.start(now);
    src.stop(now + dur + 0.01);
  };

  // One resonant partial of the tine's body — a detuned oscillator with its
  // own decay envelope. Real metal tines ring with inharmonic overtones
  // (not clean integer multiples of the fundamental), which is what keeps
  // this from sounding like a synth bleep — see the ratios below.
  KalimbaEngine.prototype._partial = function (ctx, destination, freq, gainMult, decaySec, velocity, pan) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    osc.type = "triangle";
    osc.frequency.value = freq;
    env.gain.value = 0;
    osc.connect(env);
    if (panner) { panner.pan.value = pan; env.connect(panner); panner.connect(destination); }
    else { env.connect(destination); }
    const now = ctx.currentTime;
    const peak = gainMult * (0.25 + velocity * 0.55);
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(peak, now + 0.006); // fast but not instant — a pluck, not a click
    env.gain.exponentialRampToValueAtTime(0.0005, now + decaySec);
    osc.start(now);
    osc.stop(now + decaySec + 0.05);
  };

  /**
   * Plays one tine. Silently ignores an invalid index rather than throwing —
   * this is called from live pointer input and recorded-melody playback
   * alike, neither of which should be able to crash a performance in
   * progress over one bad value.
   * @param {number} tineIndex 0..14 (see KALIMBA_PITCHES)
   * @param {number} [velocity01] 0..1, defaults to a comfortable middle value
   * @param {boolean} [forceCanonicalKey] When true, ignores the currently
   *   selected key and always plays tineIndex against the canonical C
   *   tuning (KALIMBA_PITCHES) regardless of this.keyName. Echoes only ever
   *   store a raw tine INDEX (see migrations/0001_create_echoes.sql's
   *   melody_json), never a frequency or key name — so without this, an
   *   Echo recorded in one key would sound different to whoever discovers
   *   it later with a different key selected, or even to its own creator
   *   after switching keys. echorecorder.js sets this true specifically for
   *   discovery playback (an explicitly-passed melody payload), false for
   *   live plucking and previewing your own just-recorded take.
   */
  KalimbaEngine.prototype.pluck = function (tineIndex, velocity01, forceCanonicalKey) {
    if (!isValidTineIndex(tineIndex)) {
      console.warn(`KalimbaEngine: ignored pluck for out-of-range tine index ${tineIndex}.`);
      return;
    }
    const velocity = clamp01(velocity01 == null ? 0.7 : velocity01);
    const ctx = this._ctx();
    const bus = this._bus();
    const pitches = forceCanonicalKey ? KALIMBA_PITCHES : (KALIMBA_KEYS[this.keyName] || KALIMBA_PITCHES);
    const freq = pitches[tineIndex];
    // Pan follows the tine's physical (visual) position, not its pitch rank,
    // so a sweep across the instrument pans left-to-right exactly as seen.
    const visualPos = TINE_VISUAL_ORDER.indexOf(tineIndex);
    const pan = ((visualPos - (TINE_COUNT - 1) / 2) / ((TINE_COUNT - 1) / 2)) * 0.6 + (Math.random() * 0.1 - 0.05);

    this._pluckTransient(ctx, bus, velocity, pan);
    this._partial(ctx, bus, freq, 1.0, 1.9 + velocity * 0.6, velocity, pan);           // fundamental — longest ring
    this._partial(ctx, bus, freq * 2.42, 0.34, 0.9 + velocity * 0.3, velocity, pan);    // inharmonic overtone
    this._partial(ctx, bus, freq * 4.08, 0.14, 0.4, velocity * 0.8, pan);               // bright top, fades fast
  };

  if (typeof module === "object" && module.exports) {
    module.exports = {
      KALIMBA_PITCHES, TINE_COUNT, TINE_VISUAL_ORDER, velocityFromGesture, isValidTineIndex, KalimbaEngine,
      KALIMBA_KEYS, KEY_NAMES, isValidKeyName, transposeSemitones,
    };
  }
  if (typeof window !== "undefined") {
    window.KalimbaEngine = KalimbaEngine;
    window.KalimbaTuning = {
      KALIMBA_PITCHES, TINE_COUNT, TINE_VISUAL_ORDER, velocityFromGesture, isValidTineIndex,
      KALIMBA_KEYS, KEY_NAMES, isValidKeyName,
    };
  }
})(typeof window !== "undefined" ? window : this);
