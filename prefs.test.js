const test = require("node:test");
const assert = require("node:assert/strict");
const Prefs = require("./prefs.js");

// Node has no localStorage — a minimal in-memory stand-in, fresh per test.
function installFakeLocalStorage() {
  const store = new Map();
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

test("sanitizeAudio: a corrupted/hand-edited value degrades field-by-field to defaults, not wholesale", () => {
  const result = Prefs.sanitizeAudio({ masterVolume: 5, soundscape: "not-a-real-one", mode: "bogus", enabled: "yes" });
  assert.equal(result.masterVolume, Prefs.DEFAULTS.audio.masterVolume);
  assert.equal(result.soundscape, Prefs.DEFAULTS.audio.soundscape);
  assert.equal(result.mode, Prefs.DEFAULTS.audio.mode);
  assert.equal(result.enabled, Prefs.DEFAULTS.audio.enabled);
});

test("sanitizeAudio: valid values pass through untouched", () => {
  const result = Prefs.sanitizeAudio({ masterVolume: 0.3, soundscape: "rain", mode: "concentrate", enabled: false });
  assert.equal(result.masterVolume, 0.3);
  assert.equal(result.soundscape, "rain");
  assert.equal(result.mode, "concentrate");
  assert.equal(result.enabled, false);
});

test("sanitizeAudio: an unknown preset name falls back to the default preset", () => {
  const result = Prefs.sanitizeAudio({ preset: "not-a-real-preset" });
  assert.equal(result.preset, Prefs.DEFAULTS.audio.preset);
});

test("new Prefs(): loads defaults when localStorage is empty", () => {
  installFakeLocalStorage();
  const prefs = new Prefs();
  assert.deepEqual(prefs.get().audio, Prefs.DEFAULTS.audio);
  assert.deepEqual(prefs.get().haptics, Prefs.DEFAULTS.haptics);
});

test("set(): merges a patch, persists it, and re-validates the audio half through the same sanitizer", () => {
  installFakeLocalStorage();
  const prefs = new Prefs();
  prefs.set({ audio: { ambientVolume: 0.9, masterVolume: 99 } });
  assert.equal(prefs.get().audio.ambientVolume, 0.9);
  assert.equal(prefs.get().audio.masterVolume, Prefs.DEFAULTS.audio.masterVolume, "an out-of-range value must be caught by set(), not just load()");

  const reloaded = new Prefs();
  assert.equal(reloaded.get().audio.ambientVolume, 0.9, "must actually persist across a fresh instance");
});

test("set(): a haptics patch merges without touching audio", () => {
  installFakeLocalStorage();
  const prefs = new Prefs();
  prefs.set({ haptics: { intensity: 0.9 } });
  assert.equal(prefs.get().haptics.intensity, 0.9);
  assert.deepEqual(prefs.get().audio, Prefs.DEFAULTS.audio);
});

test("applyAudioPreset: a named preset sets mode/soundscape/volumes together", () => {
  installFakeLocalStorage();
  const prefs = new Prefs();
  const result = prefs.applyAudioPreset("focus");
  assert.equal(result.preset, "focus");
  assert.equal(result.mode, Prefs.AUDIO_PRESETS.focus.mode);
  assert.equal(result.soundscape, Prefs.AUDIO_PRESETS.focus.soundscape);
});

test("applyAudioPreset('custom'): restores whatever was last captured, defaulting sanely if nothing was", () => {
  installFakeLocalStorage();
  const prefs = new Prefs();
  const result = prefs.applyAudioPreset("custom");
  assert.equal(result.preset, "custom");
});

test("captureCustomAudio: snapshots the current manual settings under 'custom' for later restoration", () => {
  installFakeLocalStorage();
  const prefs = new Prefs();
  prefs.set({ audio: { ambientVolume: 0.77, soundscape: "wind" } });
  prefs.captureCustomAudio();
  assert.equal(prefs.get().audio.preset, "custom");
  assert.equal(prefs.get().audio.custom.ambientVolume, 0.77);
  assert.equal(prefs.get().audio.custom.soundscape, "wind");
});

test("resetAudioDefaults: restores the full default audio block, ignoring whatever was set before", () => {
  installFakeLocalStorage();
  const prefs = new Prefs();
  prefs.set({ audio: { ambientVolume: 0.1, preset: "focus" } });
  const result = prefs.resetAudioDefaults();
  assert.deepEqual(result, Prefs.DEFAULTS.audio);
});

test("load(): unreadable/corrupted JSON in storage falls back to full defaults instead of throwing", () => {
  installFakeLocalStorage();
  global.localStorage.setItem("calmcompanion.prefs.v1", "{not valid json");
  const prefs = new Prefs();
  assert.deepEqual(prefs.get().audio, Prefs.DEFAULTS.audio);
});
