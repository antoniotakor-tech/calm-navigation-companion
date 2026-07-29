// ---------------------------------------------------------------------------
// Web AudioSessionController — thin wrapper around the EXISTING AudioManager
// instance app.js already creates (one shared AudioContext + 3 buses). Does
// not create a second AudioContext or duplicate any ducking logic —
// voiceengine.js already ducks/restores the ambient bus around each
// utterance directly against the same AudioManager instance. This adapter
// exists so app.js can call the same AudioSessionController interface
// regardless of platform; on web it just forwards to what already worked.
// ---------------------------------------------------------------------------
(function (root) {
  "use strict";

  function WebAudioSessionController(audioManager) {
    this.am = audioManager;
    this._interruptionCb = null;
  }

  WebAudioSessionController.prototype.configure = function (options) {
    this.am.ensureCtx();
    this._bindInterruptionEvents();
    return Promise.resolve();
  };

  WebAudioSessionController.prototype._bindInterruptionEvents = function () {
    if (this._bound || !this.am.ctx) return;
    this._bound = true;
    // The closest the web platform gets to "an interruption began/ended":
    // AudioContext reliably suspends on a phone call / Siri / other-app-audio
    // interruption on mobile Safari/Chrome, and resumes (or needs a resume())
    // once that clears. Same signal AudioManager's own visibilitychange
    // handler already reacts to — this just also notifies any listener.
    this.am.ctx.addEventListener &&
      this.am.ctx.addEventListener("statechange", () => {
        if (!this._interruptionCb) return;
        if (this.am.ctx.state === "suspended") this._interruptionCb({ type: "began", reason: "context-suspended" });
        else if (this.am.ctx.state === "running") this._interruptionCb({ type: "ended", reason: "context-resumed" });
      });
  };

  WebAudioSessionController.prototype.duckForSpeech = function () {
    this.am.duck("ambient", 0.35, 250);
    return Promise.resolve();
  };
  WebAudioSessionController.prototype.restoreAfterSpeech = function () {
    this.am.restore("ambient", 500);
    return Promise.resolve();
  };
  WebAudioSessionController.prototype.stop = function () {
    this.am.setBusMuted("ambient", true);
    this.am.setBusMuted("voice", true);
    return Promise.resolve();
  };
  WebAudioSessionController.prototype.onInterruption = function (cb) {
    this._interruptionCb = cb;
  };

  if (typeof window !== "undefined") window.WebAudioSessionController = WebAudioSessionController;
})(typeof window !== "undefined" ? window : this);
