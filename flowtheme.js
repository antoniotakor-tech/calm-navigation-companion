// ---------------------------------------------------------------------------
// flowtheme.js — the Theme Engine for "Flow Mode," the app's third
// appearance option alongside Light and Dark. Centralizes exactly what the
// spec asked to centralize: the color palette, animation timing, and the
// decision logic for when decorative motion should run — so none of that is
// scattered as magic numbers/colors across style.css or app.js.
//
// Deliberately NOT a full CSS-in-JS engine: this app has no build step and
// no framework, so the actual visual application of these values still
// lives in style.css (a `:root[data-theme="flow"]` variable block, reusing
// the exact same --bg/--surface/--accent/etc. custom properties every other
// component already reads — see FLOW_MODE.md's architecture section for why
// that reuse is what makes this "centralized," not a contradiction of it).
// This file owns: the palette itself, timing constants, the pure decisions
// about running motion vs. not, and theme persistence.
//
// Pure and dependency-free — dual CommonJS/browser-global export, same
// convention as every other shared module in this project.
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FlowTheme = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const THEMES = ["light", "dark", "flow", "bloom", "doodle"]; // bloom: colourful + flowers; doodle: kid-drawing look (2026-10-12)
  const DEFAULT_THEME = "light";

  function isValidTheme(t) {
    return THEMES.indexOf(t) !== -1;
  }

  /**
   * The calming, non-neon palette the spec asked for (deep blue, violet,
   * teal, emerald, cyan, gold, soft pink). Order matters: it's also the
   * cycle `paletteColorForTine` walks through, so adjacent Kalimba tines
   * land on visually adjacent, harmonious colors rather than jumping
   * randomly around the wheel.
   */
  const FLOW_PALETTE = [
    { name: "deep-blue", hex: "#1B2A6B" },
    { name: "violet", hex: "#5B3FA0" },
    { name: "teal", hex: "#1F8A8C" },
    { name: "emerald", hex: "#1E8F6B" },
    { name: "cyan", hex: "#3FD1D9" },
    { name: "gold", hex: "#E8C170" },
    { name: "soft-pink", hex: "#E38FB0" },
  ];

  /** Maps a Kalimba tine (0-10) to a palette color — "colours gently shift with the melody." Wraps rather than clamping, so every tine still gets a real, distinct-ish color instead of everything past index 6 collapsing onto soft-pink. */
  function paletteColorForTine(tineIndex) {
    if (!Number.isInteger(tineIndex) || tineIndex < 0) return FLOW_PALETTE[0].hex;
    return FLOW_PALETTE[tineIndex % FLOW_PALETTE.length].hex;
  }

  // Centralized animation timing (seconds unless noted). The three
  // background-layer durations are deliberately close-but-not-equal and
  // pairwise coprime-ish (47, 61, 83 are all prime) — three CSS animations
  // with prime-second periods take days to realign into a repeated
  // combined pattern, which is what "no loops that feel repetitive" means
  // in a static-CSS implementation (see FLOW_MODE.md for why this project
  // uses layered CSS gradients here rather than a canvas/WebGL shader).
  const TIMING = {
    backgroundLayerDurationsSec: [47, 61, 83, 97],
    markerBreatheSec: 4.2,
    routeShimmerSec: 6,
    particleFloatSec: 5.5,
    mapTintShiftSec: 20,
    reactivePulseMs: 900, // one-shot fade duration for a single Kalimba-note glow
  };

  /**
   * Pure decision: should Flow's decorative (non-essential) animations run
   * right now? Every reason to say no is spec-mandated: reduced motion,
   * battery saver, or the app/tab being backgrounded. Navigation state is
   * intentionally NOT a reason to stop — ambient decoration during active
   * turn-by-turn guidance is exactly the "calm while walking" moment this
   * mode exists for.
   */
  function shouldAnimateFlowDecor(ctx) {
    const c = ctx || {};
    if (c.reducedMotion) return false;
    if (c.batterySaver) return false;
    if (c.backgrounded) return false;
    return true;
  }

  /** Cycles Light -> Dark -> Flow -> Bloom -> Light, for the header's quick-toggle button. */
  function nextTheme(current) {
    const idx = THEMES.indexOf(current);
    return THEMES[idx === -1 ? 0 : (idx + 1) % THEMES.length];
  }

  function isFlowActive(theme) {
    return theme === "flow";
  }

  // Flowers on calm spots + the arrival petal burst run in EVERY theme
  // (2026-10-12: playful by default). Reduced Motion still turns motion off.
  function isBloomActive(theme) {
    return isValidTheme(theme) || theme == null || theme === "";
  }

  // Whether a theme should render with the dark CARTO tileset. Flow uses
  // the dark tiles as its base (a night-sky "living dream" reads right;
  // the light tileset would fight the aurora-style overlay) — this is the
  // one place that fact is recorded, rather than being a scattered `||
  // theme === "flow"` sprinkled into app.js's own tile-selection logic.
  function usesDarkMapTiles(theme) {
    return theme === "dark" || theme === "flow";
  }

  const STORAGE_KEY = "calmcompanion.theme.v1";

  /** Reads the persisted theme choice, or null if none/invalid/unavailable (private browsing, quota errors) — callers fall back to system preference exactly as before this feature existed. */
  function loadStoredTheme() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return isValidTheme(v) ? v : null;
    } catch (e) {
      return null;
    }
  }

  function saveTheme(theme) {
    try {
      if (isValidTheme(theme)) localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {
      // Private browsing / quota — degrade silently, same convention as prefs.js.
    }
  }

  const api = {
    isBloomActive,
    THEMES, DEFAULT_THEME, isValidTheme,
    FLOW_PALETTE, paletteColorForTine,
    TIMING, shouldAnimateFlowDecor, nextTheme, isFlowActive, usesDarkMapTiles,
    STORAGE_KEY, loadStoredTheme, saveTheme,
  };
  return api;
});
