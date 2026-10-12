// ---------------------------------------------------------------------------
// Scroll lock for hands-on tools (2026-10-12). While a finger is on something
// you drag — the sketch canvas, any slider, the spinner, chord pads, drum
// steps, the kalimba, bubbles — the page must not scroll up/down or swipe to
// the next tab. Locks on touch start, unlocks on release.
// ---------------------------------------------------------------------------
(function () {
  "use strict";
  const ZONES = "canvas, input[type=range], .fg-spinner, .fg-blob, .fg-bubble, .fg-clicker, .ch-pad, .dm-step, .dm-name, .kalimba-wrap, .kalimba-tine-btn, .cm-pick, .cm-map, .sk-colors";
  const SLIDER = "input[type=range]";
  let locked = false;
  function lock() { if (!locked) { locked = true; document.documentElement.classList.add("tool-lock"); } }
  function unlock() { if (locked) { locked = false; document.documentElement.classList.remove("tool-lock"); } }
  document.addEventListener("touchstart", (e) => { if (e.target.closest && e.target.closest(ZONES)) lock(); }, { capture: true, passive: true });
  // Stop iOS from scrolling the page while drawing/spinning (sliders keep their own drag).
  document.addEventListener("touchmove", (e) => {
    if (!locked) return;
    const t = e.target.closest && e.target.closest(ZONES);
    if (t && !t.matches(SLIDER) && !t.closest(".cm-map, .cm-pick")) e.preventDefault();
  }, { capture: true, passive: false });
  ["touchend", "touchcancel"].forEach((ev) => document.addEventListener(ev, (e) => { if (!e.touches || e.touches.length === 0) unlock(); }, { capture: true, passive: true }));
  // Mouse/pen on desktop: same idea for sideways page swipes.
  document.addEventListener("pointerdown", (e) => { if (e.pointerType !== "touch" && e.target.closest && e.target.closest(ZONES)) lock(); }, true);
  document.addEventListener("pointerup", (e) => { if (e.pointerType !== "touch") unlock(); }, true);
})();
