// ---------------------------------------------------------------------------
// Preferences — the one shared, persisted settings store for both the audio
// engine and the haptic engine. localStorage-backed (this app has no
// account/server), with sane in-memory defaults if storage is unavailable
// (private browsing, quota errors, etc.).
// ---------------------------------------------------------------------------
(function () {
  "use strict";

  const STORAGE_KEY = "calmcompanion.prefs.v1";

  // Soundscape keys here are ambientengine.js's own builder keys (see that
  // file's BUILDERS table) — not free-form strings — so an invalid preset
  // can never point at a soundscape that doesn't exist.
  const AUDIO_PRESETS = {
    focus: { mode: "concentrate", soundscape: "brown", ambient: 0.48, voice: 0.62, effects: 0.16 },
    relax: { mode: "relax", soundscape: "ocean", ambient: 0.52, voice: 0.42, effects: 0.12 },
    "anxiety-relief": { mode: "relax", soundscape: "rain", ambient: 0.42, voice: 0.5, effects: 0.08 },
    minimal: { mode: "concentrate", soundscape: "off", ambient: 0.0, voice: 0.58, effects: 0.08 },
    "urban-explorer": { mode: "concentrate", soundscape: "tone", ambient: 0.32, voice: 0.68, effects: 0.2 },
    custom: null, // "whatever the user last set by hand" — captured on manual change
  };

  const DEFAULTS = {
    audio: {
      enabled: true,       // master on/off for the whole auditory-regulation layer
      preset: "relax",
      masterVolume: 0.8,
      ambientVolume: 0.55,
      voiceVolume: 0.75,
      effectsVolume: 0.25,
      soundscape: "off",
      mode: "relax",
      voiceMuted: true,
      captionsEnabled: true,
      nightMode: false,      // mirrors the dark theme toggle — see app.js's themeToggle handler
      reducedMotion: false,  // mirrors the accessibility settings toggle; kept here too since
                             // this screen's waveform reads it directly
      custom: null,
    },
    haptics: {
      intensity: 0.6,
      sensitivity: 0.5,
      enabled: true, // explicit user override, independent of device support
      soundOn: true,
      animationSpeed: 1.0,
      favoritePattern: null,
    },
  };

  // Kept in sync by hand with ambientengine.js's BUILDERS table + "off" —
  // prefs.js has no reference to that module (loaded earlier, deliberately
  // dependency-free), so this list is duplicated rather than imported.
  const VALID_SOUNDSCAPES = ["off", "white", "pink", "brown", "tone", "rain", "wind", "ocean", "piano", "birds", "forest", "nature"];
  const VALID_MODES = ["relax", "concentrate"];

  function clamp01(v, fallback) {
    return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback;
  }

  // "Validate stored values, safely fall back to defaults" — a corrupted or
  // hand-edited localStorage value (wrong type, out-of-range volume, a
  // soundscape/mode/preset name that no longer exists) degrades field-by-field
  // to its default instead of propagating garbage into the audio engines.
  function sanitizeAudio(raw) {
    const merged = Object.assign({}, DEFAULTS.audio, raw);
    return {
      enabled: typeof merged.enabled === "boolean" ? merged.enabled : DEFAULTS.audio.enabled,
      preset: Object.prototype.hasOwnProperty.call(AUDIO_PRESETS, merged.preset) ? merged.preset : DEFAULTS.audio.preset,
      masterVolume: clamp01(merged.masterVolume, DEFAULTS.audio.masterVolume),
      ambientVolume: clamp01(merged.ambientVolume, DEFAULTS.audio.ambientVolume),
      voiceVolume: clamp01(merged.voiceVolume, DEFAULTS.audio.voiceVolume),
      effectsVolume: clamp01(merged.effectsVolume, DEFAULTS.audio.effectsVolume),
      soundscape: VALID_SOUNDSCAPES.indexOf(merged.soundscape) !== -1 ? merged.soundscape : DEFAULTS.audio.soundscape,
      mode: VALID_MODES.indexOf(merged.mode) !== -1 ? merged.mode : DEFAULTS.audio.mode,
      voiceMuted: typeof merged.voiceMuted === "boolean" ? merged.voiceMuted : DEFAULTS.audio.voiceMuted,
      captionsEnabled: typeof merged.captionsEnabled === "boolean" ? merged.captionsEnabled : DEFAULTS.audio.captionsEnabled,
      nightMode: typeof merged.nightMode === "boolean" ? merged.nightMode : DEFAULTS.audio.nightMode,
      reducedMotion: typeof merged.reducedMotion === "boolean" ? merged.reducedMotion : DEFAULTS.audio.reducedMotion,
      // custom isn't validated field-by-field here — it's re-validated the
      // moment it's actually applied, by applyAudioPreset falling through to
      // whatever's already been through this same sanitizer on a prior save.
      custom: merged.custom && typeof merged.custom === "object" ? merged.custom : null,
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULTS));
      const parsed = JSON.parse(raw);
      return {
        audio: sanitizeAudio(parsed.audio || {}),
        haptics: Object.assign({}, DEFAULTS.haptics, parsed.haptics),
      };
    } catch (e) {
      console.warn("Prefs: saved settings were unreadable, falling back to defaults.", e);
      return JSON.parse(JSON.stringify(DEFAULTS));
    }
  }

  function save(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* private mode / quota — degrade silently */ }
  }

  function Prefs() {
    this.state = load();
  }
  Prefs.prototype.get = function () { return this.state; };
  // Merges `patch` onto the current state and persists it. The audio half is
  // re-validated through the same sanitizer load() uses (not just on
  // startup) — a caller passing a stray out-of-range volume or a typo'd
  // soundscape/mode name is corrected field-by-field instead of silently
  // corrupting engine state until the next reload catches it.
  Prefs.prototype.set = function (patch) {
    this.state = {
      audio: patch.audio ? sanitizeAudio(Object.assign({}, this.state.audio, patch.audio)) : this.state.audio,
      haptics: Object.assign({}, this.state.haptics, patch.haptics),
    };
    save(this.state);
    return this.state;
  };
  // Applies a named preset — mode, soundscape, and all three volumes at
  // once — or restores whatever was last captured under "custom". Returns
  // the resulting audio state so callers can drive the UI/engines from one
  // return value instead of re-reading prefs.get() themselves.
  Prefs.prototype.applyAudioPreset = function (name) {
    const preset = AUDIO_PRESETS[name];
    if (name !== "custom" && preset) {
      this.set({ audio: { preset: name, mode: preset.mode, ambientVolume: preset.ambient, voiceVolume: preset.voice, effectsVolume: preset.effects, soundscape: preset.soundscape } });
    } else {
      // "Custom" restores whatever was last captured under custom, if anything.
      const custom = this.state.audio.custom;
      this.set({ audio: Object.assign({ preset: "custom" }, custom || {}) });
    }
    return this.state.audio;
  };
  // Called whenever the user manually tweaks a slider/soundscape/mode — keeps
  // the "custom" preset meaningful instead of just being an empty fallback.
  Prefs.prototype.captureCustomAudio = function () {
    const a = this.state.audio;
    this.set({ audio: { preset: "custom", custom: { ambientVolume: a.ambientVolume, voiceVolume: a.voiceVolume, effectsVolume: a.effectsVolume, soundscape: a.soundscape, mode: a.mode } } });
  };
  // Settings sheet's "Reset to defaults" — audio only (haptics keeps its own
  // settings untouched, matching the settings sheet's own scope).
  Prefs.prototype.resetAudioDefaults = function () {
    this.set({ audio: JSON.parse(JSON.stringify(DEFAULTS.audio)) });
    return this.state.audio;
  };

  // Prefs itself is the constructor apps call `new Prefs()` on — the preset
  // table and defaults are attached as static properties for anything that
  // needs them without an instance (kept off the window as separate names to
  // avoid a second global just for two constant tables).
  Prefs.AUDIO_PRESETS = AUDIO_PRESETS;
  Prefs.DEFAULTS = DEFAULTS;
  Prefs.sanitizeAudio = sanitizeAudio;
  Prefs.VALID_SOUNDSCAPES = VALID_SOUNDSCAPES;
  Prefs.VALID_MODES = VALID_MODES;
  if (typeof window !== "undefined") window.Prefs = Prefs;
  if (typeof module === "object" && module.exports) module.exports = Prefs;
})();
