// ---------------------------------------------------------------------------
// VoiceEngine — turn-by-turn speech, on top of VoiceQueue + AudioManager.
// Replaces the earlier voice.js: same public surface (setMuted, reset,
// announce, announceArrival, announceRecalculating) so the nav engine in
// app.js didn't need to change, but now: never overlaps itself (VoiceQueue),
// ducks the ambient bed while speaking and restores it after (AudioManager),
// and always emits captions regardless of mute state — "never rely on sound
// alone" per the accessibility requirement.
// ---------------------------------------------------------------------------
(function () {
  "use strict";

  function VoiceEngine(audioManager) {
    this.am = audioManager;
    this.muted = true;
    this.captionsEnabled = true;
    this.supported = typeof window !== "undefined" && "speechSynthesis" in window;
    this.spoken = new Set(); // "<stepIdx>:<band>" already announced this leg
    this.onCaption = null;   // (text|null) => void — null clears the caption line
    this._captionTimer = null;

    this.queue = (typeof VoiceQueue !== "undefined")
      ? new VoiceQueue((text) => this._speakOnce(text), {
        // Only duck when something is actually about to be audible — a muted
        // "announcement" is caption-only, and dipping the ambient bed for a
        // sound that never plays would just read as a random glitch. Duck
        // speed/depth is mode-aware (see audioregulation.js): faster/deeper
        // in Concentrate, softer/slower in Relax, both slower again at night.
        onSpeakStart: () => {
          if (this.muted) return;
          const d = this._duckParams();
          this.am.duck("ambient", d.mult, d.downMs);
        },
        onSpeakEnd: () => {
          if (this.muted) return;
          const d = this._duckParams();
          this.am.restore("ambient", d.restoreMs);
        },
      })
      : null;
  }

  VoiceEngine.prototype.setMuted = function (muted) {
    this.muted = muted;
    if (muted && this.supported) window.speechSynthesis.cancel();
  };
  VoiceEngine.prototype.setCaptionsEnabled = function (on) { this.captionsEnabled = on; };
  VoiceEngine.prototype.reset = function () { this.spoken.clear(); };

  VoiceEngine.prototype._duckParams = function () {
    if (typeof AuditoryRegulation === "undefined") return { mult: 0.35, downMs: 250, restoreMs: 500 };
    const p = AuditoryRegulation.computeDuckParams(this.am.regulationMode, this.am.nightMode);
    return { mult: p.mult, downMs: p.downMs, restoreMs: p.restoreMs };
  };

  VoiceEngine.prototype._showCaption = function (text) {
    if (!this.captionsEnabled || !this.onCaption) return;
    clearTimeout(this._captionTimer);
    this.onCaption(text);
    // Roughly matches spoken duration (avg ~2.5 words/sec) plus a beat, then clears.
    const ms = Math.max(1600, text.split(/\s+/).length * 420);
    this._captionTimer = setTimeout(() => this.onCaption && this.onCaption(null), ms);
  };

  VoiceEngine.prototype._speakOnce = function (text) {
    // Captions run independent of mute — audio may be off, captions stay on.
    this._showCaption(text);
    if (!this.supported || this.muted) return Promise.resolve();
    this.am.ensureCtx();
    // Soften background sound and instruments while a direction is spoken,
    // then bring them back (2026-10-13: designed earlier, never wired up —
    // the voice used to talk over full-volume rain/music).
    const am = this.am;
    const dip = () => { try { am.duck("ambient", 0.35, 250); am.duck("instrument", 0.5, 250); } catch (e) { /* no audio yet */ } };
    const back = () => { try { am.restore("ambient", 600); am.restore("instrument", 600); } catch (e) { /* ok */ } };
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = (typeof AuditoryRegulation !== "undefined") ? AuditoryRegulation.computeSpeechRate(this.am.regulationMode) : 1.0;
      let done = false;
      const finish = () => { if (done) return; done = true; back(); resolve(); };
      u.onend = finish;
      u.onerror = finish;
      // Safety net: some engines never fire onend — never leave sound dipped.
      setTimeout(finish, Math.max(4000, text.split(/\s+/).length * 600));
      dip();
      window.speechSynthesis.speak(u);
    });
  };

  VoiceEngine.prototype._enqueue = function (text, urgent) {
    if (this.queue) this.queue.enqueue(text, { urgent });
    else this._speakOnce(text); // no VoiceQueue loaded — degrade to direct speech, still captioned
  };

  VoiceEngine.prototype._once = function (key, fn) {
    if (this.spoken.has(key)) return;
    this.spoken.add(key);
    fn();
  };

  VoiceEngine.prototype.announce = function (stepIdx, distToNextManeuver, instructionText, justAdvanced) {
    if (!instructionText) return;
    const THRESH = (typeof NavLogic !== "undefined" && NavLogic.THRESHOLDS) || { VOICE_NEAR_M: 30, VOICE_FAR_M: 220 };
    if (justAdvanced) {
      this._once(stepIdx + ":onstep", () => this._enqueue(instructionText, false));
      return;
    }
    if (distToNextManeuver <= THRESH.VOICE_NEAR_M) {
      this._once(stepIdx + ":near", () => this._enqueue(instructionText, false));
    } else if (distToNextManeuver <= THRESH.VOICE_FAR_M) {
      // "Fewer spoken interruptions" in Relax mode: skip the early
      // pre-announcement and only speak once genuinely near the turn.
      const skipFar = typeof AuditoryRegulation !== "undefined" && AuditoryRegulation.shouldSkipFarAnnouncement(this.am.regulationMode);
      if (skipFar) return;
      const rounded = Math.round(distToNextManeuver / 10) * 10;
      this._once(stepIdx + ":far", () => this._enqueue(`In ${rounded} meters, ${instructionText.toLowerCase()}`, false));
    }
  };

  // Generic one-off speech, outside the step-dedup logic `announce()` uses —
  // added for web/webSpeechGuidanceProvider.js's SpeechGuidanceProvider
  // adapter. Reuses the same queue/ducking/caption pipeline as everything
  // else here rather than talking to speechSynthesis directly.
  VoiceEngine.prototype.speakGeneric = function (text, urgent) {
    if (!text) return;
    this._enqueue(text, !!urgent);
  };

  VoiceEngine.prototype.announceArrival = function () {
    this._once("arrived", () => this._enqueue("You have arrived at your destination.", true));
  };
  VoiceEngine.prototype.announceRecalculating = function () {
    this._once("recalculating", () => this._enqueue("Recalculating your route.", true));
  };

  if (typeof window !== "undefined") window.VoiceEngine = VoiceEngine;
})();
