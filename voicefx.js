// ---------------------------------------------------------------------------
// voicefx.js (2026-10-12) — voice effects for the Studio, so people who
// "can't sing" still sound good: compression + EQ + reverb + doubling hide
// shaky pitch and timing the way a real studio does. All Web Audio; works in
// a live AudioContext (playback) and an OfflineAudioContext (export).
// Also: a tiny WAV encoder so a finished song (voice + effect + beat) can be
// shared as one file.
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.VoiceFx = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const EFFECTS = [
    { id: "natural", label: "Natural" },
    { id: "studio", label: "Studio" },
    { id: "choir", label: "Choir" },
    { id: "hall", label: "Big hall" },
    { id: "echo", label: "Echo" },
    { id: "robot", label: "Robot" },
    { id: "chipmunk", label: "Chipmunk" },
    { id: "deep", label: "Deep" },
  ];
  /** Playback speed per effect (pitch shift the simple way; changes length too). */
  function rateFor(id) { return id === "chipmunk" ? 1.45 : id === "deep" ? 0.78 : 1; }
  /** Whether the effect keeps the voice in time with the beat. */
  function keepsTime(id) { return rateFor(id) === 1; }

  function impulse(ctx, seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  function reverb(ctx, seconds, decay, wet) {
    const input = ctx.createGain(), out = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = impulse(ctx, seconds, decay);
    const dry = ctx.createGain(), w = ctx.createGain();
    dry.gain.value = 1; w.gain.value = wet;
    input.connect(dry).connect(out);
    input.connect(conv).connect(w).connect(out);
    return { input, out };
  }
  /** Studio polish: low-cut, presence lift, gentle compression. */
  function polish(ctx) {
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 110;
    const pres = ctx.createBiquadFilter(); pres.type = "peaking"; pres.frequency.value = 3200; pres.gain.value = 4; pres.Q.value = 0.8;
    const air = ctx.createBiquadFilter(); air.type = "highshelf"; air.frequency.value = 9000; air.gain.value = 3;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -24; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2; comp.knee.value = 10;
    const makeup = ctx.createGain(); makeup.gain.value = 1.6;
    hp.connect(pres).connect(air).connect(comp).connect(makeup);
    return { input: hp, out: makeup };
  }
  /** Doubling/chorus: two slightly delayed, slowly wobbling copies left and right. */
  function doubler(ctx, depth, voices) {
    const input = ctx.createGain(), out = ctx.createGain();
    input.connect(out);
    for (let i = 0; i < voices; i++) {
      const d = ctx.createDelay(0.1);
      d.delayTime.value = 0.018 + i * 0.011;
      const lfo = ctx.createOscillator(), amt = ctx.createGain();
      lfo.frequency.value = 0.6 + i * 0.37;
      amt.gain.value = depth;
      lfo.connect(amt).connect(d.delayTime);
      lfo.start();
      const g = ctx.createGain(); g.gain.value = 0.55;
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      input.connect(d).connect(g);
      if (pan) { pan.pan.value = i % 2 ? 0.7 : -0.7; g.connect(pan).connect(out); } else g.connect(out);
    }
    return { input, out };
  }

  /**
   * Builds the effect chain for `id` between `source` and `destination`.
   * beatSeconds: one beat at the song's tempo (echo repeats on the beat).
   */
  function connect(ctx, source, destination, id, beatSeconds) {
    const chain = (...nodes) => { let prev = source; nodes.forEach((n) => { prev.connect(n.input || n); prev = n.out || n; }); prev.connect(destination); };
    switch (id) {
      case "studio": return chain(polish(ctx), reverb(ctx, 1.4, 3, 0.18));
      case "choir": return chain(polish(ctx), doubler(ctx, 0.004, 3), reverb(ctx, 2.2, 2.6, 0.32));
      case "hall": return chain(polish(ctx), reverb(ctx, 3.8, 2.2, 0.55));
      case "echo": {
        const p = polish(ctx);
        const delay = ctx.createDelay(2); delay.delayTime.value = Math.min(1.5, beatSeconds || 0.5);
        const fb = ctx.createGain(); fb.gain.value = 0.38;
        const tone = ctx.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 3500;
        const mix = ctx.createGain();
        source.connect(p.input);
        p.out.connect(mix);
        p.out.connect(delay); delay.connect(tone).connect(fb).connect(delay); tone.connect(mix);
        mix.connect(destination);
        return;
      }
      case "robot": {
        const p = polish(ctx);
        const ring = ctx.createGain(); ring.gain.value = 0;
        const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.value = 55; osc.connect(ring.gain); osc.start();
        const dry = ctx.createGain(); dry.gain.value = 0.25;
        source.connect(p.input); p.out.connect(ring); p.out.connect(dry);
        const out = ctx.createGain(); out.gain.value = 1.4;
        ring.connect(out); dry.connect(out); out.connect(destination);
        return;
      }
      case "chipmunk":
      case "deep": return chain(polish(ctx), reverb(ctx, 1.2, 3, 0.15));
      default: return chain(polish(ctx));
    }
  }

  /** 16-bit PCM WAV from an AudioBuffer (what OfflineAudioContext renders). */
  function encodeWav(buffer) {
    const ch = Math.min(2, buffer.numberOfChannels), len = buffer.length, rate = buffer.sampleRate;
    const bytes = 44 + len * ch * 2;
    const v = new DataView(new ArrayBuffer(bytes));
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, "RIFF"); v.setUint32(4, bytes - 8, true); str(8, "WAVE"); str(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, len * ch * 2, true);
    const data = []; for (let c = 0; c < ch; c++) data.push(buffer.getChannelData(c));
    let o = 44;
    for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
    }
    return v.buffer;
  }

  return { EFFECTS, rateFor, keepsTime, connect, encodeWav };
});
