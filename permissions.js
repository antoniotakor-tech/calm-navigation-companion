// Permission timing (2026-10-13): nothing is asked on load. Location is asked
// the first time you tap "Find calm route"; notifications only when you start
// something that shows one (Android navigation card). Each system prompt is
// preceded by one sentence saying why, and a denial is remembered so a return
// visit shows a clear fallback instead of a dead button or a prompt loop.
(function (root) {
  const DENIED_KEY = "calmPerm.location.denied.v1";
  const NOTIF_KEY = "calmPerm.notifications.explained.v1";

  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {}
    return null;
  }

  function isNative() { return !!(root.Capacitor && root.Capacitor.isNativePlatform && root.Capacitor.isNativePlatform()); }

  // "granted" | "denied" | "prompt" — never triggers a system dialog.
  async function locationState() {
    try {
      if (isNative()) {
        const s = await root.Capacitor.Plugins.CalmNavBackground.getPermissionStatus();
        if (s.foreground === "granted") return "granted";
        if (s.foreground === "denied") return "denied";
        return store(DENIED_KEY) ? "denied" : "prompt";
      }
      if (navigator.permissions && navigator.permissions.query) {
        const s = await navigator.permissions.query({ name: "geolocation" });
        if (s.state === "granted") { store(DENIED_KEY, null); return "granted"; }
        if (s.state === "denied") return "denied";
      }
    } catch (e) {}
    return store(DENIED_KEY) ? "denied" : "prompt";
  }

  // One-sentence explanation sheet. Resolves true (Continue) or false (Not now).
  function explain(text, okLabel) {
    return new Promise((resolve) => {
      const wrap = document.createElement("div");
      wrap.className = "perm-explain";
      wrap.setAttribute("role", "dialog");
      wrap.setAttribute("aria-modal", "true");
      wrap.innerHTML = '<div class="perm-explain-card"><p></p><div class="perm-explain-actions">' +
        '<button type="button" class="perm-later">Not now</button><button type="button" class="perm-ok"></button></div></div>';
      wrap.querySelector("p").textContent = text;
      wrap.querySelector(".perm-ok").textContent = okLabel || "Continue";
      const done = (v) => { wrap.remove(); resolve(v); };
      wrap.querySelector(".perm-ok").addEventListener("click", () => done(true));
      wrap.querySelector(".perm-later").addEventListener("click", () => done(false));
      wrap.addEventListener("click", (e) => { if (e.target === wrap) done(false); });
      document.body.appendChild(wrap);
      wrap.querySelector(".perm-ok").focus();
    });
  }

  // Ask for location the polite way. Returns "granted" | "denied" | "dismissed".
  // On the web the real prompt is raised by the caller's getCurrentPosition;
  // a code-1 error there must be reported back with markLocationDenied().
  async function requestLocation() {
    const state = await locationState();
    if (state === "granted") return "granted";
    if (state === "denied") return "denied";
    const ok = await explain("Calm Companion uses your location to start your route from where you are and find quiet places nearby.", "Use my location");
    if (!ok) return "dismissed";
    if (isNative()) {
      const req = await root.Capacitor.Plugins.CalmNavBackground.requestForegroundLocationPermission();
      if (!req.granted) { store(DENIED_KEY, "1"); return "denied"; }
      store(DENIED_KEY, null);
    }
    return "granted";
  }

  function markLocationDenied() { store(DENIED_KEY, "1"); }
  function markLocationGranted() { store(DENIED_KEY, null); }

  // Notifications are only needed by native Android navigation (the
  // lock-screen guidance card). Explain once, right before the system asks.
  async function beforeNotificationNeed() {
    const android = isNative() && root.Capacitor.getPlatform && root.Capacitor.getPlatform() === "android";
    if (!android || store(NOTIF_KEY)) return true;
    store(NOTIF_KEY, "1");
    await explain("Next, allow notifications so your directions stay visible on the lock screen while you walk — navigation still works if you say no.", "OK");
    return true;
  }

  const api = { locationState, requestLocation, markLocationDenied, markLocationGranted, beforeNotificationNeed, explain };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CalmPermissions = api;
})(typeof window !== "undefined" ? window : globalThis);
