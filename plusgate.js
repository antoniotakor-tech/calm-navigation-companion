// ---------------------------------------------------------------------------
// Calm+ extras gate (2026-10-13). Free features are never locked; extras
// marked .plus-only show the Calm+ flower and, without Calm+, explain
// instead of working. window.PlusGate.allowed() / .explain().
// ---------------------------------------------------------------------------
(function () {
  "use strict";
  function allowed() { return !!(window.CalmAccount && window.CalmAccount.isPlus()); }
  function explain() {
    if (window.CalmApp && window.CalmApp.toast) window.CalmApp.toast("✨ That's a Calm+ extra — €2.99 once (Community tab)");
  }
  function mark() { document.documentElement.classList.toggle("has-plus", allowed()); }
  window.PlusGate = { allowed, explain, mark };
  document.addEventListener("DOMContentLoaded", mark);
  setTimeout(mark, 2500);
  if (window.CalmAccount && window.CalmAccount.onChange) window.CalmAccount.onChange(mark);
})();
