// "Report a problem or idea" in Settings (2026-10-13) → /api/feedback.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const form = $("fbForm");
  if (!form) return;
  let kind = "bug";
  $("fbKinds").addEventListener("click", (e) => {
    const b = e.target.closest("[data-kind]");
    if (!b) return;
    kind = b.dataset.kind;
    $("fbKinds").querySelectorAll("[data-kind]").forEach((x) => x.classList.toggle("active", x === b));
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("fbText").value.trim();
    if (text.length < 3) { $("fbMsg").textContent = "Tell us a little more."; return; }
    $("fbSend").disabled = true;
    const active = document.querySelector(".dot-btn.active");
    let version = "";
    try { version = ((await (await fetch("/sw.js", { cache: "no-store" })).text()).match(/calm-companion-v\d+/) || [""])[0]; } catch (err) { /* offline */ }
    try {
      const base = (window.CalmApp && CalmApp.apiBaseUrl) || "";
      const res = await fetch(base + "/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        kind, text, contact: $("fbContact").value,
        meta: { version, screen: active ? active.textContent.trim() : "", device: navigator.userAgent, theme: document.documentElement.dataset.theme || "" },
      }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't send");
      $("fbText").value = ""; $("fbContact").value = "";
      $("fbMsg").textContent = "Thank you! We read every message.";
    } catch (err) {
      $("fbMsg").textContent = navigator.onLine === false ? "You're offline — try again when you're connected." : err.message;
    } finally { $("fbSend").disabled = false; }
  });
})();
