// ---------------------------------------------------------------------------
// looperlogic.js (2026-10-13) — the pure, testable half of the Studio looper.
// A loop is 2 bars (32 sixteenth-steps) at the drum machine's tempo. A layer
// is the list of notes someone played during one pass of the loop: chord
// pads and kalimba tines, each stored by its position in steps, so layers
// stay in time even if the tempo changes. Sound lives in studio.js.
// Same dual CommonJS/browser-global export as drummachine.js.
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LooperLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const LOOP_STEPS = 32;          // 2 bars of 16ths
  const MAX_LAYERS = 8;
  const MAX_EVENTS = 400;         // per layer
  const CHORD_DEGREES = 8;        // studio.js DEGREES length
  const TINES = 15;               // kalimbaengine.js TINE_COUNT
  const KEYS = ["C", "G", "D", "F", "A"];
  const SOUNDS = ["pad", "keys", "pluck"];

  /** Position (in steps, 0 <= pos < LOOP_STEPS) of `time` inside a loop that started at `loopStart`. */
  function posInLoop(time, loopStart, stepSec) {
    if (!(stepSec > 0)) return 0;
    const raw = (time - loopStart) / stepSec;
    const p = ((raw % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS;
    return Math.round(p * 1000) / 1000;
  }

  /** Snap to the nearest grid line (in steps), wrapping the last one back to 0. */
  function quantize(pos, grid) {
    if (!(grid > 0)) return pos;
    const q = Math.round(pos / grid) * grid;
    return q >= LOOP_STEPS ? 0 : q;
  }

  const num = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
  /** True for a well-formed note: kalimba {t:'k', p, tine, v, key} or chord {t:'c', p, d, len, s, key}. */
  function isValidEvent(e) {
    if (!e || typeof e !== "object" || !num(e.p, 0, LOOP_STEPS - 1e-9) || !KEYS.includes(e.key)) return false;
    if (e.t === "k") return Number.isInteger(e.tine) && e.tine >= 0 && e.tine < TINES && num(e.v, 0, 1);
    if (e.t === "c") return Number.isInteger(e.d) && e.d >= 0 && e.d < CHORD_DEGREES && num(e.len, 0.25, LOOP_STEPS) && SOUNDS.includes(e.s);
    return false;
  }

  /** Builds a layer from the notes played in one pass, or null when nothing was played. */
  function makeLayer(events, id) {
    const ok = (events || []).filter(isValidEvent).slice(0, MAX_EVENTS).sort((a, b) => a.p - b.p);
    if (!ok.length) return null;
    const hasK = ok.some((e) => e.t === "k"), hasC = ok.some((e) => e.t === "c");
    const name = hasK && hasC ? "Chords + kalimba" : hasC ? "Chords" : "Kalimba";
    return { id: String(id), name, muted: false, events: ok };
  }

  /** Notes that start inside step `step` (pos in [step, step+1)), with their offset inside the step. */
  function eventsInStep(layers, step) {
    const out = [];
    (layers || []).forEach((layer) => {
      if (layer.muted) return;
      layer.events.forEach((e) => { if (e.p >= step && e.p < step + 1) out.push({ layer: layer.id, e, offset: e.p - step }); });
    });
    return out;
  }

  /** Adds a layer, keeping at most MAX_LAYERS (the oldest drops off). Returns a new array. */
  function addLayer(layers, layer) {
    if (!layer) return layers.slice();
    return [...layers, layer].slice(-MAX_LAYERS);
  }
  const removeLayer = (layers, id) => layers.filter((l) => l.id !== String(id));
  const toggleMute = (layers, id) => layers.map((l) => (l.id === String(id) ? { ...l, muted: !l.muted } : l));

  function serialize(layers) { return JSON.stringify({ v: 1, layers }); }
  /** Restores saved layers, dropping anything malformed. Never throws. */
  function deserialize(text) {
    try {
      const o = JSON.parse(text);
      if (!o || o.v !== 1 || !Array.isArray(o.layers)) return [];
      return o.layers.slice(-MAX_LAYERS).map((l) => {
        const layer = makeLayer(l && l.events, l && l.id);
        if (!layer) return null;
        if (typeof l.name === "string" && l.name.length <= 40) layer.name = l.name;
        layer.muted = !!(l && l.muted);
        return layer;
      }).filter(Boolean);
    } catch (e) { return []; }
  }

  /** Length of one loop in seconds at `bpm` (16th-note steps). */
  function loopSeconds(bpm) { return (LOOP_STEPS * 60) / bpm / 4; }

  return { LOOP_STEPS, MAX_LAYERS, MAX_EVENTS, posInLoop, quantize, isValidEvent, makeLayer, eventsInStep, addLayer, removeLayer, toggleMute, serialize, deserialize, loopSeconds };
});
