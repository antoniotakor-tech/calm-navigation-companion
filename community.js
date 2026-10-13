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
  let composerPhotos = [];
  let composerFix = null; // { lat, lon, accuracy?, source: "gps" | "photo" | "map" }
  let pickMap = null;
  let feedCenter = null;
  let mapMarkers = []; // temporary marker for "Show on map" of a single post

  let loaded = false;
  function start() {
    app = window.CalmApp;
    if (!app || !S) return;
    try { me = JSON.parse(localStorage.getItem(PROFILE_CACHE) || "null"); } catch (e) { me = null; }
    renderMyProfile();
    wire();
    mainLayer = postLayer(app.map);
    const fetchMe = () => api("/api/social/me", { token: app.deviceToken(), action: "get" }).then(setMe).catch(() => {});
    fetchMe();
    // Signing in on a new phone switches to the account's profile.
    if (window.CalmAccount) window.CalmAccount.onChange(() => { fetchMe(); if (loaded) loadFeed(); });
    // Load the timeline the first time someone opens the Community tab.
    const dot = $("dot-3");
    const loadOnce = () => {
      if (!loaded) { loaded = true; loadFeed(); }
      initCommunityMap();
      setTimeout(() => communityMap && communityMap.resize(), 80);
    };
    dot && dot.addEventListener("click", loadOnce);
    const page = $("page-3");
    if (page && "IntersectionObserver" in window) {
      new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && loadOnce())).observe(page);
    }
  }

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

  // ---- where you are -------------------------------------------------------------
  // A FRESH, precise fix: never reuse a cached position (that's how a post
  // ended up far from where it was made). Listens for up to 10 s and keeps
  // the most accurate reading, finishing early once it's within 25 m.
  // ask=false (the feed): never raises a permission prompt — it just uses the
  // map centre unless location was already allowed. ask=true (sharing a spot):
  // explains why first, then asks (2026-10-13).
  async function locate(ask) {
    const P = window.CalmPermissions;
    if (P) {
      const st = ask ? await P.requestLocation() : await P.locationState();
      if (st === "denied") throw new Error("Location is off for this app — drag the map to the spot, or allow location in your phone's Settings.");
      if (st !== "granted") throw new Error("No problem — drag the map to the spot instead.");
    }
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("This device can't share its location."));
      let best = null, done = false;
      const finish = () => {
        if (done) return;
        done = true;
        navigator.geolocation.clearWatch(id);
        clearTimeout(timer);
        if (best) resolve(best);
        else reject(new Error("Couldn't find your location — try again outside, or drag the map to the spot."));
      };
      const id = navigator.geolocation.watchPosition(
        (p) => {
          const fix = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) };
          if (!best || fix.accuracy < best.accuracy) best = fix;
          if (best.accuracy <= 25) finish();
        },
        (e) => { if (e.code === 1) { if (P) P.markLocationDenied(); done = true; navigator.geolocation.clearWatch(id); clearTimeout(timer); reject(new Error("Allow location for this app so your post is pinned where you are — or drag the map to the spot.")); } },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
      const timer = setTimeout(finish, 10000);
    });
  }
  function origin() {
    if (feedCenter) return feedCenter;
    const f = app.lastFix && app.lastFix();
    if (f) return { lat: f[0], lon: f[1] };
    const c = app.map.getCenter();
    return { lat: c.lat, lon: c.lng };
  }

  // ---- small render helpers ---------------------------------------------------
  function avatarEl(el, key) {
    el.innerHTML = CalmIcons.html("flower");
    el.style.color = AVATAR_COLORS[key] || AVATAR_COLORS.rose;
    el.style.setProperty("--av", AVATAR_COLORS[key] || AVATAR_COLORS.rose);
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
    const c = origin();
    const R = 6371000, toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(p.lat - c.lat), dLon = toRad(p.lon - c.lon);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(c.lat)) * Math.cos(toRad(p.lat)) * Math.sin(dLon / 2) ** 2;
    const d = 2 * R * Math.asin(Math.sqrt(a));
    return d < 1000 ? Math.round(d / 10) * 10 + " m" : (d / 1000).toFixed(1) + " km";
  }

  // ---- my profile -------------------------------------------------------------
  function renderMyProfile() {
    const p = me && me.profile;
    setTimeout(loadMyMusic, 0);
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
    $("cmAgeOk").checked = !!p; // existing profiles already confirmed
    $("cmProfileForm").hidden = false;
    $("cmProfileCard").hidden = true;
    $("cmNameInput").focus();
  }
  function closeProfileForm() { $("cmProfileForm").hidden = true; $("cmProfileCard").hidden = false; }

  async function saveProfile(e) {
    e.preventDefault();
    const profile = { nickname: $("cmNameInput").value, bio: $("cmBioInput").value, avatar: chosenAvatar, ageConfirmed: $("cmAgeOk").checked };
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
        try { feedCenter = await locate(); } catch (e) { feedCenter = null; }
        const c = origin();
        posts = (await api(`/api/social/posts?lat=${c.lat.toFixed(4)}&lon=${c.lon.toFixed(4)}&radius=10000`)).posts;
        posts = posts.filter((p) => !app.isBlocked(p.author.id));
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

    if (p.hasPhoto) li.appendChild(gallery(p));
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

  // Swipeable photo strip (scroll-snap) with dots; tap opens full screen.
  function photoUrl(p, i) { return `${app.apiBaseUrl}/api/social/photo/${encodeURIComponent(p.id)}?i=${i}`; }
  function gallery(p) {
    const n = p.photoCount || 1;
    const wrap = make("div", "cm-gallery");
    const strip = make("div", "cm-gallery-strip");
    for (let i = 0; i < n; i++) {
      const img = make("img", "cm-photo");
      img.loading = "lazy";
      img.alt = `${p.title} — photo ${i + 1} of ${n}`;
      img.src = photoUrl(p, i);
      img.addEventListener("click", () => openLightbox(p, i));
      strip.appendChild(img);
    }
    wrap.appendChild(strip);
    if (n > 1) {
      const dots = make("div", "cm-gallery-dots");
      for (let i = 0; i < n; i++) dots.appendChild(make("span", i === 0 ? "on" : ""));
      strip.addEventListener("scroll", () => {
        const i = Math.round(strip.scrollLeft / strip.clientWidth);
        Array.from(dots.children).forEach((d, k) => d.classList.toggle("on", k === i));
      }, { passive: true });
      wrap.appendChild(dots);
    }
    return wrap;
  }
  function openLightbox(p, start) {
    const ov = make("div", "cm-lightbox");
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-label", "Photos");
    const strip = make("div", "cm-lightbox-strip");
    for (let i = 0; i < (p.photoCount || 1); i++) {
      const img = make("img");
      img.src = photoUrl(p, i);
      img.alt = `${p.title} — photo ${i + 1}`;
      strip.appendChild(img);
    }
    const close = make("button", "cm-lightbox-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close photos");
    const done = () => { ov.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") done(); };
    close.addEventListener("click", done);
    ov.addEventListener("click", (e) => { if (e.target === ov || e.target === strip) done(); });
    document.addEventListener("keydown", onKey);
    ov.append(strip, close);
    document.body.appendChild(ov);
    requestAnimationFrame(() => { strip.scrollLeft = start * strip.clientWidth; });
    close.focus();
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
  // A layer of post markers on a map: photo bubbles (or a flower / clock),
  // reloaded for whatever area the map shows. Used twice: on the main map
  // and on the Community tab's own map.
  function postMarker(map, p) {
    const el = make("button", "cm-map-marker" + (p.hasPhoto ? " cm-map-photo" : ""));
    el.type = "button";
    el.setAttribute("aria-label", `${KIND_LABEL[p.kind]}: ${p.title}`);
    if (p.hasPhoto) {
      const img = make("img");
      img.src = photoUrl(p, 0);
      img.alt = "";
      img.loading = "lazy";
      el.appendChild(img);
    } else {
      el.innerHTML = CalmIcons.html(p.kind === "event" ? "clock" : p.kind === "route" ? "walk" : "flower");
      el.style.color = AVATAR_COLORS[p.author.avatar] || AVATAR_COLORS.rose;
    }
    el.addEventListener("click", (e) => { e.stopPropagation(); openPopup(map, p); });
    return new maplibregl.Marker({ element: el, anchor: p.hasPhoto ? "bottom" : "center" }).setLngLat([p.lon, p.lat]).addTo(map);
  }
  function openPopup(map, p) {
    const box = make("div", "cm-pop");
    if (p.hasPhoto) {
      const img = make("img", "cm-pop-photo");
      img.src = photoUrl(p, 0);
      img.alt = p.title;
      img.addEventListener("click", () => openLightbox(p, 0));
      box.appendChild(img);
    }
    const badge = make("div", "cm-pop-kind");
    badge.innerHTML = CalmIcons.html(KIND_ICON[p.kind]) + " ";
    badge.appendChild(document.createTextNode(KIND_LABEL[p.kind] + (p.eventAt ? " · " + when(p.eventAt) : "")));
    box.append(badge, make("div", "cm-pop-title", p.title));
    if (p.body) box.appendChild(make("div", "cm-pop-body", p.body.length > 120 ? p.body.slice(0, 117) + "…" : p.body));
    const who = make("button", "cm-link", "by " + p.author.nickname);
    who.type = "button";
    who.addEventListener("click", () => openViewer(p.author.id));
    const go = make("button", "pill", "Take me there");
    go.type = "button";
    go.addEventListener("click", () => { app.goToPage(0); app.navigateTo && app.navigateTo(p.title, p.lat, p.lon); });
    const row = make("div", "cm-pop-actions");
    row.append(go, who);
    box.appendChild(row);
    if (p.kind === "route" && p.route) {
      const show = make("button", "pill", "Show route");
      show.type = "button";
      show.addEventListener("click", () => showPost(p));
      row.prepend(show);
    }
    // Slide the map so the card has room above the marker, then open it there.
    const h = map.getContainer().clientHeight;
    map.easeTo({ center: [p.lon, p.lat], offset: [0, Math.min(150, h * 0.32)], duration: 350 });
    new maplibregl.Popup({ offset: p.hasPhoto ? 46 : 20, maxWidth: "260px", className: "cm-popup", anchor: "bottom" }).setLngLat([p.lon, p.lat]).setDOMContent(box).addTo(map);
  }
  function postLayer(map) {
    const markers = new Map();
    let timer = null, seq = 0;
    async function reload() {
      const mySeq = ++seq;
      const b = map.getBounds(), c = map.getCenter();
      const ne = b.getNorthEast();
      const R = 6371000, toRad = (x) => (x * Math.PI) / 180;
      const radius = Math.min(25000, Math.max(500, R * Math.acos(Math.min(1, Math.sin(toRad(c.lat)) * Math.sin(toRad(ne.lat)) + Math.cos(toRad(c.lat)) * Math.cos(toRad(ne.lat)) * Math.cos(toRad(ne.lng - c.lng))))));
      let posts;
      try { posts = (await api(`/api/social/posts?lat=${c.lat.toFixed(4)}&lon=${c.lng.toFixed(4)}&radius=${Math.round(radius)}`)).posts; } catch (e) { return; }
      if (mySeq !== seq) return;
      posts = posts.filter((p) => !app.isBlocked(p.author.id)).slice(0, 60);
      const keep = new Set(posts.map((p) => p.id));
      markers.forEach((m, id) => { if (!keep.has(id)) { m.remove(); markers.delete(id); } });
      posts.forEach((p) => { if (!markers.has(p.id)) markers.set(p.id, postMarker(map, p)); });
    }
    const schedule = () => { clearTimeout(timer); timer = setTimeout(reload, 700); };
    map.on("moveend", schedule);
    if (map.loaded()) schedule(); else map.once("load", schedule);
    return {
      reload: schedule,
      add(p) { if (!markers.has(p.id)) markers.set(p.id, postMarker(map, p)); },
      remove(id) { const m = markers.get(id); if (m) { m.remove(); markers.delete(id); } },
    };
  }
  let mainLayer = null, communityMap = null, communityLayer = null;
  function showOnMapMarkers() { /* markers now come from the map layers */ }
  function flowerMarker(p) { return postMarker(app.map, p); }
  function initCommunityMap() {
    if (communityMap || !window.maplibregl) return;
    const c = origin();
    communityMap = new maplibregl.Map({ container: "cmMap", style: app.map.getStyle(), center: [c.lon, c.lat], zoom: Math.max(13, app.map.getZoom()), attributionControl: { compact: true } });
    communityMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    communityLayer = postLayer(communityMap);
    // Open on people's posts: frame you + the posts around you (up to 25 km).
    communityMap.once("load", async () => {
      try {
        const posts = (await api(`/api/social/posts?lat=${c.lat.toFixed(4)}&lon=${c.lon.toFixed(4)}&radius=25000`)).posts.filter((p) => !app.isBlocked(p.author.id));
        if (!posts.length) return;
        const b = new maplibregl.LngLatBounds([c.lon, c.lat], [c.lon, c.lat]);
        posts.slice(0, 40).forEach((p) => b.extend([p.lon, p.lat]));
        communityMap.fitBounds(b, { padding: 50, maxZoom: 16, duration: 0 });
      } catch (e) { /* offline: stays on you */ }
    });
  }

  function highlight(id) {
    setTimeout(() => {
      const li = Array.from($("cmFeed").children).find((x) => x.dataset.id === id);
      if (li) { li.scrollIntoView({ block: "center", behavior: "smooth" }); li.classList.add("cm-flash"); setTimeout(() => li.classList.remove("cm-flash"), 1600); }
    }, 350);
  }

  function showPost(p) {
    // On the Community tab: move its own map to the post and open the card.
    if (communityMap && p.kind !== "route") {
      $("cmMap").scrollIntoView({ behavior: "smooth", block: "start" });
      communityLayer.add(p);
      setTimeout(() => openPopup(communityMap, p), 300);
      return;
    }
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
    if (mainLayer) mainLayer.add(p);
  }

  // ---- music on profiles ----------------------------------------------------------
  function trackList(tracks, mine) {
    const ul = make("ul", "cm-music");
    tracks.forEach((t) => {
      const li = make("li", "cm-track");
      const play = make("button", "pill active cm-track-play", "Play");
      play.type = "button";
      play.addEventListener("click", () => window.CalmStudio && CalmStudio.playRemote(t, play));
      const info = make("div", "cm-track-info");
      info.append(make("div", "cm-track-title", t.title));
      const fxName = { natural: "Natural", studio: "Studio", choir: "Choir", hall: "Big hall", echo: "Echo", robot: "Robot", chipmunk: "Chipmunk", deep: "Deep" }[t.fx] || "";
      const secs = Math.round(t.ms / 1000);
      info.append(make("div", "cm-meta", `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} · ${fxName}${t.pattern ? " · with beat" : ""}`));
      li.append(play, info);
      if (mine) {
        const del = make("button", "cm-link", "Delete");
        del.type = "button";
        del.addEventListener("click", async () => {
          if (!confirm("Remove this song from your profile?")) return;
          try { await api(`/api/social/tracks/${encodeURIComponent(t.id)}/delete`, { token: app.deviceToken() }); li.remove(); } catch (e) { app.toast(e.message); }
        });
        li.append(del);
      } else {
        const rep = make("button", "cm-link", "Report");
        rep.type = "button";
        rep.addEventListener("click", async () => {
          if (!confirm("Report this song? It will be hidden while we review it.")) return;
          try { await api(`/api/social/tracks/${encodeURIComponent(t.id)}/report`, { reporterToken: app.deviceToken(), reason: "other" }); li.remove(); app.toast("Thanks — it's hidden while we review it"); } catch (e) { app.toast(e.message); }
        });
        li.append(rep);
      }
      ul.appendChild(li);
    });
    return ul;
  }
  async function loadMyMusic() {
    const box = $("cmMyMusic");
    if (!box) return;
    box.innerHTML = "";
    if (!me || !me.profile) { box.hidden = true; return; }
    box.hidden = false;
    box.appendChild(make("h3", "cm-section-title", "My music"));
    try {
      const data = await api(`/api/social/profile/${encodeURIComponent(me.id)}`);
      if (data.tracks && data.tracks.length) box.appendChild(trackList(data.tracks, true));
      else box.appendChild(make("p", "cm-note", "Make a song in Music → Voice, then tap “Add to my profile”."));
    } catch (e) { box.appendChild(make("p", "cm-note", "Couldn't load your music.")); }
  }
  window.addEventListener("calmstudio:published", () => loadMyMusic());

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
      if (data.tracks && data.tracks.length) {
        const sec = make("li", "cm-viewer-music");
        sec.append(make("h3", "cm-section-title", "Music"), trackList(data.tracks, me && me.id === id));
        $("cmViewerFeed").appendChild(sec);
      }
      data.posts.forEach((p) => $("cmViewerFeed").appendChild(card(p)));
    } catch (err) { $("cmViewerName").textContent = err.message; }
  }

  // ---- composer -----------------------------------------------------------------
  function setKind(kind) {
    composerKind = kind;
    $("cmKindRow").querySelectorAll("[data-kind]").forEach((b) => b.classList.toggle("active", b.dataset.kind === kind));
    $("cmEventInput").hidden = $("cmEventLabel").hidden = kind !== "event";
    const route = app.currentRoute();
    if (kind === "route") {
      $("cmWhereNote").textContent = route ? "Shares the route you have on the map right now." : "Plan a route on the map first, then share it here.";
      return;
    }
    renderWhere();
  }
  function renderWhere() {
    const note = $("cmWhereNote");
    $("cmPickWrap").hidden = composerKind === "route";
    if (composerFix) {
      note.textContent = composerFix.source === "photo" ? "Pinned where your photo was taken. Drag the map to fine-tune."
        : composerFix.source === "map" ? "Pinned where you placed it."
        : composerFix.accuracy > 60
          ? `Your phone's location is rough (±${composerFix.accuracy} m) — drag the map so the pin is exactly right.`
          : `Pinned where you are now (±${Math.max(5, composerFix.accuracy || 5)} m). Drag the map to move the pin.`;
      showPickMap();
    } else {
      note.textContent = "Finding where you are…";
      locate(true).then((f) => { if (!composerFix) { composerFix = { ...f, source: "gps" }; } if (composerKind !== "route") renderWhere(); })
        .catch((err) => { if (composerKind !== "route") note.textContent = err.message; });
    }
  }

  function openComposer() {
    if (!me || !me.profile) { openProfileForm(); $("cmProfileError").textContent = "Create your profile first, then you can share."; return; }
    $("cmComposerForm").reset();
    composerPhotos = [];
    composerFix = null;
    renderThumbs();
    $("cmComposerError").textContent = "";
    setKind(app.currentRoute() ? "route" : "spot");
    $("cmComposer").classList.add("open");
    if (pickMap) setTimeout(() => pickMap.resize(), 50);
  }
  function closeComposer() { $("cmComposer").classList.remove("open"); }

  /** Re-encodes on the device: max 1080 px, JPEG — also strips EXIF/GPS. */
  async function compressPhoto(file) {
    const bmp = await createImageBitmap(file);
    let size = 1280, quality = 0.72, url = "";
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
    const route = app.currentRoute();
    if (composerKind !== "route" && !composerFix) {
      try { composerFix = await locate(true); } catch (err) { $("cmComposerError").textContent = err.message; return; }
    }
    const post = {
      kind: composerKind,
      title: $("cmTitleInput").value,
      body: $("cmBodyInput").value,
      lat: composerFix ? composerFix.lat : NaN, lon: composerFix ? composerFix.lon : NaN,
      photos: composerPhotos,
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
    $("cmComposerPost").textContent = composerPhotos.length ? "Uploading photos…" : "Posting…";
    try {
      const data = await api("/api/social/posts", { token: app.deviceToken(), post: check.value });
      closeComposer();
      $("cmStatus").textContent = "";
      $("cmFeed").prepend(card(data.post));
      if (mainLayer) mainLayer.add(data.post);
      if (communityLayer) communityLayer.add(data.post);
      if (communityMap) communityMap.flyTo({ center: [data.post.lon, data.post.lat], zoom: 16 });
      app.toast("Shared — thank you!");
    } catch (err) {
      $("cmComposerError").textContent = err.message;
    } finally { $("cmComposerPost").disabled = false; $("cmComposerPost").textContent = "Post"; }
  }

  // ---- drag-to-place mini map (the pin stays in the middle; you move the map) --------
  function showPickMap() {
    if (composerKind === "route" || !composerFix || !window.maplibregl) return;
    const center = [composerFix.lon, composerFix.lat];
    if (!pickMap) {
      pickMap = new maplibregl.Map({ container: "cmPickMap", style: app.map.getStyle(), center, zoom: 17, attributionControl: false, dragRotate: false, pitchWithRotate: false });
      pickMap.touchZoomRotate.disableRotation();
      pickMap.on("moveend", (e) => {
        if (!e.originalEvent) return; // ignore our own jumps
        const c = pickMap.getCenter();
        composerFix = { lat: c.lat, lon: c.lng, source: "map" };
        renderWhere();
      });
    } else if (!pickMap.isMoving()) {
      pickMap.jumpTo({ center });
      pickMap.resize();
    }
  }

  // ---- photos in the composer ------------------------------------------------------
  function renderThumbs() {
    const row = $("cmThumbs");
    row.innerHTML = "";
    composerPhotos.forEach((src, i) => {
      const t = make("div", "cm-thumb");
      const img = make("img");
      img.src = src;
      img.alt = `Photo ${i + 1}`;
      const x = make("button", "cm-thumb-x", "×");
      x.type = "button";
      x.setAttribute("aria-label", `Remove photo ${i + 1}`);
      x.addEventListener("click", () => { composerPhotos.splice(i, 1); renderThumbs(); });
      t.append(img, x);
      row.appendChild(t);
    });
    const full = composerPhotos.length >= S.LIMITS.photos;
    $("cmCameraBtn").hidden = $("cmLibraryBtn").hidden = full;
    $("cmPhotoCount").textContent = composerPhotos.length ? `${composerPhotos.length} of ${S.LIMITS.photos} photos` : `Up to ${S.LIMITS.photos} photos (optional)`;
  }
  async function addPhotos(files) {
    const room = S.LIMITS.photos - composerPhotos.length;
    const list = Array.from(files || []).slice(0, room);
    if (!list.length) return;
    $("cmPhotoCount").textContent = "Preparing photos…";
    for (const f of list) {
      // Pin the post where the photo was taken — unless you already placed it by hand.
      if (window.ExifGps && (!composerFix || composerFix.source === "gps")) {
        try {
          const g = ExifGps.readGps(await f.arrayBuffer());
          if (g) { composerFix = { ...g, source: "photo" }; if (composerKind !== "route") renderWhere(); }
        } catch (e) { /* no location in this photo */ }
      }
      try { composerPhotos.push(await compressPhoto(f)); }
      catch (err) { $("cmComposerError").textContent = err.message; }
    }
    renderThumbs();
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
    $("cmCameraInput").addEventListener("change", (e) => { addPhotos(e.target.files); e.target.value = ""; });
    $("cmLibraryInput").addEventListener("change", (e) => { addPhotos(e.target.files); e.target.value = ""; });
    // A drawing from the Sketchbook → a new post with it as the photo.
    window.addEventListener("calmsketch:post", (e) => {
      app.goToPage(3);
      openComposer();
      if ($("cmComposer").classList.contains("open")) addPhotos([new File([e.detail], "sketch.jpg", { type: "image/jpeg" })]);
    });
    $("cmViewerClose").addEventListener("click", () => { $("cmProfileViewer").classList.remove("open"); window.CalmStudio && CalmStudio.stop(); });
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

  // Started last, so every declaration above exists before start() runs.
  if (window.CalmApp) start(); else window.addEventListener("calmapp:ready", start, { once: true });
})();
