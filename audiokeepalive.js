// ---------------------------------------------------------------------------
// Audio keep-alive (2026-10-13). On iPhone, every time the voice guidance
// speaks (speechSynthesis), iOS interrupts the page's Web Audio and often
// leaves it suspended — so rain, kalimba, drums and chords went silent while
// navigating. This tracks every AudioContext the app creates and brings back
// the ones that were playing: after each spoken sentence, when iOS marks a
// context "interrupted"/"suspended", and on the next touch. Contexts the app
// deliberately suspends (ctx.suspend()) are left alone.
// Must load before any other audio script.
// ---------------------------------------------------------------------------
(function () {
  "use strict";
  const Native = window.AudioContext || window.webkitAudioContext;
  if (!Native) return;
  const all = new Set();
  const wanted = new WeakMap(); // ctx -> true if it should be running
  function track(ctx) {
    all.add(ctx);
    wanted.set(ctx, true);
    const realSuspend = ctx.suspend.bind(ctx);
    ctx.suspend = function () { wanted.set(ctx, false); return realSuspend(); };
    const realResume = ctx.resume.bind(ctx);
    ctx.resume = function () { wanted.set(ctx, true); return realResume(); };
    ctx.addEventListener("statechange", () => {
      if ((ctx.state === "suspended" || ctx.state === "interrupted") && wanted.get(ctx) && !document.hidden) {
        setTimeout(() => revive(ctx), 250);
      }
    });
    return ctx;
  }
  function revive(ctx) {
    if (!wanted.get(ctx) || ctx.state === "closed" || ctx.state === "running") return;
    try { const p = Object.getPrototypeOf(ctx).resume.call(ctx); if (p && p.catch) p.catch(() => {}); } catch (e) { /* needs a gesture: the next touch retries */ }
  }
  function reviveAll() { all.forEach(revive); }
  function Wrapped(opts) { return track(new Native(opts)); }
  Wrapped.prototype = Native.prototype;
  window.AudioContext = Wrapped;
  if (window.webkitAudioContext) window.webkitAudioContext = Wrapped;

  // After every spoken direction, bring the music back.
  if (window.speechSynthesis && window.speechSynthesis.speak) {
    const realSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
    window.speechSynthesis.speak = function (u) {
      try {
        const again = () => { setTimeout(reviveAll, 120); setTimeout(reviveAll, 700); };
        u.addEventListener("end", again);
        u.addEventListener("error", again);
      } catch (e) { /* old engines */ }
      return realSpeak(u);
    };
  }
  // A touch always counts as a user gesture on iOS — use it to unstick audio.
  ["touchend", "pointerup", "keydown"].forEach((ev) => document.addEventListener(ev, reviveAll, { capture: true, passive: true }));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) setTimeout(reviveAll, 200); });
  window.CalmAudioKeepAlive = { reviveAll };
})();
