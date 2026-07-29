// ---------------------------------------------------------------------------
// VoiceQueue — sequences spoken announcements so they never talk over each
// other. FIFO by default; an "urgent" item (off-route, arrival) clears
// whatever's queued behind the current utterance and jumps in next, but
// still waits politely for whatever is *currently* being spoken to finish —
// "never interrupt itself" per spec.
//
// The actual speaking mechanism is injected (`speakFn`), so this file has no
// SpeechSynthesis dependency and is unit-testable in Node with a fake
// speakFn that resolves on a timer.
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.VoiceQueue = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function VoiceQueue(speakFn, hooks) {
    this.speakFn = speakFn;             // (text) => Promise<void>, resolves when done speaking
    this.hooks = hooks || {};           // { onSpeakStart(text), onSpeakEnd(text) }
    this.queue = [];
    this.speaking = false;
  }

  VoiceQueue.prototype.enqueue = function (text, opts) {
    opts = opts || {};
    if (opts.urgent) {
      this.queue = [{ text, urgent: true }];
    } else {
      this.queue.push({ text, urgent: false });
    }
    this._pump();
  };

  VoiceQueue.prototype.clear = function () {
    this.queue = [];
  };

  VoiceQueue.prototype.isSpeaking = function () {
    return this.speaking;
  };

  VoiceQueue.prototype._pump = function () {
    if (this.speaking || this.queue.length === 0) return;
    const item = this.queue.shift();
    this.speaking = true;
    if (this.hooks.onSpeakStart) this.hooks.onSpeakStart(item.text);
    const done = () => {
      this.speaking = false;
      if (this.hooks.onSpeakEnd) this.hooks.onSpeakEnd(item.text);
      this._pump();
    };
    try {
      const result = this.speakFn(item.text);
      if (result && typeof result.then === "function") result.then(done, done);
      else done();
    } catch (e) {
      done();
    }
  };

  return VoiceQueue;
});
