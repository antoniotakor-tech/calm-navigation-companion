// Offline copies of the app's own instruments (studio.js drum VOICES and chord
// synth, kalimbaengine.js), so campaign videos use only sounds the app makes.
// Usage (in a page that also loads /kalimbaengine.js):
//   const buf = await AppSound.jazz(15)       // 15 s soft swung jazz loop
//   const buf = await AppSound.studioDemo(15) // drums -> + chords -> + kalimba (music-making video)
(function () {
  const SR = 48000;
  function makeNoise(c) {
    const b = c.createBuffer(1, c.sampleRate, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function env(A, t, peak, attack, decay) {
    const g = A.c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(A.out); return g;
  }
  function noise(A, t, dur, type, freq, q, peak, decay) {
    const src = A.c.createBufferSource(); src.buffer = A.nb;
    const f = A.c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    src.connect(f).connect(env(A, t, peak, 0.002, decay)); src.start(t, Math.random() * 0.5, dur);
  }
  // === studio.js VOICES (copied as-is) ===
  const VOICES = {
    kick(A, t) { const o = A.c.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14); o.connect(env(A, t, 1, 0.003, 0.38)); o.start(t); o.stop(t + 0.45); },
    snare(A, t) { noise(A, t, 0.2, "bandpass", 1800, 0.8, 0.55, 0.17); const o = A.c.createOscillator(); o.type = "triangle"; o.frequency.setValueAtTime(190, t); o.connect(env(A, t, 0.35, 0.002, 0.09)); o.start(t); o.stop(t + 0.12); },
    clap(A, t) { [0, 0.012, 0.026].forEach((d, i) => noise(A, t + d, 0.1, "bandpass", 1400, 1.2, i === 2 ? 0.6 : 0.35, i === 2 ? 0.14 : 0.02)); },
    hat(A, t) { noise(A, t, 0.06, "highpass", 7500, 0.7, 0.28, 0.045); },
    tom(A, t) { const o = A.c.createOscillator(); o.frequency.setValueAtTime(230, t); o.frequency.exponentialRampToValueAtTime(115, t + 0.2); o.connect(env(A, t, 0.7, 0.003, 0.28)); o.start(t); o.stop(t + 0.35); },
    shaker(A, t) { noise(A, t, 0.09, "bandpass", 5200, 1.5, 0.18, 0.06); },
  };
  // === studio.js chord synth (copied) ===
  const KEYS = { C: 0, G: 7, D: 2, F: 5, A: 9 };
  const DEG = { I: [0, "maj"], ii: [2, "min"], iii: [4, "min"], IV: [5, "maj"], V: [7, "maj"], vi: [9, "min"], IV7: [5, "maj7"], V7: [7, "dom7"] };
  const QUAL = { maj: [0, 4, 7], min: [0, 3, 7], maj7: [0, 4, 7, 11], dom7: [0, 4, 7, 10] };
  const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function chordBus(c, dest, volume) {
    const bus = c.createGain();
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 5200;
    const conv = c.createConvolver(); const len = Math.floor(c.sampleRate * 2.2), ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    conv.buffer = ir; const wet = c.createGain(); wet.gain.value = 0.28;
    bus.connect(lp); lp.connect(dest); lp.connect(conv).connect(wet).connect(dest); bus.gain.value = volume; return bus;
  }
  function chord(c, out, deg, t, dur, sound, key) {
    const [semis, q] = DEG[deg]; const root = 48 + KEYS[key || "C"] + semis;
    const notes = [root - 12, ...QUAL[q].map((i) => root + 12 + i - (root + 12 + i > 76 ? 12 : 0))];
    const S = sound || "keys";
    const atk = S === "pad" ? 0.03 : 0.004, peak = (S === "pad" ? 0.11 : 0.16) / Math.sqrt(notes.length);
    notes.forEach((m, k) => {
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak * (k === 0 ? 1.2 : 1), t + atk);
      if (S !== "pad") g.gain.exponentialRampToValueAtTime(peak * (S === "pluck" ? 0.05 : 0.35), t + (S === "pluck" ? 0.5 : 1.6));
      const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(S === "pluck" ? 3200 : S === "keys" ? 2600 : 1400, t);
      f.connect(g).connect(out);
      const r = t + dur, rel = S === "pad" ? 0.9 : S === "keys" ? 0.5 : 0.25;
      g.gain.setValueAtTime(peak * 0.3, r); g.gain.exponentialRampToValueAtTime(0.0001, r + rel);
      (S === "pad" ? ["sawtooth", "sawtooth"] : S === "keys" ? ["triangle", "sine"] : ["square"]).forEach((type, j) => {
        const o = c.createOscillator(); o.type = type; o.frequency.value = midiHz(m); o.detune.value = S === "pad" ? (j ? 9 : -9) : 0;
        o.connect(f); o.start(t); o.stop(r + rel + 0.05);
      });
    });
  }
  function setup(dur) {
    const off = new OfflineAudioContext(2, Math.ceil(SR * dur), SR);
    const comp = off.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3;
    const master = off.createGain(); master.connect(comp).connect(off.destination);
    master.gain.setValueAtTime(0, 0); master.gain.linearRampToValueAtTime(0.9, 0.5);
    master.gain.setValueAtTime(0.9, dur - 1.3); master.gain.linearRampToValueAtTime(0, dur - 0.05);
    const drumBus = off.createGain(); drumBus.connect(master);
    const A = { c: off, out: drumBus, nb: makeNoise(off) };
    const chBus = chordBus(off, master, 0.8);
    const kBus = off.createGain(); kBus.gain.value = 0.55; kBus.connect(master);
    let T = 0;
    const proxy = new Proxy(off, { get: (t, p) => (p === "currentTime" ? T : (typeof t[p] === "function" ? t[p].bind(t) : t[p])) });
    const kal = new KalimbaEngine({ ensureCtx() {}, ctx: proxy, getBus: () => kBus });
    const pluck = (time, tine, v) => { T = time; kal.pluck(tine, v); };
    return { off, A, chBus, drumBus, pluck };
  }
  async function normalise(buf) {
    let peak = 0; for (let c = 0; c < buf.numberOfChannels; c++) for (const x of buf.getChannelData(c)) peak = Math.max(peak, Math.abs(x));
    const g = peak > 0.89 ? 0.89 / peak : 1;
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= g; }
    return buf;
  }
  // Soft swung jazz, 92 bpm: keys comping Fmaj7 | Em | Dm | G7 | Fmaj7 | C, brushed swing on the drum machine's hat/snare, kalimba melody.
  async function jazz(dur) {
    const { off, A, chBus, drumBus, pluck } = setup(dur);
    drumBus.gain.value = 0.55;
    const beat = 60 / 92, swing = beat * 2 / 3, bar = beat * 4, t0 = 0.15;
    const prog = ["IV7", "iii", "ii", "V7", "IV7", "I"];
    prog.forEach((deg, b) => {
      const t = t0 + b * bar;
      if (t > dur - 1) return;
      chord(off, chBus, deg, t, beat * 1.4, "keys");                       // Charleston: beat 1 ...
      chord(off, chBus, deg, t + beat + swing, beat * 1.2, "keys");         // ... and the "and" of 2
      for (let q = 0; q < 4; q++) {
        const tb = t + q * beat;
        VOICES.hat(A, tb);                                                   // ride pattern: 1, 2 a, 3, 4 a
        if (q % 2 === 1) VOICES.hat(A, tb + swing);
        if (q % 2 === 1) VOICES.shaker(A, tb);                               // brush on 2 and 4
        if (q === 0 || q === 2) VOICES.kick(A, tb);
      }
    });
    // kalimba melody (C pentatonic tines), swung eighths, entering in bar 2
    const mel = [[1, 0, 8], [1, 1, 9], [1, 1 + 2 / 3, 10], [1, 2.5, 9], [1, 3, 7],
                 [2, 0, 8], [2, 1, 6], [2, 2, 7], [2, 2 + 2 / 3, 8], [2, 3.5, 5],
                 [3, 0, 9], [3, 1, 10], [3, 2, 11], [3, 3, 9],
                 [4, 0, 8], [4, 1.5, 7], [4, 2.5, 6], [4, 3, 4]];
    mel.forEach(([b, q, tine]) => { const t = t0 + b * bar + q * beat; if (t < dur - 1.2) pluck(t, tine, 0.5); });
    return normalise(await off.startRendering());
  }
  // Music-making video: 0-4 s drums alone, 4-8.5 s + chords, 8.5-12.5 s + kalimba, end card ring-out.
  async function studioDemo(dur) {
    const { off, A, chBus, drumBus, pluck } = setup(dur);
    drumBus.gain.value = 0.8;
    const bpm = 84, step = 60 / bpm / 4, t0 = 0.1;
    const kick = "x.......x.x.....", snare = "....x.......x...", hat = "x.x.x.x.x.x.x.x.", shaker = "..x...x...x...x.";
    const steps = Math.floor((12.6 - t0) / step);
    for (let s = 0; s < steps; s++) {
      const t = t0 + s * step, i = s % 16;
      if (kick[i] === "x") VOICES.kick(A, t); if (snare[i] === "x") VOICES.snare(A, t);
      if (hat[i] === "x") VOICES.hat(A, t); if (shaker[i] === "x") VOICES.shaker(A, t);
    }
    const bar = step * 16, prog = ["IV7", "V7", "iii", "vi"];
    for (let b = 0; b * bar + 4 < 12.6; b++) { const t = 4 + b * bar; chord(off, chBus, prog[b % 4], t, bar * 0.9, "keys"); }
    const mel = [8, 9, 10, 9, 7, 8, 6, 7, 8, 10, 11, 9];
    mel.forEach((tine, k) => { const t = 8.5 + k * step * 2; if (t < 12.5) pluck(t, tine, 0.55); });
    pluck(12.9, 7, 0.6); pluck(13.3, 9, 0.6); pluck(13.7, 11, 0.55);
    return normalise(await off.startRendering());
  }
  window.AppSound = { jazz, studioDemo, SR };
})();
