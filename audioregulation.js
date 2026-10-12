// ---------------------------------------------------------------------------
// Auditory regulation — pure decision logic shared by AudioManager,
// VoiceEngine, EffectsEngine, and AmbientEngine. No DOM, no Web Audio API,
// no state of its own — every function here takes the current mode/night-
// mode/preset as plain arguments and returns plain numbers, so it can be
// unit-tested with `node --test` the same as navlogic.js/routing.js, and so
// the four engines above stay the single place actual audio nodes exist
// (this file never creates a duplicate audio system).
//
// "Relax" vs "Concentrate" is a real behavioral difference here, not just a
// CSS class — see each function's own comment for exactly what changes and
// why, per the auditory-regulation fix task's requirements.
// ---------------------------------------------------------------------------
(function (root) {
  "use strict";

  const MODES = ["relax", "concentrate"];

  function isValidMode(mode) {
    return MODES.indexOf(mode) !== -1;
  }

  // How hard and how fast the ambient bed ducks under a spoken instruction.
  // Concentrate: faster, deeper ducking — "clearer voice instructions" and
  // "faster ducking when voice instructions play". Relax: shallower, slower
  // ducking — "softer transitions" and "smoother ambient-volume changes".
  // Night mode slows both further on top of the mode's own base timing —
  // "slower audio transitions" at night, regardless of mode.
  function computeDuckParams(mode, nightMode) {
    const base = mode === "concentrate"
      ? { mult: 0.2, downMs: 120, restoreMs: 220 }
      : { mult: 0.42, downMs: 420, restoreMs: 850 };
    if (!nightMode) return base;
    return {
      mult: Math.min(1, base.mult + 0.08), // a little less aggressive ducking at night, too
      downMs: Math.round(base.downMs * 1.6),
      restoreMs: Math.round(base.restoreMs * 1.6),
    };
  }

  // Peak-gain scale applied to one-shot effect tones (off-route/recalculating/
  // arrival/turn-tick). Concentrate: "slightly stronger navigation effects".
  // Relax: "lower effects intensity". Night mode caps it further — "avoid
  // unnecessarily loud alerts" after dark, regardless of mode.
  function computeEffectsScale(mode, nightMode) {
    let scale = mode === "concentrate" ? 1.15 : 0.85;
    if (nightMode) scale *= 0.7;
    return scale;
  }

  // Ambient soundscape crossfade duration (fade-in on select, fade-out on
  // switch/off). Relax: "slower fade-in and fade-out". Concentrate: snappier,
  // so switching soundscapes doesn't feel sluggish mid-task. Night mode
  // slows it further, same rationale as computeDuckParams.
  function computeCrossfadeMs(mode, nightMode) {
    const base = mode === "concentrate" ? 550 : 1100;
    return nightMode ? Math.round(base * 1.4) : base;
  }

  // "Fewer spoken interruptions" in Relax: skip the early "in N meters..."
  // pre-announcement and only speak once genuinely near the maneuver.
  // Concentrate keeps both bands (today's default behavior).
  function shouldSkipFarAnnouncement(mode) {
    return mode === "relax";
  }

  // Speech rate — "clearer voice instructions" in Concentrate reads here as
  // a touch faster/crisper delivery; Relax stays at a calmer, slower pace.
  function computeSpeechRate(mode) {
    return mode === "concentrate" ? 1.08 : 0.95;
  }

  // Central label map for the 5 soundscape options — keys match
  // ambientengine.js's own BUILDERS table + "off" exactly. Every one of
  // these is already a real, working synthesized sound (see that file's
  // header) — there is no missing-audio-asset case among them today. This
  // map exists so the UI has one place to render labels from, and so a
  // *future* soundscape key that's added to the UI without a matching
  // builder fails loudly (see ambientengine.js's setSoundscape) instead of
  // silently doing nothing. Trimmed from 12 down to the 5 that survived the
  // 2026-07-29 subtraction pass (pink/tone/rain/wind/piano/forest/birds are
  // no longer independently selectable — wind/birds live on inside "nature"
  // instead, see ambientengine.js) — the old entries had gone stale and
  // unused since that trim.
  const SOUNDSCAPE_LABELS = {
    off: "Off",
    rain: "Rain",
    stream: "Stream",
    pink: "Soft noise",
    mask: "City mask",
    pads: "Calm tones",
    breathe: "Breathe",
    // Retired from the UI (2026-10-12) but still labelled for old saved prefs.
    white: "White noise",
    brown: "Brown noise",
    ocean: "Ocean",
    nature: "Park",
  };

  if (typeof module === "object" && module.exports) {
    module.exports = {
      MODES, isValidMode,
      computeDuckParams, computeEffectsScale, computeCrossfadeMs,
      shouldSkipFarAnnouncement, computeSpeechRate,
      SOUNDSCAPE_LABELS,
    };
  }
  if (typeof window !== "undefined") {
    window.AuditoryRegulation = {
      MODES, isValidMode,
      computeDuckParams, computeEffectsScale, computeCrossfadeMs,
      shouldSkipFarAnnouncement, computeSpeechRate,
      SOUNDSCAPE_LABELS,
    };
  }
})(typeof window !== "undefined" ? window : this);
