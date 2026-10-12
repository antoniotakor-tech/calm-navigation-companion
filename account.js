// ---------------------------------------------------------------------------
// Account layer (2026-10-12): passkey sign-in + Calm+ + sync between devices.
//
// Passkeys (Face ID / Touch ID / device PIN) instead of passwords: nothing to
// leak or phish, no email needed, and they sync through iCloud Keychain so a
// new iPhone just works. The server code is functions/api/auth/*.
//
// Calm+ (Stripe, functions/api/billing/*), pay once — no subscription. The
// core app and the community stay free. Calm+ adds sync of saved places,
// ratings and settings across devices, 20 posts/day instead of 3, and a badge. Until
// Stripe keys are configured it shows "coming soon — notify me".
// ---------------------------------------------------------------------------
(function () {
  "use strict";
  const SESSION_KEY = "calmAccount.session.v1";
  const ACCOUNT_KEY = "calmAccount.account.v1";
  const SYNCED_KEY = "calmAccount.syncedAt.v1";
  const SYNC_KEYS = ["calmcompanion.places.v1", "calmcompanion.prefs.v1", "calmRec.prefs.v1", "calmEchoes.blockedAuthors"];
  const $ = (id) => document.getElementById(id);
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };

  let app = null;
  let account = null;
  try { account = JSON.parse(ls.get(ACCOUNT_KEY) || "null"); } catch (e) { account = null; }
  let billing = { enabled: false, prices: {} };
  const listeners = [];

  const api = {
    session: () => ls.get(SESSION_KEY),
    account: () => account,
    isPlus: () => !!account && account.plan === "plus",
    supported: () => !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create),
    onChange: (fn) => listeners.push(fn),
  };
  window.CalmAccount = api;

  function setAccount(a, session) {
    account = a;
    if (session !== undefined) ls.set(SESSION_KEY, session);
    ls.set(ACCOUNT_KEY, a ? JSON.stringify(a) : null);
    render();
    listeners.forEach((fn) => { try { fn(a); } catch (e) { /* listener error */ } });
  }

  async function post(path, body) {
    const res = await fetch((app ? app.apiBaseUrl : "") + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.error || "Something went wrong. Please try again."); err.status = res.status; throw err; }
    return data;
  }

  // ---- WebAuthn plumbing (base64url <-> ArrayBuffer) ----------------------------
  const b64 = {
    enc(buf) { let s = ""; new Uint8Array(buf).forEach((b) => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); },
    dec(str) { const s = str.replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(s + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)).buffer; },
  };
  function friendly(err) {
    if (err && (err.name === "NotAllowedError" || err.name === "AbortError")) return "Cancelled — nothing was changed.";
    if (err && err.name === "InvalidStateError") return "This device already has a passkey for your profile — use Sign in.";
    return (err && err.message) || "Something went wrong. Please try again.";
  }

  async function addPasskey() {
    const msg = $("acMsg");
    msg.textContent = "";
    try {
      const opts = await post("/api/auth/register/options", { token: app.deviceToken(), session: api.session() });
      const pk = opts.publicKey;
      const cred = await navigator.credentials.create({ publicKey: {
        ...pk,
        challenge: b64.dec(pk.challenge),
        user: { ...pk.user, id: b64.dec(pk.user.id) },
        excludeCredentials: (pk.excludeCredentials || []).map((c) => ({ ...c, id: b64.dec(c.id) })),
      } });
      const data = await post("/api/auth/register/verify", { challengeId: opts.challengeId, credential: {
        id: cred.id, type: cred.type,
        response: { clientDataJSON: b64.enc(cred.response.clientDataJSON), attestationObject: b64.enc(cred.response.attestationObject) },
      } });
      setAccount(data.account, data.session);
      app.toast("Passkey saved — your profile is protected");
      syncNow("pull");
    } catch (err) {
      if (err.status === 409) { msg.textContent = err.message; return; }
      msg.textContent = friendly(err);
    }
  }

  async function signIn() {
    const msg = $("acMsg");
    msg.textContent = "";
    try {
      const opts = await post("/api/auth/login/options", {});
      const cred = await navigator.credentials.get({ publicKey: { ...opts.publicKey, challenge: b64.dec(opts.publicKey.challenge) } });
      const data = await post("/api/auth/login/verify", { challengeId: opts.challengeId, credential: {
        id: cred.id, type: cred.type,
        response: {
          clientDataJSON: b64.enc(cred.response.clientDataJSON),
          authenticatorData: b64.enc(cred.response.authenticatorData),
          signature: b64.enc(cred.response.signature),
        },
      } });
      setAccount(data.account, data.session);
      app.toast("Signed in");
      syncNow("pull");
    } catch (err) { msg.textContent = friendly(err); }
  }

  async function signOut() {
    try { await post("/api/account", { session: api.session(), action: "logout" }); } catch (e) { /* signing out locally anyway */ }
    setAccount(null, null);
    ls.set(SYNCED_KEY, null);
    app.toast("Signed out on this device");
  }

  async function deleteAccount() {
    if (!confirm("Delete your account, passkey sign-in, profile and every post? This can't be undone.")) return false;
    try {
      const r = await post("/api/account", { session: api.session(), action: "delete" });
      setAccount(null, null);
      app.toast("Your account was deleted");
      if (r.note) alert(r.note);
      return true;
    } catch (err) { app.toast(err.message); return false; }
  }
  api.deleteAccount = deleteAccount;

  async function refresh() {
    if (!api.session()) return;
    try { setAccount((await post("/api/account", { session: api.session(), action: "get" })).account); }
    catch (err) { if (err.status === 401) setAccount(null, null); }
  }

  // ---- Calm+ --------------------------------------------------------------------
  async function loadBilling() {
    try { billing = await post("/api/billing", { action: "config" }); } catch (e) { /* offline: keep default */ }
    render();
  }
  async function buy(plan) {
    if (!api.session()) { $("acMsg").textContent = "First add a passkey, so Calm+ is yours on every device."; return; }
    try { location.href = (await post("/api/billing", { session: api.session(), action: "checkout", plan })).url; }
    catch (err) { $("acMsg").textContent = err.message; }
  }
  async function manage() {
    try { location.href = (await post("/api/billing", { session: api.session(), action: "portal" })).url; }
    catch (err) { $("acMsg").textContent = err.message; }
  }
  async function notifyMe() {
    try {
      await post("/api/billing", { session: api.session(), token: app.deviceToken(), action: "notify" });
      ls.set("calmAccount.notified.v1", "1");
      render();
      app.toast("Thanks — we'll let you know");
    } catch (err) { $("acMsg").textContent = err.message; }
  }

  // ---- sync (Calm+) ---------------------------------------------------------------
  function snapshot() {
    const out = {};
    SYNC_KEYS.forEach((k) => { const v = ls.get(k); if (v != null) out[k] = v; });
    return out;
  }
  let lastPushed = null;
  async function syncNow(direction) {
    if (!api.isPlus() || !api.session()) return;
    try {
      if (direction === "pull") {
        const r = await post("/api/account", { session: api.session(), action: "sync-get" });
        const localAt = Number(ls.get(SYNCED_KEY) || 0);
        if (r.data && r.syncAt && r.syncAt > localAt) {
          Object.entries(r.data).forEach(([k, v]) => { if (SYNC_KEYS.includes(k)) ls.set(k, v); });
          ls.set(SYNCED_KEY, String(r.syncAt));
          app.toast("Synced from your other devices");
          setTimeout(() => location.reload(), 900); // settings/places are read at startup
          return;
        }
      }
      const snap = JSON.stringify(snapshot());
      if (snap === lastPushed) return;
      const r = await post("/api/account", { session: api.session(), action: "sync-put", data: JSON.parse(snap) });
      lastPushed = snap;
      ls.set(SYNCED_KEY, String(r.syncAt));
      render();
    } catch (e) { /* offline — next time */ }
  }

  // ---- Calm+ banner: swipe it away (or ×); "About Calm+" brings it back ------------
  const DISMISS_KEY = "calmAccount.plusDismissed.v1";
  function setPlusHidden(hidden) {
    ls.set(DISMISS_KEY, hidden ? "1" : null);
    const card = $("plusCard");
    card.style.transform = "";
    card.style.opacity = "";
    card.hidden = hidden && !api.isPlus();
    $("plusReopen").hidden = !card.hidden;
  }
  function wireSwipe(card) {
    let startX = null, dx = 0, id = null;
    card.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      startX = e.clientX; dx = 0; id = e.pointerId;
      card.style.transition = "none";
    });
    card.addEventListener("pointermove", (e) => {
      if (startX == null || e.pointerId !== id) return;
      dx = e.clientX - startX;
      if (Math.abs(dx) > 8) {
        card.style.transform = `translateX(${dx}px) rotate(${dx / 30}deg)`;
        card.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / 260));
      }
    });
    const end = () => {
      if (startX == null) return;
      startX = null;
      card.style.transition = "transform .28s ease, opacity .28s ease";
      if (Math.abs(dx) > 90) {
        card.style.transform = `translateX(${dx > 0 ? 120 : -120}%) rotate(${dx > 0 ? 12 : -12}deg)`;
        card.style.opacity = "0";
        setTimeout(() => { card.style.transition = ""; setPlusHidden(true); }, 280);
      } else { card.style.transform = ""; card.style.opacity = ""; }
    };
    card.addEventListener("pointerup", end);
    card.addEventListener("pointercancel", end);
  }

  // ---- UI -----------------------------------------------------------------------
  function render() {
    const box = $("accountBox");
    if (!box) return;
    const signedIn = !!account && !!api.session();
    $("acSignedOut").hidden = signedIn;
    $("acSignedIn").hidden = !signedIn;
    $("acUnsupported").hidden = api.supported();
    if (!api.supported()) { $("acAddPasskey").disabled = $("acSignIn").disabled = true; }
    if (signedIn) {
      $("acStatus").textContent = api.isPlus()
        ? "Calm+ · synced " + (account.syncAt || Number(ls.get(SYNCED_KEY)) ? new Date(account.syncAt || Number(ls.get(SYNCED_KEY))).toLocaleString() : "soon")
        : "Free plan";
      $("acPlusBadge").hidden = !api.isPlus();
    }
    // Calm+ card
    const plus = api.isPlus();
    $("plusBuy").hidden = plus || !billing.enabled;
    $("plusManage").hidden = !(plus && account && account.billing);
    $("plusActive").hidden = !plus;
    $("plusSoon").hidden = plus || billing.enabled;
    $("plusNotify").textContent = ls.get("calmAccount.notified.v1") ? "We'll let you know ✓" : "Notify me when it opens";
    $("plusNotify").disabled = !!ls.get("calmAccount.notified.v1");
    const once = billing.prices && billing.prices.once;
    if (once) $("plusOnce").textContent = "Get Calm+ · " + once.label;
  }

  function start() {
    app = window.CalmApp;
    if (!app) return;
    $("acAddPasskey").addEventListener("click", addPasskey);
    $("acSignIn").addEventListener("click", signIn);
    $("acSignOut").addEventListener("click", signOut);
    $("plusOnce").addEventListener("click", () => buy("once"));
    $("plusManage").addEventListener("click", manage);
    $("plusNotify").addEventListener("click", notifyMe);
    $("plusClose").addEventListener("click", () => setPlusHidden(true));
    $("plusReopen").addEventListener("click", () => setPlusHidden(false));
    wireSwipe($("plusCard"));
    setPlusHidden(!!ls.get(DISMISS_KEY));
    render();
    loadBilling();
    refresh().then(() => syncNow("pull"));
    const q = new URLSearchParams(location.search).get("plus");
    if (q) {
      history.replaceState(null, "", location.pathname);
      if (q === "success") setTimeout(() => { refresh(); app.toast("Welcome to Calm+ — thank you for supporting the app"); }, 1500);
    }
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") syncNow("push"); });
    setInterval(() => syncNow("push"), 60000);
  }
  if (window.CalmApp) start(); else window.addEventListener("calmapp:ready", start, { once: true });
})();
