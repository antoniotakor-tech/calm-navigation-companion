// ---------------------------------------------------------------------------
// drummachine.js (2026-10-12) — the pure, testable half of the Studio's drum
// machine: tracks, 16-step patterns, presets, tempo, timing maths and
// save/restore. Sound and scheduling live in studio.js (Web Audio).
// Same dual CommonJS/browser-global export as the rest of the project.
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DrumMachine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const STEPS = 16;
  const TRACKS = [
    { id: "kick", label: "Kick", color: "#FF8FB8" },
    { id: "snare", label: "Snare", color: "#FFD84D" },
    { id: "clap", label: "Clap", color: "#FF9F43" },
    { id: "hat", label: "Hi-hat", color: "#7CC8FF" },
    { id: "tom", label: "Tom", color: "#B58CFF" },
    { id: "shaker", label: "Shaker", color: "#7ED67A" },
  ];
  const MIN_BPM = 60, MAX_BPM = 140, DEFAULT_BPM = 84;

  const row = (s) => s.split("").map((c) => c === "x");
  const PRESETS = {
    calm: { label: "Calm beat", bpm: 76, rows: {
      kick: row("x.......x.x....."), snare: row("....x.......x..."), clap: row("................"),
      hat: row("x.x.x.x.x.x.x.x."), tom: row("................"), shaker: row("..x...x...x...x.") } },
    walk: { label: "Walking", bpm: 96, rows: {
      kick: row("x...x...x...x..."), snare: row("....x.......x..."), clap: row("............x..."),
      hat: row("..x...x...x...x."), tom: row("..............x."), shaker: row("x.xxx.xxx.xxx.xx") } },
    boombap: { label: "Boom bap", bpm: 88, rows: {
      kick: row("x.....x...x....."), snare: row("....x.......x..."), clap: row("....x.......x..x"),
      hat: row("x.x.x.x.x.x.x.xx"), tom: row("................"), shaker: row("................") } },
    empty: { label: "Empty", bpm: DEFAULT_BPM, rows: {} },
  };

  function emptyPattern() {
    const rows = {};
    TRACKS.forEach((t) => { rows[t.id] = new Array(STEPS).fill(false); });
    return { bpm: DEFAULT_BPM, rows, volume: 0.8 };
  }

  function clampBpm(bpm) {
    const n = Math.round(Number(bpm));
    return Number.isFinite(n) ? Math.min(MAX_BPM, Math.max(MIN_BPM, n)) : DEFAULT_BPM;
  }

  function fromPreset(name) {
    const p = PRESETS[name] || PRESETS.calm;
    const out = emptyPattern();
    out.bpm = p.bpm;
    TRACKS.forEach((t) => { if (p.rows[t.id]) out.rows[t.id] = p.rows[t.id].slice(); });
    return out;
  }

  function toggle(pattern, trackId, step) {
    if (!pattern.rows[trackId] || step < 0 || step >= STEPS) return pattern;
    const next = { ...pattern, rows: { ...pattern.rows, [trackId]: pattern.rows[trackId].slice() } };
    next.rows[trackId][step] = !next.rows[trackId][step];
    return next;
  }

  /** Seconds per 16th-note step at this tempo. */
  function stepSeconds(bpm) { return 60 / clampBpm(bpm) / 4; }

  /** Tracks that sound on a step. */
  function hitsAt(pattern, step) {
    return TRACKS.filter((t) => pattern.rows[t.id] && pattern.rows[t.id][step % STEPS]).map((t) => t.id);
  }

  /** Compact save format: "x..x" strings, robust to bad/old data. */
  function serialize(pattern) {
    const rows = {};
    TRACKS.forEach((t) => { rows[t.id] = (pattern.rows[t.id] || []).map((on) => (on ? "x" : ".")).join(""); });
    return JSON.stringify({ v: 1, bpm: clampBpm(pattern.bpm), volume: pattern.volume, rows });
  }
  function deserialize(text) {
    try {
      const d = JSON.parse(text);
      if (!d || d.v !== 1) return null;
      const out = emptyPattern();
      out.bpm = clampBpm(d.bpm);
      out.volume = typeof d.volume === "number" ? Math.min(1, Math.max(0, d.volume)) : 0.8;
      TRACKS.forEach((t) => {
        const s = d.rows && typeof d.rows[t.id] === "string" ? d.rows[t.id] : "";
        out.rows[t.id] = Array.from({ length: STEPS }, (_, i) => s[i] === "x");
      });
      return out;
    } catch (e) { return null; }
  }

  return { STEPS, TRACKS, PRESETS, MIN_BPM, MAX_BPM, DEFAULT_BPM, emptyPattern, fromPreset, toggle, clampBpm, stepSeconds, hitsAt, serialize, deserialize };
});
