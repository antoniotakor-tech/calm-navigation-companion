// "Support the maker" tips (2026-10-13) → /api/billing { action: "tip" }.
(function () {
  "use strict";
  const card = document.getElementById("tipCard");
  if (!card) return;
  const msg = document.getElementById("tipMsg");
  card.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-tip]");
    if (!b) return;
    b.disabled = true;
    // iPhone app: tips go through Apple In-App Purchase (App Store 3.1.1).
    if (window.CalmStore && window.CalmStore.available) {
      try {
        const r = await window.CalmStore.tip(Number(b.dataset.tip));
        msg.textContent = r.ok ? "Thank you so much ♥" : (r.pending ? "Waiting for approval." : "");
      } catch (err) { msg.textContent = "The tip didn't go through."; }
      b.disabled = false;
      return;
    }
    try {
      const base = (window.CalmApp && CalmApp.apiBaseUrl) || "";
      const res = await fetch(base + "/api/billing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "tip", amount: Number(b.dataset.tip) }) });
      const data = await res.json().catch(() => ({}));
      if (data.url) { location.href = data.url; return; }
      if (data.comingSoon) { msg.textContent = "Thank you! Tips open soon — we've counted your support ♥"; return; }
      msg.textContent = data.error || "Couldn't start the tip — try again later.";
    } catch (err) {
      msg.textContent = "You're offline — try again later.";
    } finally { b.disabled = false; }
  });
  if (new URLSearchParams(location.search).get("tip") === "thanks") {
    history.replaceState(null, "", location.pathname);
    setTimeout(() => window.CalmApp && CalmApp.toast("Thank you for supporting Calm Companion ♥"), 1500);
  }
})();
