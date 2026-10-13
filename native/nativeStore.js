// Apple In-App Purchase bridge for the iPhone app (2026-10-13).
// window.CalmStore is only "available" inside the native app; on the web the
// Stripe/Lemon Squeezy flow is used instead. App Store 3.1.1: no external
// payment links inside the iPhone app.
(function () {
  "use strict";
  const plugin = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins && window.Capacitor.Plugins.CalmStore;
  const PLUS = "com.calmnav.companion.calmplus";
  const TIP = { 1: "com.calmnav.companion.tip1", 3: "com.calmnav.companion.tip3", 5: "com.calmnav.companion.tip5" };
  const KEY = "calmStore.plus.v1";
  let ownsPlus = false;
  try { ownsPlus = localStorage.getItem(KEY) === "1"; } catch (e) { /* ok */ }
  const listeners = [];
  function setPlus(v) {
    ownsPlus = !!v;
    try { localStorage.setItem(KEY, v ? "1" : "0"); } catch (e) { /* ok */ }
    listeners.forEach((fn) => { try { fn(ownsPlus); } catch (e) { /* ignore */ } });
  }
  async function refresh() {
    if (!plugin) return;
    try { const r = await plugin.entitlements(); setPlus((r.owned || []).includes(PLUS)); } catch (e) { /* offline: keep last known */ }
  }
  window.CalmStore = {
    available: !!plugin,
    ownsPlus: () => ownsPlus,
    onChange: (fn) => listeners.push(fn),
    async products() { return plugin ? (await plugin.products()).products || [] : []; },
    async buyPlus() { const r = await plugin.purchase({ id: PLUS }); if (r.ok) setPlus(true); return r; },
    async tip(euros) { return plugin.purchase({ id: TIP[euros] }); },
    async restore() { const r = await plugin.restore(); setPlus((r.owned || []).includes(PLUS)); return ownsPlus; },
  };
  refresh();
})();
