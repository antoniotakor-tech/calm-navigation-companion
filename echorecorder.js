// ---------------------------------------------------------------------------
// EchoRecorder — captures a Kalimba performance as a compact note-event
// melody (no microphone, no audio import — "Kalimba performances only",
// enforced by construction: the only way notes get into a recording is
// through KalimbaController's onPluck callback) and plays melodies back
// through the same KalimbaEngine used for live performance, so a played-back
// Echo sounds identical to the moment it was created.
//
// Same split as autocompletecontroller.js/kalimbacontroller.js:
//   1. Pure helpers + applyRecorderAction() reducer — DOM/audio-free, unit-
//      tested in echorecorder.test.js.
//   2. EchoRecorder — the stateful class that drives the reducer from real
//      pluck events and real wall-clock time, and owns playback scheduling
//      (Web Audio + setTimeout, no DOM element). Not unit-tested, same
//      convention as the rest of this project's audio-engine classes;
//      covered by the manual test checklist instead.
//
// The melody format ({t, tine, v}[]) matches migrations/0001_create_echoes.sql's
// `melody_json` column exactly — no translation layer between what's
// recorded here and what echovalidation.js/the API will store.
//
// Duration/message/nickname bounds and their validators live in
// echovalidation.js, not here — that file is the single shared source of
// truth between this client-side recorder and the server-side Cloudflare
// Functions, so the two can never drift out of sync on what counts as valid.
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./echovalidation.js"));
  else root.EchoRecorderLib = factory(root.EchoValidation);
})(typeof self !== "undefined" ? self : this, function (EchoValidation) {
  "use strict";

  const { MIN_DURATION_MS, MAX_DURATION_MS, MAX_MESSAGE_CHARS, MAX_NICKNAME_CHARS, isDurationValid, validateMessage, validateNickname } = EchoValidation;
  // How long after the last note to keep ambient ducked during playback —
  // a plucked tine's own decay tail (see kalimbaengine.js's _partial: up to
  // ~2.5s at high velocity) needs to actually finish ringing before the
  // ambient bed comes back, or the restore audibly steps on the last note.
  const PLAYBACK_TAIL_MS = 2500;

  // ---- Pure shape helpers -----------------------------------------------------

  /** Never let a recording run past the max — used to auto-stop at exactly 20s instead of relying on timer precision. */
  function clampElapsed(elapsedMs) {
    return Math.max(0, Math.min(elapsedMs, MAX_DURATION_MS));
  }

  /** Rounds a captured event to the precision actually worth storing/transmitting — sub-millisecond timing and sub-percent velocity differences are inaudible. */
  function quantizeEvent(event) {
    return { t: Math.round(event.t), tine: event.tine, v: Math.round(event.v * 100) / 100 };
  }

  function buildMelodyPayload(events, durationMs) {
    return { melody: events.map(quantizeEvent), durationMs: Math.round(durationMs) };
  }

  // ---- Pure state machine ----------------------------------------------------
  //
  // States: "idle" (nothing recorded yet, ready to record) -> "recording"
  // -> "recorded" (stopped, long enough to save) | "tooShort" (stopped, but
  // under MIN_DURATION_MS — Save must be disallowed until Redo) -> "playing"
  // (a sub-state of having a recorded melody; recorded events are untouched).
  // "idle"/"recorded"/"tooShort" all support "cancel" back to a blank idle.

  function initialRecorderState() {
    // `layers` counts completed takes: 1 after the first recording, 2 after
    // an overlay — the UI uses it to cap overdubbing at two layers total.
    return { phase: "idle", events: [], startedAt: null, durationMs: 0, isPlaying: false, layers: 0 };
  }

  /**
   * action: one of
   *   { type: "recordStart", atMs }
   *   { type: "overdubStart", atMs }            — only valid from "recorded":
   *     keeps the already-recorded events as layer 1 and records new plucks
   *     on top, both sharing t=0, so the merged result is still one plain
   *     {t,tine,v}[] melody (no format/schema change anywhere downstream).
   *   { type: "pluck", tine, v, atMs }          — ignored outside "recording"
   *   { type: "stop", atMs }
   *   { type: "playStart" } / { type: "playEnd" } — only valid from "recorded"
   *   { type: "redo" } / { type: "cancel" }
   * Unknown/out-of-phase actions return the state unchanged rather than
   * throwing — a stray late pluck event racing a stop() is a normal timing
   * race, not a bug worth crashing the recorder over.
   */
  function applyRecorderAction(state, action) {
    switch (action.type) {
      case "recordStart":
        if (state.phase !== "idle" && state.phase !== "recorded" && state.phase !== "tooShort") return state;
        return { phase: "recording", events: [], startedAt: action.atMs, durationMs: 0, isPlaying: false, layers: 0 };

      case "overdubStart":
        if (state.phase !== "recorded") return state;
        // events carries the frozen layer-1 take forward; durationMs keeps
        // layer 1's length as the floor (see "stop" below — a short overlay
        // never shrinks the melody, both layers play from t=0).
        return { ...state, phase: "recording", startedAt: action.atMs, isPlaying: false };

      case "pluck": {
        if (state.phase !== "recording") return state;
        const elapsed = clampElapsed(action.atMs - state.startedAt);
        const events = state.events.concat([{ t: elapsed, tine: action.tine, v: action.v }]);
        if (elapsed >= MAX_DURATION_MS) {
          return { ...state, events, phase: "recorded", durationMs: MAX_DURATION_MS, layers: state.layers + 1 };
        }
        return { ...state, events };
      }

      case "stop": {
        if (state.phase !== "recording") return state;
        const elapsed = clampElapsed(action.atMs - state.startedAt);
        // An overlay stop keeps layer 1's duration as the floor; a first
        // take's stop is exactly the old behavior (state.durationMs is 0).
        const durationMs = Math.max(state.durationMs, elapsed);
        if (!isDurationValid(durationMs)) return { ...state, phase: "tooShort", durationMs };
        return { ...state, phase: "recorded", durationMs, layers: state.layers + 1 };
      }

      case "playStart":
        if (state.phase !== "recorded") return state;
        return { ...state, isPlaying: true };

      case "playEnd":
        if (state.phase !== "recorded") return state;
        return { ...state, isPlaying: false };

      case "redo":
      case "cancel":
        return initialRecorderState();

      default:
        return state;
    }
  }

  function canSave(state) {
    return state.phase === "recorded" && isDurationValid(state.durationMs) && state.events.length > 0;
  }

  // ---- Stateful recorder/player ----------------------------------------------

  // options:
  //   engine: a KalimbaEngine instance, used both to hear notes live while
  //     recording (already handled by KalimbaController — this class does not
  //     re-pluck during recording) and to play a saved melody back.
  //   audioManager: for duck("ambient", ...)/restore("ambient", ...) around playback.
  //   hapticManager: optional — one short pulse per note during playback, kept
  //     in sync with the melody the same way live plucking already is.
  //   onNote: optional (tineIndex, velocity01) => void, fired once per note
  //     during playback only (live plucks already reach app.js through
  //     KalimbaController's own onPluck) — this is what lets Flow Mode's
  //     reactive light-pulse react to a *played-back* Echo, not just live
  //     playing. Purely additive/optional: omitting it changes nothing.
  //   now: optional () => ms, injectable for tests; defaults to Date.now.
  function EchoRecorder(options) {
    this.engine = options.engine;
    this.audioManager = options.audioManager;
    this.hapticManager = options.hapticManager || null;
    this.onNote = options.onNote || null;
    this.now = options.now || (() => Date.now());
    this.state = initialRecorderState();
    this._playbackTimers = [];
  }

  EchoRecorder.prototype._dispatch = function (action) {
    this.state = applyRecorderAction(this.state, action);
    return this.state;
  };

  EchoRecorder.prototype.startRecording = function () {
    this._cancelPlaybackTimers();
    return this._dispatch({ type: "recordStart", atMs: this.now() });
  };

  /**
   * Records a second layer on top of the already-recorded take: layer 1
   * plays back as an audible guide (same engine, so it sounds exactly like
   * the final merge will) while new plucks land on the shared t=0 timeline.
   * The guide playback and the overdub clock start in the same call so the
   * two layers stay aligned. Only valid with a completed take ("recorded").
   */
  EchoRecorder.prototype.startOverdub = function () {
    if (this.state.phase !== "recorded") return this.state;
    this._cancelPlaybackTimers();
    const guide = buildMelodyPayload(this.state.events, this.state.durationMs);
    const next = this._dispatch({ type: "overdubStart", atMs: this.now() });
    this.audioManager.duck("ambient", 0.3, 300);
    guide.melody.forEach((note) => {
      const id = setTimeout(() => {
        this.engine.pluck(note.tine, note.v);
        if (this.onNote) this.onNote(note.tine, note.v);
      }, note.t);
      this._playbackTimers.push(id);
    });
    return next;
  };

  /** Called by whatever wires KalimbaController.onPluck to this recorder while `state.phase === "recording"`. */
  EchoRecorder.prototype.registerPluck = function (tineIndex, velocity01) {
    return this._dispatch({ type: "pluck", tine: tineIndex, v: velocity01, atMs: this.now() });
  };

  EchoRecorder.prototype.stopRecording = function () {
    // Also tears down an overdub's guide playback: cancel any still-pending
    // guide notes and un-duck ambient. Both are no-ops for a plain first
    // take (no timers queued, restore on an un-ducked bus just re-ramps to 1).
    this._cancelPlaybackTimers();
    this.audioManager.restore("ambient", 400);
    return this._dispatch({ type: "stop", atMs: this.now() });
  };

  EchoRecorder.prototype.redo = function () {
    this._cancelPlaybackTimers();
    return this._dispatch({ type: "redo" });
  };

  EchoRecorder.prototype.cancel = function () {
    this._cancelPlaybackTimers();
    return this._dispatch({ type: "cancel" });
  };

  EchoRecorder.prototype.canSave = function () {
    return canSave(this.state);
  };

  /** @returns the exact payload echovalidation.js/the API expects, or null if the current recording isn't save-able yet. */
  EchoRecorder.prototype.buildSavePayload = function () {
    if (!this.canSave()) return null;
    return buildMelodyPayload(this.state.events, this.state.durationMs);
  };

  EchoRecorder.prototype._cancelPlaybackTimers = function () {
    this._playbackTimers.forEach((id) => clearTimeout(id));
    this._playbackTimers = [];
  };

  /**
   * Plays either the just-recorded melody (default) or an arbitrary saved
   * melody fetched from the API (discovery playback) — same code path either
   * way, since both are just {t,tine,v}[] arrays played through the same
   * engine. Ducks ambient for the duration + a release tail, then restores.
   * @param {{melody: Array<{t:number,tine:number,v:number}>, durationMs:number}} [melodyPayload]
   * @param {function} [onComplete]
   */
  EchoRecorder.prototype.play = function (melodyPayload, onComplete) {
    const payload = melodyPayload || this.buildSavePayload();
    if (!payload || !payload.melody.length) return;
    this._cancelPlaybackTimers();
    if (this.state.phase === "recorded") this._dispatch({ type: "playStart" });

    this.audioManager.duck("ambient", 0.3, 300);
    payload.melody.forEach((note) => {
      const id = setTimeout(() => {
        this.engine.pluck(note.tine, note.v);
        if (this.hapticManager) this.hapticManager.vibratePulse(12);
        if (this.onNote) this.onNote(note.tine, note.v);
      }, note.t);
      this._playbackTimers.push(id);
    });

    const totalMs = payload.durationMs + PLAYBACK_TAIL_MS;
    const endId = setTimeout(() => {
      this.audioManager.restore("ambient", 400);
      if (this.state.phase === "recorded") this._dispatch({ type: "playEnd" });
      if (onComplete) onComplete();
    }, totalMs);
    this._playbackTimers.push(endId);
  };

  EchoRecorder.prototype.stopPlayback = function () {
    this._cancelPlaybackTimers();
    this.audioManager.restore("ambient", 200);
    if (this.state.phase === "recorded") this._dispatch({ type: "playEnd" });
  };

  const api = {
    MIN_DURATION_MS, MAX_DURATION_MS, MAX_MESSAGE_CHARS, MAX_NICKNAME_CHARS, PLAYBACK_TAIL_MS,
    isDurationValid, clampElapsed, validateMessage, validateNickname,
    quantizeEvent, buildMelodyPayload,
    initialRecorderState, applyRecorderAction, canSave,
    EchoRecorder,
  };
  return api;
});

if (typeof window !== "undefined" && typeof window.EchoRecorderLib !== "undefined") {
  window.EchoRecorder = window.EchoRecorderLib.EchoRecorder;
}
