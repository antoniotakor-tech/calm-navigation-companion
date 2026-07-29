// ---------------------------------------------------------------------------
// Native SpeechGuidanceProvider — for generic, FOREGROUND-only speech needs
// outside the active nav loop (which speaks entirely through native
// AVSpeechSynthesizer/TextToSpeech inside the plugin, per
// IOS_/ANDROID_BACKGROUND_NAVIGATION.md — never through this file). The Web
// Speech API works fine in the foreground on a Capacitor WebView (it is only
// unreliable once backgrounded), so this deliberately reuses it rather than
// adding a redundant "speak arbitrary text" native plugin method for a need
// that already has a working foreground solution.
// ---------------------------------------------------------------------------
(function (root) {
  "use strict";

  function NativeSpeechGuidanceProvider() {
    this.supported = typeof window !== "undefined" && "speechSynthesis" in window;
  }

  NativeSpeechGuidanceProvider.prototype.speak = function (text, opts) {
    if (!this.supported || !text) return Promise.resolve();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    });
  };
  NativeSpeechGuidanceProvider.prototype.stop = function () {
    if (this.supported) window.speechSynthesis.cancel();
    return Promise.resolve();
  };
  NativeSpeechGuidanceProvider.prototype.isSpeaking = function () {
    return this.supported && window.speechSynthesis.speaking;
  };

  if (typeof window !== "undefined") window.NativeSpeechGuidanceProvider = NativeSpeechGuidanceProvider;
})(typeof window !== "undefined" ? window : this);
