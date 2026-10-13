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

  // ---- 1. spinner: real flick physics -----------------------------------------------
  // Velocity comes from the last ~90 ms of the drag (not one tiny move), so a
  // flick really throws it; low friction so a good spin lasts 20-40 s.
  const spin = $("fgSpinner"), ghost = $("fgSpinGhost");
  let angle = 0, vel = 0, dragging = false, lastArm = 0, raf = null, spinStart = 0, best = 0;
  let samples = []; // [{t, a}] unwrapped angle over time
  let prevA = 0;
  const center = () => { const r = spin.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const angAt = (e) => { const c = center(); return Math.atan2(e.clientY - c.y, e.clientX - c.x); };
  const ARM = (2 * Math.PI) / 3;
  function render() {
    spin.style.transform = `rotate(${angle}rad)`;
    const speed = Math.abs(vel);
    // motion blur: a soft ghost disc fades in as it speeds up
    ghost.style.opacity = String(Math.min(0.85, Math.max(0, (speed - 0.12) * 1.6)));
    spin.style.filter = speed > 0.35 ? `blur(${Math.min(2.2, (speed - 0.35) * 4)}px)` : "";
    $("fgRpm").textContent = String(Math.round(speed * 60 * 60 / (2 * Math.PI)));
    if (spinStart) $("fgSpinTime").textContent = ((performance.now() - spinStart) / 1000).toFixed(1);
  }
  function checkTick() {
    const arm = Math.floor(angle / ARM);
    if (arm !== lastArm) {
      lastArm = arm;
      if (Math.abs(vel) < 0.5) feel("tick", Math.abs(vel) < 0.08 ? 2 : 1); // ticks fade into a hum when fast
    }
  }
  let lastFrame = 0;
  function loop(now) {
    const dt = lastFrame ? Math.min(3, (now - lastFrame) / 16.7) : 1;
    lastFrame = now;
    if (!dragging) {
      angle += vel * dt;
      vel *= Math.pow(Math.abs(vel) > 0.05 ? 0.9935 : 0.975, dt); // bearing friction, then a gentle settle
      if (Math.abs(vel) < 0.0012) {
        vel = 0; raf = null; lastFrame = 0;
        if (spinStart) {
          const s = (performance.now() - spinStart) / 1000;
          if (s > best) { best = s; $("fgBest").textContent = s.toFixed(1); try { localStorage.setItem("calmFidget.best.v1", s.toFixed(1)); } catch (e) { /* ok */ } }
          spinStart = 0;
        }
        render(); return;
      }
    }
    checkTick(); render();
    raf = requestAnimationFrame(loop);
  }
  spin.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try { spin.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
    dragging = true; vel = 0; spinStart = 0;
    prevA = angAt(e);
    samples = [{ t: performance.now(), a: angle }];
    if (!raf) { lastFrame = 0; raf = requestAnimationFrame(loop); }
  });
  spin.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const a = angAt(e);
    let d = a - prevA;
    if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
    prevA = a;
    angle += d;
    const now = performance.now();
    samples.push({ t: now, a: angle });
    while (samples.length > 2 && now - samples[0].t > 90) samples.shift();
  });
  const release = () => {
    if (!dragging) return;
    dragging = false;
    const now = performance.now();
    const first = samples[0], last = samples[samples.length - 1];
    const dtMs = Math.max(16, last.t - first.t);
    const stale = now - last.t > 120; // finger stopped before lifting: no throw
    vel = stale ? 0 : ((last.a - first.a) / dtMs) * 16.7 * 1.15;
    vel = Math.max(-1.1, Math.min(1.1, vel));
    if (Math.abs(vel) > 0.015) { spinStart = now; feel("clack", 2); }
    if (!raf) { lastFrame = 0; raf = requestAnimationFrame(loop); }
  };
  spin.addEventListener("pointerup", release);
  spin.addEventListener("pointercancel", release);
  try { best = Number(localStorage.getItem("calmFidget.best.v1")) || 0; $("fgBest").textContent = best.toFixed(1); } catch (e) { /* ok */ }
  // Spinner designs (Classic free; others are Calm+ extras).
  $("fgSkins").addEventListener("click", (e) => {
    const b = e.target.closest("[data-skin]");
    if (!b) return;
    if (b.classList.contains("plus-only") && !(window.PlusGate && PlusGate.allowed())) { window.PlusGate && PlusGate.explain(); return; }
    spin.dataset.skin = b.dataset.skin;
    document.querySelectorAll("#fgSkins [data-skin]").forEach((x) => x.classList.toggle("active", x === b));
    feel("clack", 1);
  });

  // ---- 2. bubble wrap ------------------------------------------------------------------
  const wrap = $("fgBubbles");
  let popped = 0;
  function fillBubbles() {
    wrap.innerHTML = "";
    for (let i = 0; i < 30; i++) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "fg-bubble"; b.setAttribute("aria-label", "Bubble");
      b.addEventListener("pointerdown", () => {
        if (b.classList.contains("popped")) return;
        b.classList.add("popped"); feel("pop", 2);
        popped++; $("fgPopped").textContent = popped;
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
