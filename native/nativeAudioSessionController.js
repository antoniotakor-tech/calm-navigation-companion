// ---------------------------------------------------------------------------
// Native AudioSessionController — during an active nav session, the audio
// session (AVAudioSession on iOS, AudioManager focus on Android) is
// configured and ducked entirely inside the native plugin, driven by its own
// TTS calls — not from here. This adapter exists for interface completeness
// and is effectively a no-op for the nav-session path; configure() is safe
// to call regardless (it just doesn't need to do anything additional).
// ---------------------------------------------------------------------------
(function (root) {
  "use strict";

  function NativeAudioSessionController() {
    this._interruptionCb = null;
  }

  NativeAudioSessionController.prototype.configure = function () {
    return Promise.resolve(); // configured natively as part of startNavigationSession
  };
  NativeAudioSessionController.prototype.duckForSpeech = function () {
    return Promise.resolve(); // native engine ducks its own ambient loop around its own TTS calls
  };
  NativeAudioSessionController.prototype.restoreAfterSpeech = function () {
    return Promise.resolve();
  };
  NativeAudioSessionController.prototype.stop = function () {
    return Promise.resolve(); // torn down by stopNavigationSession
  };
  NativeAudioSessionController.prototype.onInterruption = function (cb) {
    this._interruptionCb = cb;
    // Surfaced today via NativeBackgroundNavigationService's navEvent 'state'
    // events ("audio-interrupted") rather than a separate channel — app.js
    // listens there. This hook is kept for interface parity with the web
    // adapter and future direct wiring.
  };

  if (typeof window !== "undefined") window.NativeAudioSessionController = NativeAudioSessionController;
})(typeof window !== "undefined" ? window : this);
