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
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  function env(t, peak, attack, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(master);
    return g;
  }
  function noise(t, dur, type, freq, q, peak, decay) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    src.connect(f).connect(env(t, peak, 0.002, decay));
    src.start(t, Math.random() * 0.5, dur);
  }
  const VOICES = {
    kick(t) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
      o.connect(env(t, 1, 0.003, 0.38));
      o.start(t); o.stop(t + 0.45);
    },
    snare(t) {
      noise(t, 0.2, "bandpass", 1800, 0.8, 0.55, 0.17);
      const o = ctx.createOscillator();
      o.type = "triangle"; o.frequency.setValueAtTime(190, t);
      o.connect(env(t, 0.35, 0.002, 0.09)); o.start(t); o.stop(t + 0.12);
    },
    clap(t) { [0, 0.012, 0.026].forEach((d, i) => noise(t + d, 0.1, "bandpass", 1400, 1.2, i === 2 ? 0.6 : 0.35, i === 2 ? 0.14 : 0.02)); },
    hat(t) { noise(t, 0.06, "highpass", 7500, 0.7, 0.28, 0.045); },
    tom(t) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(230, t);
      o.frequency.exponentialRampToValueAtTime(115, t + 0.2);
      o.connect(env(t, 0.7, 0.003, 0.28)); o.start(t); o.stop(t + 0.35);
    },
    shaker(t) { noise(t, 0.09, "bandpass", 5200, 1.5, 0.18, 0.06); },
  };
  function hit(track, t) { audio(); VOICES[track]((t != null ? t : ctx.currentTime) + 0.001); }

  // ---- sequencer (look-ahead scheduler) ------------------------------------------
  let pattern = D.deserialize(localStorage.getItem(PATTERN_KEY) || "") || D.fromPreset("calm");
  let playing = false, nextTime = 0, step = 0, timer = null;
  const queue = []; // [{ step, time }] for the playhead
  function save() { try { localStorage.setItem(PATTERN_KEY, D.serialize(pattern)); } catch (e) { /* storage off */ } }

  function schedule() {
    while (nextTime < ctx.currentTime + 0.12) {
      D.hitsAt(pattern, step).forEach((tr) => VOICES[tr](nextTime));
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
    const take = { id: String(Date.now()), name: `Take ${new Date().toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`, blob, ms: Date.now() - recStart, withBeat, pattern: withBeat ? D.serialize(pattern) : null };
    await dbPut(take);
    renderTakes();
  }
  const fmt = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

  let playingAudio = null;
  function playTake(take, btn) {
    if (playingAudio) { playingAudio.el.pause(); playingAudio.btn.textContent = "Play"; const same = playingAudio.take.id === take.id; playingAudio = null; stopDrums(); if (same) return; }
    const el = new Audio(URL.createObjectURL(take.blob));
    if (take.withBeat && take.pattern) {
      const p = D.deserialize(take.pattern);
      if (p) { pattern = { ...p, volume: pattern.volume }; buildGrid(); renderTransport(); }
      stopDrums(); startDrums();
    }
    el.play().catch(() => {});
    btn.textContent = "Stop";
    playingAudio = { el, btn, take };
    el.onended = () => { btn.textContent = "Play"; playingAudio = null; stopDrums(); };
  }
  async function shareTake(take) {
    const ext = (take.blob.type.includes("mp4") ? "m4a" : "webm");
    const file = new File([take.blob], `${take.name.replace(/[^\w ]+/g, "")}.${ext}`, { type: take.blob.type });
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
      row.append(
        mk("Play", (b) => playTake(take, b), "pill active"),
        mk("Share", () => shareTake(take)),
        mk("Delete", async () => { if (confirm("Delete this recording?")) { await dbDel(take.id); renderTakes(); } }, "cm-link")
      );
      li.append(name, meta, row);
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
