// ---------------------------------------------------------------------------
// Sketchbook (2026-10-12): draw on the app's lined paper, or over a photo.
// Brushes: crayon (grainy, like the doodles), marker, pencil, eraser. Strokes
// are smoothed and follow Apple Pencil pressure when there is one.
// Sketches stay on this device (IndexedDB) until shared or posted.
// ---------------------------------------------------------------------------
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const canvas = $("skCanvas");
  if (!canvas) return;
  const COLORS = ["#2D2A3E", "#FF5C8A", "#FF9F43", "#FFD84D", "#7ED67A", "#4DA8FF", "#B58CFF", "#FFFFFF"];
  const W = 1200, H = 1500; // fixed drawing resolution; displayed responsively
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  const state = { tool: "crayon", color: COLORS[1], size: 10, bg: null }; // bg: HTMLImageElement | null
  const undo = [];

  // ---- paper ------------------------------------------------------------------
  function drawPaper() {
    g.save();
    g.globalCompositeOperation = "source-over";
    g.fillStyle = "#FFFAF1";
    g.fillRect(0, 0, W, H);
    if (state.bg) {
      const s = Math.max(W / state.bg.naturalWidth, H / state.bg.naturalHeight);
      const w = state.bg.naturalWidth * s, h = state.bg.naturalHeight * s;
      g.drawImage(state.bg, (W - w) / 2, (H - h) / 2, w, h);
    } else {
      g.strokeStyle = "rgba(77,168,255,.28)"; g.lineWidth = 2;
      for (let y = 90; y < H; y += 60) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      g.strokeStyle = "rgba(255,92,138,.45)"; g.lineWidth = 3;
      g.beginPath(); g.moveTo(110, 0); g.lineTo(110, H); g.stroke();
    }
    g.restore();
  }
  let paperSnapshot = null; // what the eraser restores
  function resetPaper() { drawPaper(); paperSnapshot = g.getImageData(0, 0, W, H); }

  // ---- brushes ------------------------------------------------------------------
  function point(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height), p: e.pressure && e.pointerType === "pen" ? e.pressure : 0.6 };
  }
  function crayonSeg(a, b) {
    const dist = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(dist / 1.5));
    const r = state.size * (0.6 + b.p * 0.7);
    g.fillStyle = state.color;
    for (let i = 0; i < n; i++) {
      const t = i / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      for (let k = 0; k < 6; k++) {
        const ang = Math.random() * 6.283, rr = Math.random() * r;
        g.globalAlpha = 0.18 + Math.random() * 0.35;
        g.fillRect(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr, 2.2, 2.2);
      }
    }
    g.globalAlpha = 1;
  }
  function lineSeg(a, b, mid) {
    g.lineCap = "round"; g.lineJoin = "round";
    if (state.tool === "marker") { g.strokeStyle = state.color; g.globalAlpha = 0.85; g.lineWidth = state.size * 2.2 * (0.7 + b.p * 0.6); }
    else { g.strokeStyle = state.color; g.globalAlpha = 0.9; g.lineWidth = Math.max(1.5, state.size * 0.45 * (0.5 + b.p)); }
    g.beginPath(); g.moveTo(a.x, a.y); g.quadraticCurveTo(mid.x, mid.y, b.x, b.y); g.stroke();
    g.globalAlpha = 1;
  }
  function strokeToPath(a, b, r) {
    const p = new Path2D();
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (r * 0.5)));
    for (let i = 0; i <= steps; i++) { const t = i / steps; p.moveTo(a.x + (b.x - a.x) * t + r, a.y + (b.y - a.y) * t); p.arc(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, r, 0, 6.283); }
    return p;
  }

  // putImageData ignores clip, so erase by drawing the paper snapshot through a clip instead
  const paperCanvas = document.createElement("canvas");
  paperCanvas.width = W; paperCanvas.height = H;
  function syncPaperCanvas() { paperCanvas.getContext("2d").putImageData(paperSnapshot, 0, 0); }
  function eraseSegClip(a, b) {
    const r = state.size * 2.4;
    g.save();
    g.clip(strokeToPath(a, b, r));
    g.drawImage(paperCanvas, 0, 0);
    g.restore();
  }

  let last = null, prev = null, drawing = false;
  function pushUndo() { undo.push(g.getImageData(0, 0, W, H)); if (undo.length > 25) undo.shift(); }
  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not a live pointer: draw anyway */ }
    pushUndo();
    drawing = true;
    last = prev = point(e);
    if (state.tool === "crayon") crayonSeg(last, last);
    else if (state.tool === "eraser") eraseSegClip(last, last);
    else lineSeg(last, { ...last, x: last.x + 0.1 }, last);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const co = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    const events = co && co.length ? co : [e]; // some browsers return an empty list
    events.forEach((ev) => {
      const p = point(ev);
      if (Math.hypot(p.x - last.x, p.y - last.y) < 1) return;
      if (state.tool === "crayon") crayonSeg(last, p);
      else if (state.tool === "eraser") eraseSegClip(last, p);
      else { const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 }; lineSeg(prev, mid, last); prev = mid; }
      last = p;
    });
  });
  const end = () => { drawing = false; scheduleAutosave(); };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  // ---- saving: IndexedDB gallery -------------------------------------------------------
  const DB = "calmSketch", STORE = "sketches";
  function db() { return new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  const idb = {
    async all() { const d = await db(); return new Promise((res) => { const q = d.transaction(STORE).objectStore(STORE).getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); }); },
    async put(v) { const d = await db(); return new Promise((res) => { const tx = d.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(v); tx.oncomplete = res; tx.onerror = res; }); },
    async del(id) { const d = await db(); return new Promise((res) => { const tx = d.transaction(STORE, "readwrite"); tx.objectStore(STORE).delete(id); tx.oncomplete = res; tx.onerror = res; }); },
  };
  let currentId = null, saveTimer = null;
  const toBlob = (type, q) => new Promise((res) => canvas.toBlob(res, type, q));
  function scheduleAutosave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 1200); }
  async function saveNow() {
    if (!currentId) currentId = String(Date.now());
    const blob = await toBlob("image/jpeg", 0.88);
    await idb.put({ id: currentId, blob, updated: Date.now() });
    renderGallery();
  }
  async function renderGallery() {
    const list = $("skGallery");
    const items = (await idb.all()).sort((a, b) => b.updated - a.updated);
    list.innerHTML = "";
    items.forEach((it) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sk-thumb" + (it.id === currentId ? " on" : "");
      b.setAttribute("aria-label", "Open sketch");
      const img = document.createElement("img");
      img.src = URL.createObjectURL(it.blob);
      img.alt = "";
      b.appendChild(img);
      b.addEventListener("click", () => openSketch(it));
      list.appendChild(b);
    });
  }
  async function openSketch(it) {
    await saveNow();
    const img = new Image();
    img.onload = () => { state.bg = null; resetPaper(); g.drawImage(img, 0, 0, W, H); currentId = it.id; undo.length = 0; renderGallery(); };
    img.src = URL.createObjectURL(it.blob);
  }
  function newSketch(bgImage) {
    if (currentId) saveNow();
    currentId = null; undo.length = 0;
    state.bg = bgImage || null;
    resetPaper(); syncPaperCanvas();
    renderGallery();
  }

  // ---- toolbar ------------------------------------------------------------------------
  function renderTools() {
    document.querySelectorAll("#skTools [data-tool]").forEach((b) => b.classList.toggle("active", b.dataset.tool === state.tool));
    document.querySelectorAll("#skColors .sk-color").forEach((b) => b.classList.toggle("on", b.dataset.color === state.color));
  }
  const colors = $("skColors");
  COLORS.forEach((c) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "sk-color"; b.dataset.color = c; b.style.background = c;
    b.setAttribute("aria-label", "Colour " + c);
    b.addEventListener("click", () => { state.color = c; if (state.tool === "eraser") state.tool = "crayon"; renderTools(); });
    colors.appendChild(b);
  });
  $("skTools").addEventListener("click", (e) => { const b = e.target.closest("[data-tool]"); if (b) { state.tool = b.dataset.tool; renderTools(); } });
  $("skSize").addEventListener("input", (e) => { state.size = Number(e.target.value); });
  $("skUndo").addEventListener("click", () => { const s = undo.pop(); if (s) { g.putImageData(s, 0, 0); scheduleAutosave(); } });
  $("skNew").addEventListener("click", () => newSketch(null));
  $("skPhoto").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const img = new Image();
    img.onload = () => newSketch(img);
    img.src = URL.createObjectURL(f);
  });
  $("skDelete").addEventListener("click", async () => {
    if (!currentId || !confirm("Delete this sketch?")) return;
    await idb.del(currentId);
    currentId = null; newSketch(null);
  });
  $("skShare").addEventListener("click", async () => {
    const blob = await toBlob("image/png");
    const file = new File([blob], "sketch.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === "AbortError") return; } }
    const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  });
  $("skPost").addEventListener("click", async () => {
    const blob = await toBlob("image/jpeg", 0.85);
    window.dispatchEvent(new CustomEvent("calmsketch:post", { detail: blob }));
  });

  state.size = Number($("skSize").value) || 10;
  resetPaper(); syncPaperCanvas();
  renderTools();
  renderGallery();
})();
