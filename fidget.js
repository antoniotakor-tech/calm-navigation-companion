// ---------------------------------------------------------------------------
// Fidget tools (2026-10-12): spinner, bubble wrap, clicky switches, a detent
// slider and a squishy blob — each with a soft click sound and haptics.
//
// Haptics, three ways:
//  - native app: NavBridge.haptics (Capacitor Haptics, real Taptic Engine)
//  - Android browsers: navigator.vibrate
//  - iPhone Safari (no vibrate API): toggling a hidden <input switch> makes
//    iOS 18+ play its own system haptic tick. Must run inside a user gesture.
// ---------------------------------------------------------------------------
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  if (!$("studio-fidget")) return;

  // ---- haptics --------------------------------------------------------------------
  const iosSwitch = document.createElement("label");
  iosSwitch.setAttribute("aria-hidden", "true");
  iosSwitch.style.cssText = "position:fixed;left:-100px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none";
  const sw = document.createElement("input");
  sw.type = "checkbox"; sw.setAttribute("switch", ""); sw.tabIndex = -1;
  iosSwitch.appendChild(sw);
  document.body.appendChild(iosSwitch);
  let lastBuzz = 0;
  function buzz(strength) {
    const now = performance.now();
    if (now - lastBuzz < 35) return; // don't machine-gun the motor
    lastBuzz = now;
    try {
      // Native app: reuse the navigation haptic patterns (LIGHT / MEDIUM impacts).
      if (window.NavBridge && NavBridge.isNative && NavBridge.haptics && NavBridge.haptics.vibrate) { NavBridge.haptics.vibrate(strength > 1 ? "turnLeft" : "continueStraight"); return; }
      if (navigator.vibrate) { navigator.vibrate(strength > 1 ? 18 : 8); return; }
      iosSwitch.click(); // iOS 18+ Safari: system haptic
    } catch (e) { /* no haptics here — sound still plays */ }
  }

  // ---- tiny sounds ------------------------------------------------------------------
  let ac = null;
  function sound(kind) {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
      if (ac.state === "suspended") ac.resume();
      const t = ac.currentTime, g = ac.createGain();
      g.connect(ac.destination);
      const o = ac.createOscillator();
      if (kind === "pop") { o.type = "triangle"; o.frequency.setValueAtTime(700 + Math.random() * 300, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.06); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08); }
      else if (kind === "tick") { o.type = "square"; o.frequency.value = 2200; g.gain.setValueAtTime(0.04, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.012); }
      else if (kind === "clack") { o.type = "square"; o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(300, t + 0.02); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.035); }
      else { o.type = "sine"; o.frequency.setValueAtTime(kind === "squish-in" ? 260 : 180, t); o.frequency.exponentialRampToValueAtTime(kind === "squish-in" ? 140 : 320, t + 0.12); g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15); }
      o.connect(g); o.start(t); o.stop(t + 0.2);
    } catch (e) { /* audio blocked */ }
  }
  const feel = (kind, strength) => { sound(kind); buzz(strength || 1); };

  // ---- 1. spinner (flick to spin; momentum + friction; tick every arm) -----------------
  const spin = $("fgSpinner");
  let angle = 0, vel = 0, dragging = false, lastA = 0, lastT = 0, lastArm = 0, raf = null;
  const center = () => { const r = spin.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const angAt = (e) => { const c = center(); return Math.atan2(e.clientY - c.y, e.clientX - c.x); };
  function render() { spin.style.transform = `rotate(${angle}rad)`; }
  function checkTick() {
    const arm = Math.floor(angle / (2 * Math.PI / 3));
    if (arm !== lastArm) { lastArm = arm; feel("tick", Math.abs(vel) > 0.25 ? 1 : 2); }
  }
  function loop() {
    if (!dragging) {
      angle += vel;
      vel *= 0.985;
      if (Math.abs(vel) < 0.0015) { vel = 0; raf = null; render(); return; }
    }
    checkTick(); render();
    raf = requestAnimationFrame(loop);
  }
  spin.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try { spin.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
    dragging = true; lastA = angAt(e); lastT = performance.now(); vel = 0;
    if (!raf) raf = requestAnimationFrame(loop);
  });
  spin.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const a = angAt(e), now = performance.now();
    let d = a - lastA;
    if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
    angle += d;
    vel = (d / Math.max(1, now - lastT)) * 16.7; // radians per frame
    lastA = a; lastT = now;
  });
  const release = () => { if (!dragging) return; dragging = false; vel = Math.max(-0.9, Math.min(0.9, vel * 1.4)); if (!raf) raf = requestAnimationFrame(loop); };
  spin.addEventListener("pointerup", release);
  spin.addEventListener("pointercancel", release);

  // ---- 2. bubble wrap ------------------------------------------------------------------
  const wrap = $("fgBubbles");
  function fillBubbles() {
    wrap.innerHTML = "";
    for (let i = 0; i < 30; i++) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "fg-bubble"; b.setAttribute("aria-label", "Bubble");
      b.addEventListener("pointerdown", () => {
        if (b.classList.contains("popped")) return;
        b.classList.add("popped"); feel("pop", 2);
        if (!wrap.querySelector(".fg-bubble:not(.popped)")) setTimeout(fillBubbles, 900);
      });
      wrap.appendChild(b);
    }
  }
  $("fgRefill").addEventListener("click", fillBubbles);

  // ---- 3. clicky switches ----------------------------------------------------------------
  document.querySelectorAll(".fg-switch").forEach((s) => s.addEventListener("click", () => {
    const on = s.getAttribute("aria-pressed") !== "true";
    s.setAttribute("aria-pressed", String(on));
    feel("clack", on ? 2 : 1);
  }));
  $("fgClicker").addEventListener("pointerdown", () => { $("fgClicker").classList.add("down"); feel("clack", 2); });
  const up = () => { if ($("fgClicker").classList.contains("down")) { $("fgClicker").classList.remove("down"); feel("tick", 1); } };
  $("fgClicker").addEventListener("pointerup", up);
  $("fgClicker").addEventListener("pointerleave", up);

  // ---- 4. detent slider (a click every 10%) ---------------------------------------------
  let lastDetent = 5;
  $("fgSlider").addEventListener("input", (e) => {
    const d = Math.round(Number(e.target.value) / 10);
    if (d !== lastDetent) { lastDetent = d; feel("tick", d === 0 || d === 10 ? 2 : 1); }
  });

  // ---- 5. squishy blob ------------------------------------------------------------------
  const blob = $("fgBlob");
  blob.addEventListener("pointerdown", (e) => { e.preventDefault(); blob.classList.add("squish"); feel("squish-in", 2); });
  const unsquish = () => { if (blob.classList.contains("squish")) { blob.classList.remove("squish"); feel("squish-out", 1); } };
  blob.addEventListener("pointerup", unsquish);
  blob.addEventListener("pointerleave", unsquish);
  blob.addEventListener("pointercancel", unsquish);

  fillBubbles();
  render();
})();
