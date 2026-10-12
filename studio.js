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
      ctx = new (window.AudioContext || window.webkitAudioContext)();
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
  let playing = false, nextTime = 0, step = 0, timer = null;
  const queue = []; // [{ step, time }] for the playhead
  function save() { try { localStorage.setItem(PATTERN_KEY, D.serialize(pattern)); } catch (e) { /* storage off */ } }

  function schedule() {
    while (nextTime < ctx.currentTime + 0.12) {
      D.hitsAt(pattern, step).forEach((tr) => VOICES[tr](live(), nextTime));
      queue.push({ step, time: nextTime });
      nextTime += D.stepSeconds(pattern.bpm);
      step = (step + 1) % D.STEPS;
    }
  }
  function startDrums() {
    if (playing) return;
    audio();
    playing = true; step = 0; nextTime = ctx.currentTime + 0.06;
    schedule();
    timer = setInterval(schedule, 25);
    requestAnimationFrame(drawPlayhead);
    renderTransport();
    document.body.classList.add("studio-playing");
  }
  function stopDrums() {
    playing = false;
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
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
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
    if (withBeat) { stopDrums(); startDrums(); }
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
    if (withBeat) stopDrums();
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
        mk("Delete", async () => { if (confirm("Delete this recording?")) { await dbDel(take.id); renderTakes(); } }, "cm-link")
      );
      li.append(name, meta, fxRow, row);
      list.appendChild(li);
    });
  }

  // ---- tabs + wiring --------------------------------------------------------------
  function showPanel(which) {
    document.querySelectorAll("#studioTabs [data-studio]").forEach((b) => {
      const on = b.dataset.studio === which;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
    });
    ["kalimba", "drums", "voice"].forEach((k) => { $("studio-" + k).hidden = k !== which; });
    if (which === "voice") renderTakes();
  }
  document.querySelectorAll("#studioTabs [data-studio]").forEach((b) => b.addEventListener("click", () => showPanel(b.dataset.studio)));
  $("dmPlay").addEventListener("click", () => (playing ? stopDrums() : startDrums()));
  $("dmBpm").addEventListener("input", (e) => { pattern = { ...pattern, bpm: D.clampBpm(e.target.value) }; $("dmBpmLabel").textContent = pattern.bpm + " BPM"; save(); });
  $("dmVol").addEventListener("input", (e) => { pattern = { ...pattern, volume: Number(e.target.value) / 100 }; if (master) master.gain.value = pattern.volume; save(); });
  $("dmClear").addEventListener("click", () => loadPreset("empty"));
  $("dmPresets").addEventListener("click", (e) => { const b = e.target.closest("[data-preset]"); if (b) loadPreset(b.dataset.preset); });
  $("vcRec").addEventListener("click", () => (recorder && recorder.state === "recording" ? stopRecording() : startRecording()));
  document.addEventListener("visibilitychange", () => { if (document.hidden && playing && !(recorder && recorder.state === "recording")) stopDrums(); });

  buildGrid();
  renderTransport();
  showPanel("kalimba");
})();
