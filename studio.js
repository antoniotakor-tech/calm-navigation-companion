// ---------------------------------------------------------------------------
// Studio (2026-10-12): Drums + Voice next to the Kalimba, so people can make
// real music — a beat, a melody on top, and their own voice.
//
// Drums: every sound is synthesised with Web Audio (no samples to download),
// scheduled with a look-ahead clock so timing stays tight even when the page
// is busy. The loop keeps playing when you switch to Kalimba, so you can jam.
// Voice: MediaRecorder from the microphone. Takes are kept on this device
// (IndexedDB) and can be played over the beat, shared or saved as a file.
// Nothing is uploaded.
// ---------------------------------------------------------------------------
(function () {
  "use strict";
  const D = window.DrumMachine;
  const $ = (id) => document.getElementById(id);
  const PATTERN_KEY = "calmStudio.pattern.v1";
  if (!D || !$("studioTabs")) return;

  // ---- audio ----------------------------------------------------------------
  let ctx = null, master = null, noiseBuf = null;
  function audio() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 3;
      master = ctx.createGain();
      master.gain.value = pattern.volume;
      master.connect(comp).connect(ctx.destination);
      noiseBuf = makeNoise(ctx);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  // Drum voices render into any target { c: context, out: node, nb: noise buffer },
  // so the same sounds play live AND get mixed into an exported song.
  function makeNoise(c) {
    const b = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function env(A, t, peak, attack, decay) {
    const g = A.c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(A.out);
    return g;
  }
  function noise(A, t, dur, type, freq, q, peak, decay) {
    const src = A.c.createBufferSource();
    src.buffer = A.nb;
    const f = A.c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    src.connect(f).connect(env(A, t, peak, 0.002, decay));
    src.start(t, Math.random() * 0.5, dur);
  }
  const VOICES = {
    kick(A, t) {
      const o = A.c.createOscillator();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
      o.connect(env(A, t, 1, 0.003, 0.38));
      o.start(t); o.stop(t + 0.45);
    },
    snare(A, t) {
      noise(A, t, 0.2, "bandpass", 1800, 0.8, 0.55, 0.17);
      const o = A.c.createOscillator();
      o.type = "triangle"; o.frequency.setValueAtTime(190, t);
      o.connect(env(A, t, 0.35, 0.002, 0.09)); o.start(t); o.stop(t + 0.12);
    },
    clap(A, t) { [0, 0.012, 0.026].forEach((d, i) => noise(A, t + d, 0.1, "bandpass", 1400, 1.2, i === 2 ? 0.6 : 0.35, i === 2 ? 0.14 : 0.02)); },
    hat(A, t) { noise(A, t, 0.06, "highpass", 7500, 0.7, 0.28, 0.045); },
    tom(A, t) {
      const o = A.c.createOscillator();
      o.frequency.setValueAtTime(230, t);
      o.frequency.exponentialRampToValueAtTime(115, t + 0.2);
      o.connect(env(A, t, 0.7, 0.003, 0.28)); o.start(t); o.stop(t + 0.35);
    },
    shaker(A, t) { noise(A, t, 0.09, "bandpass", 5200, 1.5, 0.18, 0.06); },
  };
  const live = () => ({ c: ctx, out: master, nb: noiseBuf });
  function hit(track, t) { audio(); VOICES[track](live(), (t != null ? t : ctx.currentTime) + 0.001); }

  // ---- sequencer (look-ahead scheduler) ------------------------------------------
  let pattern = D.deserialize(localStorage.getItem(PATTERN_KEY) || "") || D.fromPreset("calm");
  let playing = false, nextTime = 0, step = 0, loopStep = 0, timer = null;
  const queue = []; // [{ step, time }] for the playhead
  function save() { try { localStorage.setItem(PATTERN_KEY, D.serialize(pattern)); } catch (e) { /* storage off */ } }

  function schedule() {
    while (nextTime < ctx.currentTime + 0.12) {
      const stepSec = D.stepSeconds(pattern.bpm);
      if (loopStep === 0) loopAtTop(nextTime);
      if (loop.beatOn) D.hitsAt(pattern, step).forEach((tr) => VOICES[tr](live(), nextTime));
      if (latched && step % 4 === 0) {
        startChord(latched.d, nextTime, stepSec * 3.2);
        captureChord(DEGREES.indexOf(latched.d), nextTime, stepSec * 3.2);
      }
      playLoopStep(loopStep, nextTime, stepSec);
      queue.push({ step, time: nextTime });
      nextTime += stepSec;
      loopStep = (loopStep + 1) % LL.LOOP_STEPS;
      step = loopStep % D.STEPS;
    }
  }
  function startDrums() {
    if (playing) return;
    audio();
    playing = true; step = 0; loopStep = 0; nextTime = ctx.currentTime + 0.06;
    schedule();
    timer = setInterval(schedule, 25);
    requestAnimationFrame(drawPlayhead);
    renderTransport();
    document.body.classList.add("studio-playing");
  }
  function stopDrums() {
    playing = false;
    if (loop.rec || loop.armed) loopMsg(loop.rec ? "Recording stopped before the loop finished, so nothing was added." : "Recording cancelled.");
    loop.rec = null; loop.armed = false; renderLoop();
    latched = null;
    document.querySelectorAll(".ch-pad.latched").forEach((x) => x.classList.remove("latched"));
    clearInterval(timer);
    queue.length = 0;
    document.querySelectorAll(".dm-step.now").forEach((el) => el.classList.remove("now"));
    renderTransport();
    document.body.classList.remove("studio-playing");
  }
  let shown = -1;
  function drawPlayhead() {
    if (!playing) return;
    while (queue.length && queue[0].time <= ctx.currentTime) { shown = queue.shift().step; }
    document.querySelectorAll(".dm-step").forEach((el) => el.classList.toggle("now", Number(el.dataset.step) === shown));
    requestAnimationFrame(drawPlayhead);
  }

  // ---- drums UI -------------------------------------------------------------------
  function buildGrid() {
    const grid = $("dmGrid");
    grid.innerHTML = "";
    D.TRACKS.forEach((t) => {
      const rowEl = document.createElement("div");
      rowEl.className = "dm-row";
      const name = document.createElement("button");
      name.type = "button";
      name.className = "dm-name";
      name.textContent = t.label;
      name.style.setProperty("--pad", t.color);
      name.setAttribute("aria-label", `Play ${t.label}`);
      name.addEventListener("pointerdown", () => { hit(t.id); name.classList.remove("bump"); void name.offsetWidth; name.classList.add("bump"); });
      rowEl.appendChild(name);
      const steps = document.createElement("div");
      steps.className = "dm-steps";
      for (let i = 0; i < D.STEPS; i++) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "dm-step" + (i % 4 === 0 ? " beat" : "");
        b.dataset.step = i;
        b.style.setProperty("--pad", t.color);
        b.setAttribute("aria-label", `${t.label}, step ${i + 1}`);
        const sync = () => { const on = pattern.rows[t.id][i]; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); };
        b.addEventListener("click", () => {
          pattern = D.toggle(pattern, t.id, i);
          sync(); save();
          if (pattern.rows[t.id][i] && !playing) hit(t.id);
        });
        sync();
        steps.appendChild(b);
      }
      rowEl.appendChild(steps);
      grid.appendChild(rowEl);
    });
  }
  function renderTransport() {
    if ($("loopPlay")) { $("loopPlay").textContent = playing ? "Stop" : "Play loop"; $("loopPlay").classList.toggle("active", playing); }
    if ($("loopInfo")) $("loopInfo").textContent = `2 bars · ${pattern.bpm} BPM`;
    $("dmPlay").textContent = playing ? "Stop" : "Play";
    $("dmPlay").classList.toggle("active", playing);
    $("dmBpm").value = pattern.bpm;
    $("dmBpmLabel").textContent = pattern.bpm + " BPM";
    $("dmVol").value = Math.round(pattern.volume * 100);
  }
  function loadPreset(name) {
    pattern = { ...D.fromPreset(name), volume: pattern.volume };
    save(); buildGrid(); renderTransport();
  }

  // ---- voice ----------------------------------------------------------------------
  const DB_NAME = "calmStudio", STORE = "takes";
  function db() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function dbAll() { const d = await db(); return new Promise((res) => { const q = d.transaction(STORE).objectStore(STORE).getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); }); }
  async function dbPut(take) { const d = await db(); return new Promise((res) => { const tx = d.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(take); tx.oncomplete = res; tx.onerror = res; }); }
  async function dbDel(id) { const d = await db(); return new Promise((res) => { const tx = d.transaction(STORE, "readwrite"); tx.objectStore(STORE).delete(id); tx.oncomplete = res; tx.onerror = res; }); }

  let recorder = null, chunks = [], recStart = 0, recTimer = null, stream = null, withBeat = false;
  async function startRecording() {
    $("vcMsg").textContent = "";
    if (!navigator.mediaDevices || !window.MediaRecorder) { $("vcMsg").textContent = "This browser can't record audio. Try Safari on iPhone or Chrome."; return; }
    try {
      // Echo cancellation stays ON so, without headphones, the phone removes
      // the beat coming out of its own speaker from the voice recording.
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      $("vcMsg").textContent = "Allow the microphone for this app to record your voice.";
      return;
    }
    const type = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = finishRecording;
    withBeat = $("vcWithBeat").checked;
    if (withBeat) {
      // No headphones: play the guide beat quietly so it barely reaches the mic.
      // The finished song always uses the clean, full-volume beat.
      if (master && !$("vcHeadphones").checked) master.gain.value = pattern.volume * 0.3;
      stopDrums(); startDrums();
    }
    recorder.start();
    recStart = Date.now();
    $("vcRec").classList.add("recording");
    $("vcRec").textContent = "Stop recording";
    recTimer = setInterval(() => { $("vcTime").textContent = fmt(Date.now() - recStart); }, 200);
  }
  function stopRecording() { if (recorder && recorder.state !== "inactive") recorder.stop(); }
  async function finishRecording() {
    clearInterval(recTimer);
    stream.getTracks().forEach((t) => t.stop());
    if (window.CalmAudioMix) setTimeout(() => CalmAudioMix.apply(), 300); // mic off: back to mixing with your music
    if (withBeat) { stopDrums(); if (master) master.gain.value = pattern.volume; }
    $("vcRec").classList.remove("recording");
    $("vcRec").textContent = "Record";
    $("vcTime").textContent = "";
    const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
    const take = { fx: "studio", id: String(Date.now()), name: `Take ${new Date().toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`, blob, ms: Date.now() - recStart, withBeat, pattern: withBeat ? D.serialize(pattern) : null };
    await dbPut(take);
    renderTakes();
  }
  const fmt = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

  // ---- playback + export with voice effects -------------------------------------
  const decoded = new Map(); // take id -> AudioBuffer
  async function decode(take) {
    if (decoded.has(take.id)) return decoded.get(take.id);
    audio();
    const buf = await ctx.decodeAudioData(await take.blob.arrayBuffer());
    decoded.set(take.id, buf);
    return buf;
  }
  let playingTake = null; // { id, src, btn }
  function stopTake() {
    if (!playingTake) return;
    try { playingTake.src.stop(); } catch (e) { /* already ended */ }
    playingTake.btn.textContent = "Play";
    playingTake = null;
    stopDrums();
  }
  async function playTake(take, btn) {
    const same = playingTake && playingTake.id === take.id;
    stopTake();
    if (same) return;
    let buf;
    try { buf = await decode(take); } catch (e) { $("vcMsg").textContent = "This recording can't be played on this device."; return; }
    const fx = take.fx || "studio";
    const takePattern = take.withBeat && take.pattern ? D.deserialize(take.pattern) : null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = VoiceFx.rateFor(fx);
    const voiceGain = ctx.createGain(); voiceGain.gain.value = 1;
    VoiceFx.connect(ctx, src, voiceGain, fx, takePattern ? D.stepSeconds(takePattern.bpm) * 4 : 0.5);
    voiceGain.connect(ctx.destination);
    if (takePattern && VoiceFx.keepsTime(fx)) { pattern = { ...takePattern, volume: pattern.volume }; buildGrid(); renderTransport(); stopDrums(); startDrums(); }
    src.start();
    btn.textContent = "Stop";
    playingTake = { id: take.id, src, btn };
    src.onended = () => { if (playingTake && playingTake.src === src) stopTake(); };
  }

  // Songs shared on profiles: same playback, audio fetched from the server.
  const remoteBlobs = new Map();
  async function playRemote(track, btn) {
    const base = (window.CalmApp && CalmApp.apiBaseUrl) || "";
    let blob = remoteBlobs.get(track.id);
    if (!blob) {
      btn.textContent = "Loading…";
      try { blob = await (await fetch(`${base}/api/social/tracks/${encodeURIComponent(track.id)}/audio`)).blob(); }
      catch (e) { btn.textContent = "Play"; return; }
      remoteBlobs.set(track.id, blob);
    }
    return playTake({ id: "r:" + track.id, blob, fx: track.fx, pattern: track.pattern, withBeat: !!track.pattern }, btn);
  }
  window.CalmStudio = { playRemote, stop: () => stopTake() };

  function blobToDataUrl(blob) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  }
  async function publishTake(take, title, msgEl) {
    const S = window.SocialValidation;
    let audioUrl = await blobToDataUrl(take.blob);
    audioUrl = audioUrl.replace(/^data:audio\/([^;,]+)(;[^,]*)?;base64,/, (m0, t) => `data:audio/${t};base64,`);
    const track = { title, audio: audioUrl, ms: take.ms, fx: take.fx || "studio", pattern: take.withBeat ? take.pattern : null };
    const check = S.validateTrack(track);
    if (!check.valid) { msgEl.textContent = check.error; return false; }
    const body = { token: CalmApp.deviceToken(), track: check.value };
    const session = window.CalmAccount && CalmAccount.session();
    if (session) body.session = session;
    const res = await fetch(`${CalmApp.apiBaseUrl}/api/social/tracks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { msgEl.textContent = data.error || "Couldn't share — try again."; return false; }
    window.dispatchEvent(new CustomEvent("calmstudio:published", { detail: data.track }));
    return true;
  }

  /** Renders voice + effect (+ the beat it was recorded over) into one WAV file. */
  async function renderSong(take) {
    const buf = await decode(take);
    const fx = take.fx || "studio";
    const rate = VoiceFx.rateFor(fx);
    const tail = fx === "hall" ? 3.5 : fx === "echo" ? 2.5 : 1.5;
    const seconds = buf.duration / rate + tail;
    const off = new OfflineAudioContext(2, Math.ceil(seconds * 44100), 44100);
    const mixBus = off.createGain(); mixBus.connect(off.destination);
    const src = off.createBufferSource();
    src.buffer = buf; src.playbackRate.value = rate;
    const p = take.withBeat && take.pattern ? D.deserialize(take.pattern) : null;
    VoiceFx.connect(off, src, mixBus, fx, p ? D.stepSeconds(p.bpm) * 4 : 0.5);
    src.start(0);
    if (p && VoiceFx.keepsTime(fx)) {
      const drumBus = off.createGain(); drumBus.gain.value = (p.volume || 0.8) * 0.8; drumBus.connect(mixBus);
      const A = { c: off, out: drumBus, nb: makeNoise(off) };
      const stepLen = D.stepSeconds(p.bpm);
      for (let k = 0, t = 0.06; t < buf.duration; k++, t += stepLen) D.hitsAt(p, k).forEach((tr) => VOICES[tr](A, t));
    }
    const rendered = await off.startRendering();
    return new Blob([VoiceFx.encodeWav(rendered)], { type: "audio/wav" });
  }

  async function shareTake(take, btn) {
    const label = btn.textContent;
    btn.textContent = "Mixing…"; btn.disabled = true;
    let blob;
    try { blob = await renderSong(take); }
    catch (e) { blob = take.blob; } // fall back to the raw recording
    finally { btn.textContent = label; btn.disabled = false; }
    const ext = blob.type === "audio/wav" ? "wav" : (blob.type.includes("mp4") ? "m4a" : "webm");
    const file = new File([blob], `${take.name.replace(/[^\w ]+/g, "")}.${ext}`, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: take.name }); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
  }
  async function renderTakes() {
    const list = $("vcTakes");
    const takes = (await dbAll()).sort((a, b) => Number(b.id) - Number(a.id));
    list.innerHTML = "";
    $("vcEmpty").hidden = takes.length > 0;
    takes.forEach((take) => {
      const li = document.createElement("li");
      li.className = "vc-take";
      const name = document.createElement("div");
      name.className = "vc-take-name";
      name.textContent = take.name;
      const meta = document.createElement("div");
      meta.className = "vc-take-meta";
      meta.textContent = fmt(take.ms) + (take.withBeat ? " · with beat" : "");
      const row = document.createElement("div");
      row.className = "vc-take-actions";
      const mk = (label, fn, cls) => { const b = document.createElement("button"); b.type = "button"; b.className = cls || "pill"; b.textContent = label; b.addEventListener("click", () => fn(b)); return b; };
      const fxRow = document.createElement("div");
      fxRow.className = "vc-fx";
      fxRow.setAttribute("role", "radiogroup");
      fxRow.setAttribute("aria-label", "Voice effect");
      VoiceFx.EFFECTS.forEach((e) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "vc-fx-chip" + ((take.fx || "studio") === e.id ? " on" : "");
        b.textContent = e.label;
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", String((take.fx || "studio") === e.id));
        b.addEventListener("click", async () => {
          take.fx = e.id;
          await dbPut(take);
          fxRow.querySelectorAll(".vc-fx-chip").forEach((x) => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-checked", String(on)); });
          const playBtn = row.querySelector(".pill.active");
          if (playingTake && playingTake.id === take.id) { stopTake(); playTake(take, playBtn); }
        });
        fxRow.appendChild(b);
      });
      row.append(
        mk("Play", (b) => playTake(take, b), "pill active"),
        mk("Share song", (b) => shareTake(take, b)),
        mk("Add to my profile", () => {
          if (li.querySelector(".vc-publish")) return;
          const box = document.createElement("div");
          box.className = "vc-publish";
          const input = document.createElement("input");
          input.type = "text"; input.maxLength = 50; input.value = take.name; input.setAttribute("aria-label", "Song name");
          const go = mk("Publish", async (b) => {
            b.disabled = true; b.textContent = "Uploading…"; msg.textContent = "";
            const ok = await publishTake(take, input.value, msg).catch(() => { msg.textContent = "Couldn't share — try again."; return false; });
            b.disabled = false; b.textContent = "Publish";
            if (ok) { box.innerHTML = ""; box.appendChild(Object.assign(document.createElement("div"), { className: "cm-note", textContent: "On your profile now — find it in Community." })); }
          }, "pill active");
          const msg = document.createElement("div"); msg.className = "cm-error";
          box.append(input, go, msg);
          li.appendChild(box);
          input.focus();
        }),
        mk("Delete", async () => { if (confirm("Delete this recording?")) { await dbDel(take.id); renderTakes(); } }, "cm-link")
      );
      li.append(name, meta, fxRow, row);
      list.appendChild(li);
    });
  }

  // ---- chords (hold a pad to play; synthesised, no samples) -----------------------
  const CHORD_KEY = "calmStudio.chords.v1";
  const KEYS = { C: 0, G: 7, D: 2, F: 5, A: 9 };
  // Diatonic chords of a major key: degree offsets + quality.
  const DEGREES = [
    { name: "I", semis: 0, q: "maj" }, { name: "ii", semis: 2, q: "min" }, { name: "iii", semis: 4, q: "min" },
    { name: "IV", semis: 5, q: "maj" }, { name: "V", semis: 7, q: "maj" }, { name: "vi", semis: 9, q: "min" },
    { name: "IV7", semis: 5, q: "maj7" }, { name: "V7", semis: 7, q: "dom7" },
  ];
  const NOTE = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  const QUAL = { maj: [0, 4, 7], min: [0, 3, 7], maj7: [0, 4, 7, 11], dom7: [0, 4, 7, 10] };
  const SUFFIX = { maj: "", min: "m", maj7: "maj7", dom7: "7" };
  let chordState = { key: "C", sound: "pad", volume: 0.7 };
  try { chordState = { ...chordState, ...JSON.parse(localStorage.getItem(CHORD_KEY) || "{}") }; } catch (e) { /* defaults */ }
  const saveChords = () => { try { localStorage.setItem(CHORD_KEY, JSON.stringify(chordState)); } catch (e) { /* storage off */ } };
  const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  let chordBus = null;
  function makeChordBus(c, dest, volume) {
    const bus = c.createGain();
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 5200;
    const conv = c.createConvolver();
    const len = Math.floor(c.sampleRate * 2.2), ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    conv.buffer = ir;
    const wet = c.createGain(); wet.gain.value = 0.28;
    bus.connect(lp); lp.connect(dest); lp.connect(conv).connect(wet).connect(dest);
    bus.gain.value = volume;
    return bus;
  }
  function chordOut() {
    audio();
    if (!chordBus) chordBus = makeChordBus(ctx, master, chordState.volume);
    chordBus.gain.value = chordState.volume;
    return chordBus;
  }
  function chordName(d) { return NOTE[(KEYS[chordState.key] + d.semis) % 12] + SUFFIX[d.q]; }
  /**
   * Starts a chord at `when` (default: now). With `dur` it releases itself
   * (used for chords played on the beat); otherwise returns release().
   */
  // The chord synth itself, on any audio context (live or offline for "Save as song").
  // opts: { key, sound } — a loop layer replays chords with the key/sound they were played in.
  function chordVoices(c, out, d, t, opts) {
    const root = 48 + KEYS[opts.key] + d.semis; // around C3
    const notes = [root - 12, ...QUAL[d.q].map((i) => root + 12 + i - (root + 12 + i > 76 ? 12 : 0))];
    const S = opts.sound;
    // Quick attacks so a chord sounds the moment you touch it (was 350 ms on Soft pad).
    const atk = S === "pad" ? 0.03 : 0.004, peak = (S === "pad" ? 0.11 : 0.16) / Math.sqrt(notes.length);
    const voices = [];
    notes.forEach((m, k) => {
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak * (k === 0 ? 1.2 : 1), t + atk);
      if (S !== "pad") g.gain.exponentialRampToValueAtTime(peak * (S === "pluck" ? 0.05 : 0.35), t + (S === "pluck" ? 0.5 : 1.6));
      const f = c.createBiquadFilter(); f.type = "lowpass";
      f.frequency.setValueAtTime(S === "pluck" ? 3200 : S === "keys" ? 2600 : 1400, t);
      if (S === "pluck") f.frequency.exponentialRampToValueAtTime(500, t + 0.4);
      f.connect(g).connect(out);
      const types = S === "pad" ? ["sawtooth", "sawtooth"] : S === "keys" ? ["triangle", "sine"] : ["square"];
      types.forEach((type, j) => {
        const o = c.createOscillator();
        o.type = type;
        o.frequency.value = midiHz(m);
        o.detune.value = S === "pad" ? (j ? 9 : -9) : 0;
        o.connect(f); o.start(t);
        voices.push(o);
      });
      voices.push({ g });
    });
    return (at) => {
      const r = Math.max(at || 0, c.currentTime), rel = S === "pad" ? 0.9 : S === "keys" ? 0.5 : 0.25;
      voices.forEach((v) => {
        if (v.g) { v.g.gain.cancelScheduledValues(r); v.g.gain.setValueAtTime(Math.max(0.0001, v.g.gain.value), r); v.g.gain.exponentialRampToValueAtTime(0.0001, r + rel); }
        else v.stop(r + rel + 0.05);
      });
    };
  }
  /**
   * Starts a chord at `when` (default: now). With `dur` it releases itself
   * (used for chords played on the beat and loop layers); otherwise returns release().
   */
  function startChord(d, when, dur, opts) {
    const out = chordOut();
    const t = Math.max(when || 0, ctx.currentTime);
    const release = chordVoices(ctx, out, d, t, opts || { key: chordState.key, sound: chordState.sound });
    if (dur) { release(t + dur); return null; }
    return () => release();
  }
  /** While the beat runs, a tap snaps to the nearest 16th note so chords land in time. */
  function snapTime() {
    if (!playing) return ctx.currentTime;
    const len = D.stepSeconds(pattern.bpm), prev = nextTime - len;
    return ctx.currentTime - prev < 0.045 ? ctx.currentTime : nextTime;
  }
  let latched = null; // { d, el } — "Play on the beat" mode
  function buildChords() {
    const grid = $("chGrid");
    grid.innerHTML = "";
    DEGREES.forEach((d, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ch-pad";
      b.style.setProperty("--pad", D.TRACKS[i % D.TRACKS.length].color);
      b.innerHTML = `<b>${chordName(d)}</b><small>${d.name}</small>`;
      b.setAttribute("aria-label", `Chord ${chordName(d)}`);
      let release = null, pressedAt = 0;
      const down = (e) => {
        e.preventDefault();
        if (chordState.mode === "beat") {
          document.querySelectorAll(".ch-pad.latched").forEach((x) => x.classList.remove("latched"));
          if (latched && latched.d === d) { latched = null; return; }
          latched = { d };
          b.classList.add("latched");
          if (!playing) startDrums(); // the beat keeps the time for you
          return;
        }
        if (release) return;
        audio();
        pressedAt = snapTime();
        release = startChord(d, pressedAt);
        b.classList.add("down");
      };
      const up = () => {
        if (release) { release(); release = null; captureChord(i, pressedAt, ctx.currentTime - pressedAt); }
        b.classList.remove("down");
      };
      b.addEventListener("pointerdown", down);
      b.addEventListener("pointerup", up);
      b.addEventListener("pointercancel", up);
      b.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) down(e); });
      b.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") up(); });
      grid.appendChild(b);
    });
    document.querySelectorAll("#chKeys [data-chkey]").forEach((x) => x.classList.toggle("active", x.dataset.chkey === chordState.key));
    document.querySelectorAll("#chSounds [data-chsound]").forEach((x) => x.classList.toggle("active", x.dataset.chsound === chordState.sound));
    document.querySelectorAll("#chModes [data-chmode]").forEach((x) => x.classList.toggle("active", x.dataset.chmode === (chordState.mode || "hold")));
    $("chVol").value = Math.round(chordState.volume * 100);
  }
  // One key for the whole Studio (2026-10-13): Kalimba and Chords follow
  // each other. (A exists only for Chords; picking it leaves the Kalimba as is.)
  let syncingKey = false;
  function setChordKey(k) { if (!KEYS.hasOwnProperty(k) || chordState.key === k) return; chordState.key = k; saveChords(); buildChords(); }
  $("chKeys").addEventListener("click", (e) => {
    const b = e.target.closest("[data-chkey]");
    if (!b) return;
    setChordKey(b.dataset.chkey);
    const kb = document.querySelector(`#kalimbaKeyRow [data-key="${b.dataset.chkey}"]`);
    if (kb && !kb.classList.contains("active") && !syncingKey) { syncingKey = true; kb.click(); syncingKey = false; }
  });
  const kalimbaKeys = document.getElementById("kalimbaKeyRow");
  if (kalimbaKeys) kalimbaKeys.addEventListener("click", (e) => {
    const b = e.target.closest("[data-key]");
    if (b && !syncingKey) setChordKey(b.dataset.key);
  });
  $("chSounds").addEventListener("click", (e) => { const b = e.target.closest("[data-chsound]"); if (b) { chordState.sound = b.dataset.chsound; saveChords(); buildChords(); } });
  $("chModes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-chmode]");
    if (!b) return;
    chordState.mode = b.dataset.chmode;
    latched = null;
    saveChords(); buildChords();
  });
  $("chVol").addEventListener("input", (e) => { chordState.volume = Number(e.target.value) / 100; if (chordBus) chordBus.gain.value = chordState.volume; saveChords(); });

  // ---- looper: layers of chords and kalimba over the beat (2026-10-13) -------------
  // Press Record layer: the next pass of the 2-bar loop records whatever you play
  // (chord pads, kalimba). It then loops with everything else. Layers can be muted
  // or deleted, and "Save as song" renders beat + layers into a take.
  const LL = window.LooperLogic;
  const LOOP_KEY = "calmStudio.loop.v1";
  const loop = { layers: LL ? LL.deserialize(localStorage.getItem(LOOP_KEY) || "") : [], beatOn: true, armed: false, rec: null };
  try { loop.beatOn = localStorage.getItem(LOOP_KEY + ".beat") !== "0"; } catch (e) { /* storage off */ }
  const saveLoop = () => { try { localStorage.setItem(LOOP_KEY, LL.serialize(loop.layers)); localStorage.setItem(LOOP_KEY + ".beat", loop.beatOn ? "1" : "0"); } catch (e) { /* storage off */ } };
  const loopMsg = (t) => { if ($("loopMsg")) $("loopMsg").textContent = t; };

  function loopAtTop(t) {
    if (loop.rec) {                                 // one full pass recorded: keep it
      const layer = LL.makeLayer(loop.rec.events, Date.now());
      loop.rec = null;
      if (layer) { loop.layers = LL.addLayer(loop.layers, layer); saveLoop(); loopMsg(`Added a ${layer.name.toLowerCase()} layer. Record another on top, or save as a song.`); }
      else loopMsg("Nothing was played, so no layer was added.");
    }
    if (loop.armed) {
      loop.armed = false;
      loop.rec = { from: t, events: [] };
      loopMsg("Recording… play chords or kalimba now. It stops by itself after 2 bars.");
    }
    renderLoop();
  }
  function recPos(time) {
    if (!loop.rec || !ctx) return null;
    const stepSec = D.stepSeconds(pattern.bpm), end = loop.rec.from + LL.LOOP_STEPS * stepSec;
    if (time < loop.rec.from - 0.08 || time >= end) return null;
    return LL.posInLoop(Math.max(time, loop.rec.from), loop.rec.from, stepSec);
  }
  function captureChord(degIndex, startTime, durSec) {
    const p = recPos(startTime);
    if (p == null || degIndex < 0 || loop.rec.events.length >= LL.MAX_EVENTS) return;
    const stepSec = D.stepSeconds(pattern.bpm);
    loop.rec.events.push({ t: "c", p: LL.quantize(p, 0.5), d: degIndex, len: Math.min(LL.LOOP_STEPS, Math.max(0.5, durSec / stepSec)), s: chordState.sound, key: chordState.key });
  }
  window.addEventListener("calmkalimba:pluck", (e) => {
    if (!loop.rec || !ctx) return;
    const p = recPos(ctx.currentTime);
    const d = e.detail || {};
    if (p == null || loop.rec.events.length >= LL.MAX_EVENTS) return;
    loop.rec.events.push({ t: "k", p: LL.quantize(p, 0.25), tine: d.tine, v: Math.max(0.15, Math.min(1, d.v)), key: d.key || "C" });
  });

  // Kalimba layers play through the app's own kalimba (its instrument bus and
  // volume), scheduled ahead on that engine's clock.
  let loopKal = null, kalAt = 0;
  function playKalimba(e, when) {
    const K = window.CalmKalimba;
    if (!K || !window.KalimbaEngine) return;
    K.audioManager.ensureCtx();
    const kc = K.audioManager.ctx;
    if (!loopKal) {
      const proxy = new Proxy(kc, { get: (t, prop) => (prop === "currentTime" ? Math.max(t.currentTime, kalAt) : (typeof t[prop] === "function" ? t[prop].bind(t) : t[prop])) });
      loopKal = new window.KalimbaEngine({ ensureCtx() { K.audioManager.ensureCtx(); }, ctx: proxy, getBus: () => K.audioManager.getBus("instrument") });
    }
    kalAt = when + (kc.currentTime - ctx.currentTime);
    loopKal.setKey(e.key);
    loopKal.pluck(e.tine, e.v);
  }
  function playLoopStep(stepIdx, t, stepSec) {
    if (!LL) return;
    LL.eventsInStep(loop.layers, stepIdx).forEach(({ e, offset }) => {
      const when = t + offset * stepSec;
      if (e.t === "c") startChord(DEGREES[e.d], when, e.len * stepSec, { key: e.key, sound: e.s });
      else playKalimba(e, when);
    });
  }

  function renderLoop() {
    const list = $("loopLayers");
    if (!list) return;
    list.innerHTML = "";
    loop.layers.forEach((layer, i) => {
      const li = document.createElement("li");
      li.className = "loop-layer" + (layer.muted ? " muted" : "");
      const name = document.createElement("span");
      name.className = "loop-layer-name";
      name.textContent = `${i + 1}. ${layer.name}`;
      const notes = document.createElement("small");
      notes.textContent = `${layer.events.length} note${layer.events.length === 1 ? "" : "s"}`;
      const mute = document.createElement("button");
      mute.type = "button"; mute.className = "pill small"; mute.textContent = layer.muted ? "Unmute" : "Mute";
      mute.setAttribute("aria-pressed", String(layer.muted));
      mute.addEventListener("click", () => { loop.layers = LL.toggleMute(loop.layers, layer.id); saveLoop(); renderLoop(); });
      const del = document.createElement("button");
      del.type = "button"; del.className = "pill small loop-del"; del.textContent = "Delete";
      del.setAttribute("aria-label", `Delete layer ${i + 1}, ${layer.name}`);
      let sure = null;
      del.addEventListener("click", () => {
        if (!sure) { del.textContent = "Sure?"; del.classList.add("sure"); sure = setTimeout(() => { del.textContent = "Delete"; del.classList.remove("sure"); sure = null; }, 3000); return; }
        clearTimeout(sure);
        loop.layers = LL.removeLayer(loop.layers, layer.id); saveLoop(); renderLoop();
        loopMsg(`Deleted ${layer.name.toLowerCase()}.`);
      });
      li.append(name, notes, mute, del);
      list.appendChild(li);
    });
    $("loopEmpty").hidden = loop.layers.length > 0;
    const rec = $("loopRec");
    rec.textContent = loop.rec ? "Recording…" : loop.armed ? "Starts at bar 1…" : "Record layer";
    rec.classList.toggle("recording", !!(loop.rec || loop.armed));
    $("loopBeat").checked = loop.beatOn;
    $("loopBounce").disabled = !loop.layers.length && !loop.beatOn;
  }

  // "Save as song": render 2 passes of beat + layers offline, exactly in time,
  // into a WAV take next to your voice takes (play, share, post to your profile).
  function wavBlob(buf) {
    const ch = buf.getChannelData(0), n = ch.length, sr = buf.sampleRate;
    // Normalise to -1 dBFS so stacked layers never clip.
    let peak = 0; for (let i = 0; i < n; i++) { const a = Math.abs(ch[i]); if (a > peak) peak = a; }
    const g = peak > 0.89 ? 0.89 / peak : 1;
    const out = new DataView(new ArrayBuffer(44 + n * 2));
    const w = (o, str) => { for (let i = 0; i < str.length; i++) out.setUint8(o + i, str.charCodeAt(i)); };
    w(0, "RIFF"); out.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt ");
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
    out.setUint32(24, sr, true); out.setUint32(28, sr * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
    w(36, "data"); out.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) { const v = Math.max(-1, Math.min(1, ch[i] * g)); out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
    return new Blob([out], { type: "audio/wav" });
  }
  async function bounceLoop() {
    const btn = $("loopBounce");
    if (btn.disabled) return;
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const passes = 2, stepSec = D.stepSeconds(pattern.bpm), sr = 24000;
      const len = passes * LL.LOOP_STEPS * stepSec + 2.2;
      const off = new OfflineAudioContext(1, Math.ceil(sr * len), sr);
      const comp = off.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3;
      const mix = off.createGain(); mix.gain.value = pattern.volume; mix.connect(comp).connect(off.destination);
      const A = { c: off, out: mix, nb: makeNoise(off) };
      const chBus = makeChordBus(off, mix, chordState.volume);
      const kBus = off.createGain(); kBus.connect(mix);
      try { const v = Number(localStorage.getItem("calmStudio.kalimbaVol.v1")); kBus.gain.value = Number.isFinite(v) && localStorage.getItem("calmStudio.kalimbaVol.v1") != null ? v / 100 : 0.8; } catch (e) { kBus.gain.value = 0.8; }
      let kT = 0;
      const kProxy = new Proxy(off, { get: (t, prop) => (prop === "currentTime" ? kT : (typeof t[prop] === "function" ? t[prop].bind(t) : t[prop])) });
      const kal = window.KalimbaEngine ? new window.KalimbaEngine({ ensureCtx() {}, ctx: kProxy, getBus: () => kBus }) : null;
      for (let pass = 0; pass < passes; pass++) {
        for (let s = 0; s < LL.LOOP_STEPS; s++) {
          const t = 0.05 + (pass * LL.LOOP_STEPS + s) * stepSec;
          if (loop.beatOn) D.hitsAt(pattern, s % D.STEPS).forEach((tr) => VOICES[tr](A, t));
          LL.eventsInStep(loop.layers, s).forEach(({ e, offset }) => {
            const when = t + offset * stepSec;
            if (e.t === "c") chordVoices(off, chBus, DEGREES[e.d], when, { key: e.key, sound: e.s })(when + e.len * stepSec);
            else if (kal) { kT = when; kal.setKey(e.key); kal.pluck(e.tine, e.v); }
          });
        }
      }
      const buf = await off.startRendering();
      const when = new Date().toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      await dbPut({ fx: "natural", id: String(Date.now()), name: `Loop song ${when}`, blob: wavBlob(buf), ms: Math.round(len * 1000), withBeat: false, pattern: null, loop: true });
      loopMsg("Saved as a song. Find it under Voice → your takes, to play, share or post.");
      renderTakes();
    } catch (e) {
      loopMsg("Couldn't save the song on this device. Try again.");
    } finally {
      btn.textContent = "Save as song"; renderLoop();
    }
  }

  // ---- tabs + wiring --------------------------------------------------------------
  function showPanel(which) {
    document.querySelectorAll("#studioTabs [data-studio]").forEach((b) => {
      const on = b.dataset.studio === which;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
    });
    ["kalimba", "drums", "chords", "voice"].forEach((k) => { $("studio-" + k).hidden = k !== which; });
    if (which === "voice") renderTakes();
    if (which === "chords") { try { chordOut(); } catch (e) { /* audio blocked until a tap */ } }
  }
  document.querySelectorAll("#studioTabs [data-studio]").forEach((b) => b.addEventListener("click", () => showPanel(b.dataset.studio)));
  $("dmPlay").addEventListener("click", () => (playing ? stopDrums() : startDrums()));
  if ($("loopBar") && LL) {
    $("loopPlay").addEventListener("click", () => (playing ? stopDrums() : startDrums()));
    $("loopRec").addEventListener("click", () => {
      if (loop.rec) return;                         // a pass is already recording
      if (loop.armed) { loop.armed = false; loopMsg("Recording cancelled."); renderLoop(); return; }
      audio();
      loop.armed = true;
      if (!playing) startDrums();                   // starts at bar 1, so recording begins right away
      else loopMsg("Recording starts at the top of the loop…");
      renderLoop();
    });
    $("loopBeat").addEventListener("change", (e) => { loop.beatOn = e.target.checked; saveLoop(); renderLoop(); });
    $("loopBounce").addEventListener("click", bounceLoop);
    renderLoop();
  }
  $("dmBpm").addEventListener("input", (e) => { pattern = { ...pattern, bpm: D.clampBpm(e.target.value) }; $("dmBpmLabel").textContent = pattern.bpm + " BPM"; save(); });
  $("dmVol").addEventListener("input", (e) => { pattern = { ...pattern, volume: Number(e.target.value) / 100 }; if (master) master.gain.value = pattern.volume; save(); });
  $("dmClear").addEventListener("click", () => loadPreset("empty"));
  $("dmPresets").addEventListener("click", (e) => { const b = e.target.closest("[data-preset]"); if (b) loadPreset(b.dataset.preset); });
  $("vcRec").addEventListener("click", () => (recorder && recorder.state === "recording" ? stopRecording() : startRecording()));
  document.addEventListener("visibilitychange", () => { if (document.hidden && playing && !(recorder && recorder.state === "recording")) stopDrums(); });

  buildGrid();
  buildChords();
  renderTransport();
  // Kalimba volume (the app's "instrument" bus).
  const KV = "calmStudio.kalimbaVol.v1";
  const kv = $("kalimbaVol");
  if (kv && window.CalmApp && CalmApp.setKalimbaVolume) {
    const saved = Number(localStorage.getItem(KV));
    kv.value = Number.isFinite(saved) && localStorage.getItem(KV) != null ? saved : 80;
    CalmApp.setKalimbaVolume(kv.value / 100);
    kv.addEventListener("input", () => { CalmApp.setKalimbaVolume(kv.value / 100); try { localStorage.setItem(KV, kv.value); } catch (e) { /* storage off */ } });
  }
  showPanel("kalimba");
})();
