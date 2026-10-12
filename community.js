// ---------------------------------------------------------------------------
// Community page (2026-10-12): profiles + a timeline of calm spots, calm
// routes and events, each with an optional photo. Server: /api/social/*.
// Rules (lengths, filter, kinds) come from socialvalidation.js so the phone
// rejects exactly what the server would, before anything is sent.
//
// Safety model = Calm Echoes: no passwords (device key), text filter, one
// report hides a post for everyone, block hides a person on this phone,
// photos are re-encoded on the device (strips GPS/EXIF) and can be deleted,
// and "Delete my profile" removes everything on the server.
// ---------------------------------------------------------------------------
(function () {
  "use strict";
  const S = window.SocialValidation;
  const $ = (id) => document.getElementById(id);
  const AVATAR_COLORS = { rose: "#E0559B", lilac: "#9B7BE0", mint: "#3FAE8C", sun: "#E2A93B", sky: "#4A9BD9", peach: "#EE8A62" };
  const KIND_LABEL = { spot: "Calm spot", route: "Calm route", event: "Event" };
  const KIND_ICON = { spot: "pin", route: "walk", event: "clock" };
  const PROFILE_CACHE = "calmCommunity.profile.v1";

  let app = null;
  let me = null; // { id, profile }
  let feedMode = "near";
  let composerKind = "spot";
  let composerPhoto = null;
  let mapMarkers = [];

  let loaded = false;
  function start() {
    app = window.CalmApp;
    if (!app || !S) return;
    try { me = JSON.parse(localStorage.getItem(PROFILE_CACHE) || "null"); } catch (e) { me = null; }
    renderMyProfile();
    wire();
    const fetchMe = () => api("/api/social/me", { token: app.deviceToken(), action: "get" }).then(setMe).catch(() => {});
    fetchMe();
    // Signing in on a new phone switches to the account's profile.
    if (window.CalmAccount) window.CalmAccount.onChange(() => { fetchMe(); if (loaded) loadFeed(); });
    // Load the timeline the first time someone opens the Community tab.
    const dot = $("dot-3");
    const loadOnce = () => { if (!loaded) { loaded = true; loadFeed(); } };
    dot && dot.addEventListener("click", loadOnce);
    const page = $("page-3");
    if (page && "IntersectionObserver" in window) {
      new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && loadOnce())).observe(page);
    }
  }
  if (window.CalmApp) start(); else window.addEventListener("calmapp:ready", start, { once: true });

  // ---- network --------------------------------------------------------------
  async function api(path, body) {
    const session = window.CalmAccount && window.CalmAccount.session();
    if (body && session) body = { ...body, session };
    const res = await fetch(app.apiBaseUrl + path, body
      ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : undefined);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
  }

  function setMe(data) {
    me = data && data.profile ? { id: data.id, profile: data.profile } : (data ? { id: data.id, profile: null } : null);
    try { localStorage.setItem(PROFILE_CACHE, JSON.stringify(me)); } catch (e) { /* not critical */ }
    renderMyProfile();
  }

  // ---- small render helpers ---------------------------------------------------
  function avatarEl(el, key) {
    el.innerHTML = CalmIcons.html("flower");
    el.style.color = AVATAR_COLORS[key] || AVATAR_COLORS.rose;
    el.style.background = (AVATAR_COLORS[key] || AVATAR_COLORS.rose) + "22";
  }
  function make(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function ago(ms) {
    const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    return Math.round(s / 86400) + " d ago";
  }
  function when(ms) {
    return new Date(ms).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  function distanceLabel(p) {
    const c = app.map.getCenter();
    const R = 6371000, toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(p.lat - c.lat), dLon = toRad(p.lon - c.lng);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(c.lat)) * Math.cos(toRad(p.lat)) * Math.sin(dLon / 2) ** 2;
    const d = 2 * R * Math.asin(Math.sqrt(a));
    return d < 1000 ? Math.round(d / 10) * 10 + " m" : (d / 1000).toFixed(1) + " km";
  }

  // ---- my profile -------------------------------------------------------------
  function renderMyProfile() {
    const p = me && me.profile;
    avatarEl($("cmMyAvatar"), p ? p.avatar : "rose");
    $("cmMyName").textContent = p ? p.nickname : "Your profile";
    $("cmMyBio").textContent = p ? (p.bio || "No bio yet.") : "Create a profile to share calm spots, routes and events.";
    $("cmEditProfileBtn").textContent = p ? "Edit" : "Create";
    $("cmDeleteAccountBtn").hidden = !p;
  }

  let chosenAvatar = "rose";
  function openProfileForm() {
    const p = me && me.profile;
    $("cmNameInput").value = p ? p.nickname : "";
    $("cmBioInput").value = p ? p.bio : "";
    chosenAvatar = p ? p.avatar : "rose";
    const row = $("cmAvatarRow");
    row.innerHTML = "";
    S.AVATARS.forEach((key) => {
      const b = make("button", "cm-avatar cm-avatar-pick");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", key);
      avatarEl(b, key);
      const sync = () => row.querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x === row.children[S.AVATARS.indexOf(chosenAvatar)])));
      b.addEventListener("click", () => { chosenAvatar = key; sync(); });
      row.appendChild(b);
      sync();
    });
    $("cmProfileError").textContent = "";
    $("cmProfileForm").hidden = false;
    $("cmProfileCard").hidden = true;
    $("cmNameInput").focus();
  }
  function closeProfileForm() { $("cmProfileForm").hidden = true; $("cmProfileCard").hidden = false; }

  async function saveProfile(e) {
    e.preventDefault();
    const profile = { nickname: $("cmNameInput").value, bio: $("cmBioInput").value, avatar: chosenAvatar };
    const check = S.validateProfile(profile);
    if (!check.valid) { $("cmProfileError").textContent = check.error; return; }
    $("cmProfileSave").disabled = true;
    try {
      setMe(await api("/api/social/me", { token: app.deviceToken(), action: "save", profile: check.value }));
      closeProfileForm();
      app.toast("Profile saved");
    } catch (err) {
      $("cmProfileError").textContent = err.message;
    } finally { $("cmProfileSave").disabled = false; }
  }

  async function deleteAccount() {
    if (window.CalmAccount && window.CalmAccount.session()) {
      if (await window.CalmAccount.deleteAccount()) { setMe({ id: me && me.id, profile: null }); closeProfileForm(); loadFeed(); }
      return;
    }
    if (!confirm("Delete your profile and every post you shared? This can't be undone.")) return;
    try {
      await api("/api/social/me", { token: app.deviceToken(), action: "delete" });
      setMe({ id: me && me.id, profile: null });
      closeProfileForm();
      loadFeed();
      app.toast("Your profile and posts were deleted");
    } catch (err) { $("cmProfileError").textContent = err.message; }
  }

  // ---- timeline ---------------------------------------------------------------
  async function loadFeed() {
    const list = $("cmFeed"), status = $("cmStatus");
    list.innerHTML = "";
    status.textContent = "Loading…";
    try {
      let posts;
      if (feedMode === "mine") {
        if (!me || !me.profile) { status.textContent = "Create a profile to start sharing."; return; }
        posts = (await api(`/api/social/profile/${encodeURIComponent(me.id)}`)).posts;
      } else {
        const c = app.map.getCenter();
        posts = (await api(`/api/social/posts?lat=${c.lat.toFixed(4)}&lon=${c.lng.toFixed(4)}&radius=10000`)).posts;
        posts = posts.filter((p) => !app.isBlocked(p.author.id));
        showOnMapMarkers(posts);
      }
      status.textContent = posts.length ? "" : (feedMode === "mine" ? "You haven't shared anything yet." : "Nothing shared around here yet — be the first to share a calm spot.");
      posts.forEach((p) => list.appendChild(card(p)));
    } catch (err) {
      status.textContent = navigator.onLine === false ? "You're offline — the timeline needs a connection." : err.message;
    }
  }

  function card(p) {
    const li = make("li", "cm-card cm-kind-" + p.kind);
    li.dataset.id = p.id;
    const head = make("div", "cm-card-head");
    const who = make("button", "cm-author");
    who.type = "button";
    const av = make("span", "cm-avatar cm-avatar-sm");
    avatarEl(av, p.author.avatar);
    who.append(av, make("span", "cm-author-name", p.author.nickname));
    if (p.author.plus) who.appendChild(make("span", "plus-badge", "Calm+"));
    who.addEventListener("click", () => openViewer(p.author.id));
    const badge = make("span", "cm-badge");
    badge.innerHTML = CalmIcons.html(KIND_ICON[p.kind]) + " ";
    badge.appendChild(document.createTextNode(KIND_LABEL[p.kind]));
    head.append(who, badge);
    li.appendChild(head);

    if (p.hasPhoto) {
      const img = make("img", "cm-photo");
      img.loading = "lazy";
      img.alt = p.title;
      img.src = `${app.apiBaseUrl}/api/social/photo/${encodeURIComponent(p.id)}`;
      li.appendChild(img);
    }
    li.appendChild(make("h3", "cm-title", p.title));
    if (p.eventAt) li.appendChild(make("div", "cm-when", when(p.eventAt)));
    if (p.body) li.appendChild(make("p", "cm-body", p.body));
    li.appendChild(make("div", "cm-meta", `${distanceLabel(p)} away · ${ago(p.createdAt)}`));

    const actions = make("div", "cm-actions");
    const show = make("button", "pill", p.kind === "route" ? "Show route" : "Show on map");
    show.type = "button";
    show.addEventListener("click", () => showPost(p));
    actions.appendChild(show);
    const mine = me && me.id === p.author.id;
    if (mine) {
      const del = make("button", "cm-link", "Delete");
      del.type = "button";
      del.addEventListener("click", async () => {
        if (!confirm("Delete this post?")) return;
        try { await api(`/api/social/posts/${encodeURIComponent(p.id)}/delete`, { token: app.deviceToken() }); li.remove(); } catch (err) { app.toast(err.message); }
      });
      actions.appendChild(del);
    } else {
      const rep = make("button", "cm-link", "Report");
      rep.type = "button";
      rep.addEventListener("click", () => toggleReasons(li, p));
      const block = make("button", "cm-link", "Block");
      block.type = "button";
      block.addEventListener("click", () => {
        if (!confirm(`Block ${p.author.nickname}? You won't see their posts or Echoes on this phone again.`)) return;
        app.blockAuthor(p.author.id);
        loadFeed();
      });
      actions.append(rep, block);
    }
    li.appendChild(actions);
    return li;
  }

  function toggleReasons(li, p) {
    let box = li.querySelector(".cm-reasons");
    if (box) { box.remove(); return; }
    box = make("div", "cm-reasons");
    box.appendChild(make("p", "cm-note", "What's wrong with it?"));
    [["offensive", "Offensive or hurtful"], ["personal-info", "Personal information or a recognisable person"], ["spam", "Spam or advertising"], ["other", "Something else"]].forEach(([reason, label]) => {
      const b = make("button", "pill", label);
      b.type = "button";
      b.addEventListener("click", async () => {
        try {
          await api(`/api/social/posts/${encodeURIComponent(p.id)}/report`, { reporterToken: app.deviceToken(), reason });
          li.remove();
          app.toast("Thanks — it's hidden while we review it");
        } catch (err) { app.toast(err.message); }
      });
      box.appendChild(b);
    });
    li.appendChild(box);
  }

  // ---- map --------------------------------------------------------------------
  function clearMarkers() { mapMarkers.forEach((m) => m.remove()); mapMarkers = []; }
  function flowerMarker(p, color) {
    const el = make("button", "cm-map-marker");
    el.type = "button";
    el.setAttribute("aria-label", `${KIND_LABEL[p.kind]}: ${p.title}`);
    el.innerHTML = CalmIcons.html(p.kind === "event" ? "clock" : "flower");
    el.style.color = color || AVATAR_COLORS[p.author.avatar] || AVATAR_COLORS.rose;
    el.addEventListener("click", (e) => { e.stopPropagation(); app.goToPage(3); highlight(p.id); });
    return new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(app.map);
  }
  function showOnMapMarkers(posts) {
    clearMarkers();
    posts.slice(0, 40).forEach((p) => mapMarkers.push(flowerMarker(p)));
  }
  function highlight(id) {
    setTimeout(() => {
      const li = Array.from($("cmFeed").children).find((x) => x.dataset.id === id);
      if (li) { li.scrollIntoView({ block: "center", behavior: "smooth" }); li.classList.add("cm-flash"); setTimeout(() => li.classList.remove("cm-flash"), 1600); }
    }, 350);
  }

  function showPost(p) {
    const map = app.map;
    app.goToPage(0);
    const src = map.getSource("community-route");
    const empty = { type: "FeatureCollection", features: [] };
    if (src) src.setData(empty);
    if (p.kind === "route" && p.route && p.route.length > 1) {
      const data = { type: "Feature", geometry: { type: "LineString", coordinates: p.route }, properties: {} };
      if (src) src.setData(data);
      else {
        map.addSource("community-route", { type: "geojson", data });
        map.addLayer({ id: "community-route", type: "line", source: "community-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": AVATAR_COLORS[p.author.avatar] || "#9B7BE0", "line-width": 5, "line-opacity": 0.85, "line-dasharray": [1.2, 1.6] } });
      }
      const b = p.route.reduce((bb, c) => bb.extend(c), new maplibregl.LngLatBounds(p.route[0], p.route[0]));
      setTimeout(() => map.fitBounds(b, { padding: 80, maxZoom: 16 }), 250);
    } else {
      setTimeout(() => map.flyTo({ center: [p.lon, p.lat], zoom: 16 }), 250);
    }
    if (!mapMarkers.length) mapMarkers.push(flowerMarker(p));
  }

  // ---- someone's profile --------------------------------------------------------
  async function openViewer(id) {
    const ov = $("cmProfileViewer");
    $("cmViewerName").textContent = "…";
    $("cmViewerBio").textContent = "";
    $("cmViewerFeed").innerHTML = "";
    ov.classList.add("open");
    try {
      const data = await api(`/api/social/profile/${encodeURIComponent(id)}`);
      avatarEl($("cmViewerAvatar"), data.profile.avatar);
      $("cmViewerName").textContent = data.profile.nickname;
      $("cmViewerBio").textContent = data.profile.bio || "";
      data.posts.forEach((p) => $("cmViewerFeed").appendChild(card(p)));
    } catch (err) { $("cmViewerName").textContent = err.message; }
  }

  // ---- composer -----------------------------------------------------------------
  function setKind(kind) {
    composerKind = kind;
    $("cmKindRow").querySelectorAll("[data-kind]").forEach((b) => b.classList.toggle("active", b.dataset.kind === kind));
    $("cmEventInput").hidden = $("cmEventLabel").hidden = kind !== "event";
    const route = app.currentRoute();
    $("cmWhereNote").textContent = kind === "route"
      ? (route ? "Shares the route you have on the map right now." : "Plan a route on the map first, then share it here.")
      : "Uses the centre of the map — move the map to the exact spot first.";
  }

  function openComposer() {
    if (!me || !me.profile) { openProfileForm(); $("cmProfileError").textContent = "Create your profile first, then you can share."; return; }
    $("cmComposerForm").reset();
    composerPhoto = null;
    $("cmPhotoPreview").hidden = true;
    $("cmPhotoLabel").textContent = "Add a photo (optional)";
    $("cmComposerError").textContent = "";
    setKind(app.currentRoute() ? "route" : "spot");
    $("cmComposer").classList.add("open");
  }
  function closeComposer() { $("cmComposer").classList.remove("open"); }

  /** Re-encodes on the device: max 1080 px, JPEG — also strips EXIF/GPS. */
  async function compressPhoto(file) {
    const bmp = await createImageBitmap(file);
    let size = 1080, quality = 0.75, url = "";
    for (let tries = 0; tries < 5; tries++) {
      const scale = Math.min(1, size / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      url = c.toDataURL("image/jpeg", quality);
      if (url.length <= S.LIMITS.photoChars) return url;
      size *= 0.8; quality -= 0.08;
    }
    throw new Error("That photo is too large.");
  }

  async function submitPost(e) {
    e.preventDefault();
    const c = app.map.getCenter();
    const route = app.currentRoute();
    const post = {
      kind: composerKind,
      title: $("cmTitleInput").value,
      body: $("cmBodyInput").value,
      lat: c.lat, lon: c.lng,
      photo: composerPhoto,
    };
    if (composerKind === "route" && route) {
      post.route = route.coordinates;
      post.lat = route.coordinates[0][1];
      post.lon = route.coordinates[0][0];
    }
    if (composerKind === "event") post.eventAt = $("cmEventInput").value ? new Date($("cmEventInput").value).getTime() : NaN;
    const check = S.validatePost(post);
    if (!check.valid) { $("cmComposerError").textContent = check.error; return; }
    $("cmComposerPost").disabled = true;
    try {
      const data = await api("/api/social/posts", { token: app.deviceToken(), post: check.value });
      closeComposer();
      $("cmStatus").textContent = "";
      $("cmFeed").prepend(card(data.post));
      app.toast("Shared — thank you!");
    } catch (err) {
      $("cmComposerError").textContent = err.message;
    } finally { $("cmComposerPost").disabled = false; }
  }

  // ---- wiring -------------------------------------------------------------------
  function wire() {
    $("cmEditProfileBtn").addEventListener("click", openProfileForm);
    $("cmProfileCancel").addEventListener("click", closeProfileForm);
    $("cmProfileForm").addEventListener("submit", saveProfile);
    $("cmDeleteAccountBtn").addEventListener("click", deleteAccount);
    $("cmShareBtn").addEventListener("click", openComposer);
    $("cmComposerCancel").addEventListener("click", closeComposer);
    $("cmComposerForm").addEventListener("submit", submitPost);
    $("cmKindRow").addEventListener("click", (e) => { const b = e.target.closest("[data-kind]"); if (b) setKind(b.dataset.kind); });
    $("cmPhotoInput").addEventListener("change", async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      $("cmPhotoLabel").textContent = "Preparing photo…";
      try {
        composerPhoto = await compressPhoto(f);
        $("cmPhotoPreview").src = composerPhoto;
        $("cmPhotoPreview").hidden = false;
        $("cmPhotoLabel").textContent = "Change photo";
      } catch (err) { composerPhoto = null; $("cmComposerError").textContent = err.message; $("cmPhotoLabel").textContent = "Add a photo (optional)"; }
    });
    $("cmViewerClose").addEventListener("click", () => $("cmProfileViewer").classList.remove("open"));
    document.querySelectorAll("[data-feed]").forEach((b) => b.addEventListener("click", () => {
      feedMode = b.dataset.feed;
      document.querySelectorAll("[data-feed]").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-selected", String(x === b)); });
      loadFeed();
    }));
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      closeComposer();
      $("cmProfileViewer").classList.remove("open");
    });
  }
})();
