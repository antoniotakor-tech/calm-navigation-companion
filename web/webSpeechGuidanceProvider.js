// ---------------------------------------------------------------------------
// Web SpeechGuidanceProvider — wraps the EXISTING VoiceEngine instance. The
// nav-specific dedup/distance-banding logic (VoiceEngine.announce()) stays
// called directly from app.js exactly as before; this generic speak()/stop()
// surface is for anything that wants platform-agnostic speech without that
// nav-specific dedup behavior.
// ---------------------------------------------------------------------------
(function (root) {
  "use strict";

  function WebSpeechGuidanceProvider(voiceEngine) {
    this.voice = voiceEngine;
  }

  WebSpeechGuidanceProvider.prototype.speak = function (text, opts) {
    this.voice.speakGeneric(text, opts && opts.urgent);
    return Promise.resolve();
  };
  WebSpeechGuidanceProvider.prototype.stop = function () {
    if (this.voice.supported) window.speechSynthesis.cancel();
    return Promise.resolve();
  };
  WebSpeechGuidanceProvider.prototype.isSpeaking = function () {
    return this.voice.queue ? this.voice.queue.isSpeaking() : false;
  };

  if (typeof window !== "undefined") window.WebSpeechGuidanceProvider = WebSpeechGuidanceProvider;
})(typeof window !== "undefined" ? window : this);
