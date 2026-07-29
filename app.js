(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Theme / accessibility
  // ---------------------------------------------------------------------
  const root = document.documentElement;

  // Appearance: Light / Dark / Flow. setTheme() is the one place that
  // actually applies a theme (attribute + persistence + map tiles + the
  // settings pills + night-mode-derived audio behavior) — the header's
  // quick-toggle button and the settings sheet's pill row both just call it,
  // rather than duplicating this logic twice. setNightMode()/refreshMapTheme()
  // are declared further down in this file but this only ever runs on a
  // later click/load, by which point the whole script has finished loading.
  //
  // Persisted via flowtheme.js's own localStorage key (not prefs.js — theme
  // is an orthogonal concern from the audio/haptics settings prefs.js owns,
  // same reasoning as Calm Echoes' creatorToken living outside prefs.js too).
  // Previously (before Flow Mode) theme was never persisted at all and reset
  // to system preference on every reload — this fixes that for all three
  // appearances, not just Flow, since "remember the user's preference" only
  // makes sense applied uniformly.
  function setTheme(theme) {
    if (!FlowTheme.isValidTheme(theme)) return;
    root.setAttribute("data-theme", theme);
    FlowTheme.saveTheme(theme);
    appearanceChips.forEach((chip) => {
      const active = chip.dataset.appearance === theme;
      chip.classList.toggle("active", active);
      chip.setAttribute("aria-pressed", String(active));
    });
    const labels = { light: "Switch to dark theme", dark: "Switch to Flow theme", flow: "Switch to light theme" };
    themeToggleBtn.setAttribute("aria-label", labels[theme] || "Toggle theme");
    refreshMapTheme();
    setNightMode(FlowTheme.usesDarkMapTiles(theme));
  }

  const themeToggleBtn = document.getElementById("themeToggle");
  const appearanceChips = Array.from(document.querySelectorAll("#appearanceChips .pill"));

  themeToggleBtn.addEventListener("click", () => {
    const cur = root.getAttribute("data-theme") || FlowTheme.DEFAULT_THEME;
    setTheme(FlowTheme.nextTheme(cur));
  });
  appearanceChips.forEach((chip) => {
    chip.addEventListener("click", () => setTheme(chip.dataset.appearance));
  });

  const settingsBtn = document.getElementById("settingsBtn");
  const settingsOverlay = document.getElementById("settingsOverlay");
  const settingsSheetEl = settingsOverlay.querySelector(".settings-sheet");
  let settingsReturnFocusEl = null;

  function getFocusableInSettings() {
    return Array.from(settingsSheetEl.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter((el) => !el.disabled && el.offsetParent !== null);
  }
  function openSettings() {
    if (settingsOverlay.classList.contains("open")) return; // never open a second copy
    // The address autocomplete dropdown (.ac-list) intentionally has a
    // higher z-index than this overlay so it can sit above ordinary page
    // content — but that means if it's still open when Settings opens
    // (e.g. a user was mid-search, tapped Settings without picking a
    // suggestion), it renders visually on top of the sheet instead of
    // behind it, overlapping the sheet's own text. Closing both explicitly
    // here is more correct than tweaking z-index numbers against each
    // other, since the dropdown genuinely shouldn't be showing at all while
    // a modal sheet has focus.
    if (typeof startAutocomplete !== "undefined") startAutocomplete.close();
    if (typeof endAutocomplete !== "undefined") endAutocomplete.close();
    settingsReturnFocusEl = document.activeElement;
    settingsOverlay.classList.add("open");
    const focusables = getFocusableInSettings();
    if (focusables.length) focusables[0].focus();
  }
  function closeSettingsSheet() {
    if (!settingsOverlay.classList.contains("open")) return;
    settingsOverlay.classList.remove("open");
    if (settingsReturnFocusEl && typeof settingsReturnFocusEl.focus === "function") settingsReturnFocusEl.focus();
    settingsReturnFocusEl = null;
  }
  settingsBtn.addEventListener("click", openSettings);
  document.getElementById("closeSettings").addEventListener("click", closeSettingsSheet);
  settingsOverlay.addEventListener("click", (e) => { if (e.target === settingsOverlay) closeSettingsSheet(); });
  // Escape-to-close and a Tab focus trap, both scoped to "only while open".
  document.addEventListener("keydown", (e) => {
    if (!settingsOverlay.classList.contains("open")) return;
    if (e.key === "Escape") { closeSettingsSheet(); return; }
    if (e.key === "Tab") {
      const focusables = getFocusableInSettings();
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  const reducedMotionToggle = document.getElementById("reducedMotionToggle");
  const highContrastToggle = document.getElementById("highContrastToggle");

  reducedMotionToggle.addEventListener("change", () => {
    root.setAttribute("data-motion", reducedMotionToggle.checked ? "reduced" : "full");
    prefs.set({ audio: { reducedMotion: reducedMotionToggle.checked } });
    // updateFlowDecorPauseState is defined later in this file (Calm Echoes
    // section) but is a hoisted function declaration, so it's always safe
    // to call from an event handler that only ever fires after the whole
    // script has finished loading — same convention already used for
    // setNightMode()/refreshMapTheme() referenced earlier than their own
    // definitions in this same file.
    if (typeof updateFlowDecorPauseState === "function") updateFlowDecorPauseState();
  });
  highContrastToggle.addEventListener("change", () => {
    root.setAttribute("data-contrast", highContrastToggle.checked ? "high" : "normal");
  });

  // Apply the persisted theme (or fall back to system preference, exactly
  // as before Flow Mode existed) once, on load — after setTheme/appearanceChips
  // above are defined but before the map below reads isDark() for its
  // initial tile choice.
  // Actually invoked at the very end of this file (see the final
  // `initTheme();` call) — setTheme() reaches into refreshMapTheme() (needs
  // `map`/`tileLayer`) and setNightMode() (needs `prefs`, `audioManager`,
  // and the ambient engines), all declared/constructed later in this same
  // top-level scope. Calling it from here would hit the const/let temporal
  // dead zone and throw on every returning visitor who has a persisted
  // theme, before the rest of the script (route inputs, nav wiring,
  // everything) ever runs.
  function initTheme() {
    const stored = FlowTheme.loadStoredTheme();
    if (stored) {
      setTheme(stored);
    } else {
      const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      appearanceChips.forEach((chip) => {
        const active = chip.dataset.appearance === (prefersDark ? "dark" : "light");
        chip.classList.toggle("active", active);
        chip.setAttribute("aria-pressed", String(active));
      });
      // Deliberately does NOT call setTheme()/set a data-theme attribute here:
      // the existing @media(prefers-color-scheme) CSS block already renders
      // the right colors with no attribute set at all, and setting one now
      // would stop this app from following a LATER OS-level theme change —
      // exactly the same "no attribute = follow the system live" behavior
      // this app had before Flow Mode, preserved for anyone who's never
      // touched the appearance picker.
    }
  }

  // ---------------------------------------------------------------------
  // Map (Leaflet + CARTO tiles, built on OpenStreetMap data)
  // ---------------------------------------------------------------------
  // Real feedback: a frozen, non-interactive map read as broken rather than
  // intentional, and the default OSM "Mapnik" tile style looks dated/busy.
  // Switched to CARTO's free, no-key-required Positron/Dark Matter tiles —
  // a clean, muted basemap that suits a calm-design app much better and lets
  // the route-line colors actually stand out — and gave the map back its
  // normal pinch/drag/zoom. The page-dots nav (and keyboard arrows) are the
  // fallback for switching pages from directly on top of the map.
  const isDark = () => {
    const t = root.getAttribute("data-theme");
    // Flow uses the dark CARTO tileset too (see flowtheme.js's usesDarkMapTiles
    // for why: a night-sky base is what the aurora-style overlay is designed
    // to sit on top of).
    return t ? FlowTheme.usesDarkMapTiles(t) : (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  };
  const map = L.map("map", { zoomControl: false, attributionControl: false }).setView(
    [CONFIG.DEFAULT_START.lat, CONFIG.DEFAULT_START.lon], 14
  );
  let tileLayer = L.tileLayer(
    isDark()
      ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    { maxZoom: 19, subdomains: "abcd" }
  ).addTo(map);
  L.control.attribution({ prefix: false }).addAttribution("&copy; OpenStreetMap contributors &copy; CARTO").addTo(map);

  // Entering/leaving full-screen nav mode resizes #map via a plain CSS
  // `height` transition (style.css's `.page-inner.nav-active #map` rule) —
  // smooth and free, but Leaflet's own tile grid doesn't know the resize
  // happened until told. Calling invalidateSize() repeatedly mid-transition
  // (e.g. on every animation frame) would work but re-tiles far more than
  // needed and can visibly stutter; calling it once, right as the CSS
  // transition finishes, gives a seamless "route stays visible throughout"
  // resize with a single re-tile. Falls back to a fixed delay matching
  // --motion-slow if `transitionend` never fires (e.g. reduced-motion
  // collapses the transition to ~0ms faster than the listener can attach).
  // Keeps Leaflet's tile grid in sync with .map-wrap's real, observed box
  // size instead of guessing when a CSS transition has "finished". Timing-
  // based approaches (transitionend + a delay, even a retry ladder of
  // several invalidateSize() calls spread across ~1.6s) were confirmed via
  // repeated manual testing to be flaky — intermittently leaving the tile
  // grid gray/half-loaded below the fold, evidently because the grid
  // layer's own tile-fetch pass doesn't reliably "catch up" on any fixed
  // schedule. A ResizeObserver instead fires on every genuine layout-box
  // change (every frame of the .map-wrap height transition, plus its final
  // settled size), so Leaflet is told about the real size continuously
  // rather than at one guessed moment — this is the standard fix for
  // Leaflet living inside an animated/CSS-transitioning container. Runs for
  // the whole app lifetime (not just during nav), which is harmless: an
  // invalidateSize() call when the size hasn't meaningfully changed is a
  // cheap no-op.
  new ResizeObserver(() => map.invalidateSize({ animate: false })).observe(document.querySelector(".map-wrap"));

  function refreshMapTheme() {
    map.removeLayer(tileLayer);
    tileLayer = L.tileLayer(
      isDark()
        ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      { maxZoom: 19, subdomains: "abcd" }
    ).addTo(map);
    tileLayer.bringToBack();
  }

  let calmLine = null, fastLine = null, startMarker = null, endMarker = null;

  // "Animate route creation/recalculation... no harsh redraws, no
  // flickering." A reroute fades the OLD layers out (rather than an
  // instant removal) while the new ones are created and drawn-on beneath —
  // the two animations overlap in time, which reads as a single continuous
  // transition rather than a flash-to-black gap. `fadeOutMs` is only ever
  // passed on a genuine reroute; a first search (no prior layers to fade)
  // just removes nothing, same as before.
  function clearRouteLayers(fadeOutMs) {
    const layers = [calmLine, fastLine, startMarker, endMarker].filter(Boolean);
    if (fadeOutMs && layers.length) {
      layers.forEach((l) => {
        const el = typeof l.getElement === "function" ? l.getElement() : null;
        if (el) { el.style.transition = `opacity ${fadeOutMs}ms ease`; el.style.opacity = "0"; }
      });
      setTimeout(() => layers.forEach((l) => map.removeLayer(l)), fadeOutMs);
    } else {
      layers.forEach((l) => map.removeLayer(l));
    }
    calmLine = fastLine = startMarker = endMarker = null;
  }

  // SVG-only "line drawing on" effect (stroke-dasharray/dashoffset) for the
  // primary calm route — the one line actually in the spec's own visual-
  // hierarchy priority list. The secondary dashed fastest-route line keeps
  // its instant appearance: it already uses Leaflet's own `dashArray` style
  // option for its permanent dashed look, which would otherwise fight this
  // technique's direct manipulation of the same SVG attribute. No-op
  // (silently) if the browser ever renders via Canvas instead of SVG,
  // where `getTotalLength()` doesn't exist on the returned element.
  function animateRouteDrawOn(polyline, durationMs) {
    const path = polyline && typeof polyline.getElement === "function" ? polyline.getElement() : null;
    if (!path || typeof path.getTotalLength !== "function") return;
    const length = path.getTotalLength();
    path.style.transition = "none";
    path.style.strokeDasharray = `${length}`;
    path.style.strokeDashoffset = `${length}`;
    // Force a reflow so the browser commits the "fully hidden" starting
    // state before animating to visible — otherwise the two style writes
    // in the same tick can get batched and the transition never visibly
    // starts. Same forced-reflow technique already used for Flow Mode's
    // reactive pulse.
    void path.getBoundingClientRect();
    path.style.transition = `stroke-dashoffset ${durationMs}ms ease-out`;
    path.style.strokeDashoffset = "0";
  }

  function drawRoute(result, start, end, options) {
    const isReroute = !!(options && options.isReroute);
    clearRouteLayers(isReroute ? 280 : 0);
    const calmLatLngs = result.calm.coordinates.map(([lon, lat]) => [lat, lon]);
    const fastLatLngs = result.fastest.coordinates.map(([lon, lat]) => [lat, lon]);

    fastLine = L.polyline(fastLatLngs, { color: getVar("--busy"), weight: 3, opacity: 0.55, dashArray: "5,7" }).addTo(map);
    calmLine = L.polyline(calmLatLngs, { color: getVar("--calm"), weight: 5, opacity: 0.95 }).addTo(map);
    animateRouteDrawOn(calmLine, isReroute ? 700 : 1000);
    // Flow Mode's "route slowly shimmers, suggesting calm energy flowing
    // toward the destination" — a CSS animation class on the calm route's
    // real rendered <path> element (Leaflet's SVG renderer), applied only
    // while Flow is active so Light/Dark keep the exact same static line.
    if (FlowTheme.isFlowActive(root.getAttribute("data-theme")) && calmLine.getElement()) {
      calmLine.getElement().classList.add("flow-route-glow");
    }

    startMarker = L.marker([start.lat, start.lon], { icon: makePinIcon(getVar("--calm")) }).addTo(map);
    endMarker = L.marker([end.lat, end.lon], { icon: makePinIcon(getVar("--accent")) }).addTo(map);

    // The map container's on-screen size can have changed since Leaflet last
    // measured it (e.g. the safety banner or special-event banner toggling
    // visibility above the map). invalidateSize() re-syncs Leaflet's cached
    // size before fitBounds computes the fit — otherwise tiles get positioned
    // for a stale (usually smaller) box and leave the real container's edges
    // blank. animate:false avoids leftover stale-zoom tiles from an
    // interrupted pan/zoom animation when markers are added immediately after.
    map.invalidateSize(false);
    map.fitBounds(calmLine.getBounds(), { padding: [24, 24], animate: false });
  }

  function getVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
  }

  // ---------------------------------------------------------------------
  // Shared audio + preferences infrastructure — one AudioManager for the
  // whole app (nav voice, ambient soundscapes, effects, and the haptic
  // page's fidget tones all mix through its three buses), one Prefs store
  // persisting both audio and haptic settings.
  // ---------------------------------------------------------------------
  const prefs = new Prefs();
  const audioManager = new AudioManager();

  // Reduced motion starts on if EITHER the OS currently prefers it OR the
  // user previously turned it on in this app (persisted — see prefs.js).
  // This is what makes the setting actually survive a refresh: previously it
  // only ever reflected the OS preference and was never saved at all.
  const prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReducedMotion || prefs.get().audio.reducedMotion) {
    reducedMotionToggle.checked = true;
    root.setAttribute("data-motion", "reduced");
    if (!prefs.get().audio.reducedMotion) prefs.set({ audio: { reducedMotion: true } });
  }

  // ---------------------------------------------------------------------
  // Navigation bridge — picks web or native implementations for every
  // location/audio/speech/haptics/lifecycle/notification concern used below.
  // See shared/navigationBridge.js and shared/interfaces.js for why this is
  // the one seam the rest of app.js talks through instead of calling
  // navigator.geolocation/AudioManager/HapticManager directly for anything
  // nav-related — it's what makes "never two simultaneous engines
  // processing the same GPS updates" enforceable.
  // ---------------------------------------------------------------------
  const apiBaseUrl = NavBridge.isNative ? CONFIG.NATIVE_API_BASE_URL : "";
  NavBridge.init({
    location: NavBridge.isNative ? new NativeLocationProvider() : new WebLocationProvider(),
    backgroundNav: NavBridge.isNative ? new NativeBackgroundNavigationService() : new WebBackgroundNavigationService(),
    audioSession: NavBridge.isNative ? new NativeAudioSessionController() : new WebAudioSessionController(audioManager),
    speech: NavBridge.isNative ? new NativeSpeechGuidanceProvider() : null, // web's is created below, after VoiceEngine exists
    haptics: NavBridge.isNative ? new NativeHapticProvider() : null, // web's is created below, after HapticManager exists
    lifecycle: NavBridge.isNative ? new NativeLifecycleController() : new WebLifecycleController(),
    notification: NavBridge.isNative ? new NativeNotificationController() : new WebNotificationController(),
  });

  function makeUserDotIcon() {
    return L.divIcon({ className: "user-dot", html: `<div class="user-dot-inner"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] });
  }

  // Pikmin-Bloom-style pillowy teardrop pin (rounded, gently swaying), built as
  // a Leaflet divIcon so it can use the app's own CSS animation instead of a
  // static default marker image.
  function makePinIcon(color) {
    return L.divIcon({
      className: "map-pin",
      html: `<svg viewBox="0 0 26 26"><path d="M13 2c-5.5 0-9 4-9 8.5C4 17 13 24 13 24s9-7 9-13.5C22 6 18.5 2 13 2z" fill="${color}"/><circle cx="13" cy="10.5" r="4" fill="rgba(255,255,255,0.85)"/></svg>`,
      iconSize: [26, 26],
      iconAnchor: [13, 24],
    });
  }

  // ---------------------------------------------------------------------
  // PILLAR 1 — Calm routing
  // ---------------------------------------------------------------------
  const startInput = document.getElementById("startInput");
  const endInput = document.getElementById("endInput");
  const findBtn = document.getElementById("findBtn");
  const modeNote = document.getElementById("modeNote");
  const routeCompare = document.getElementById("routeCompare");
  const routeResultsCard = document.getElementById("routeResultsCard");
  const calmCard = document.getElementById("calmCard");
  const fastCard = document.getElementById("fastCard");
  const safetyToggle = document.getElementById("safetyToggle");
  const safetyNote = document.getElementById("safetyNote");
  const startNavBtn = document.getElementById("startNavBtn");
  const navBanner = document.getElementById("navBanner");
  const navBottom = document.getElementById("navBottom");
  const navIcon = document.getElementById("navIcon");
  const navDist = document.getElementById("navDist");
  const navInstr = document.getElementById("navInstr");
  const navStreet = document.getElementById("navStreet");
  const navEta = document.getElementById("navEta");
  const navArrivalClock = document.getElementById("navArrivalClock");
  const navEndBtn = document.getElementById("navEndBtn");
  const navHapticBtn = document.getElementById("navHapticBtn");
  const navSettingsBtn = document.getElementById("navSettingsBtn");
  const errorBanner = document.getElementById("errorBanner");
  const travelModePills = document.querySelectorAll("#travelModePills .pill");

  startInput.value = CONFIG.DEFAULT_START.label;
  endInput.value = CONFIG.DEFAULT_END.label;
  let resolvedStart = CONFIG.DEFAULT_START;
  let resolvedEnd = CONFIG.DEFAULT_END;
  let travelMode = "walk";

  // ---------------------------------------------------------------------
  // Address autocomplete (start + destination fields)
  // ---------------------------------------------------------------------
  // A single quiet, low-accuracy location fetch, attempted once on first
  // interaction with either address field (not on page load, so the
  // permission prompt only appears once the user has actually started
  // searching). If denied/unavailable, autocomplete still works globally —
  // it just has no nearby-ranking bias.
  let userPoint = null;
  let cityContext = null;
  let locateAttempted = false;
  async function ensureUserLocation() {
    if (locateAttempted) return;
    locateAttempted = true;
    if (NavBridge.isNative) {
      const status = await Capacitor.Plugins.CalmNavBackground.getPermissionStatus();
      if (status.foreground !== "granted") {
        const req = await Capacitor.Plugins.CalmNavBackground.requestForegroundLocationPermission();
        if (!req.granted) return; // denied — autocomplete still works globally, just without nearby bias
      }
    }
    try {
      const fix = await NavBridge.location.getCurrentPosition();
      userPoint = { lat: fix.lat, lon: fix.lon };
      const ctx = await resolveCityContext({ point: userPoint });
      if (ctx) cityContext = ctx;
    } catch (e) {
      // denied or unavailable: leave userPoint/cityContext null
    }
  }
  function getUserContext() {
    return {
      point: userPoint,
      city: cityContext && cityContext.city,
      state: cityContext && cityContext.state,
      countryCode: cityContext && cityContext.countryCode,
    };
  }

  // "Use my current location" — a fresh, higher-accuracy fix (separate from
  // the passive biasing fetch above), with reverse geocoding for a readable
  // label that never blocks on failure.
  async function useCurrentLocationForStart() {
    if (NavBridge.isNative) {
      const status = await Capacitor.Plugins.CalmNavBackground.getPermissionStatus();
      if (status.foreground !== "granted") {
        const req = await Capacitor.Plugins.CalmNavBackground.requestForegroundLocationPermission();
        if (!req.granted) return null;
      }
    }
    let fix;
    try {
      fix = await NavBridge.location.getCurrentPosition();
    } catch (e) {
      return null;
    }
    const point = { lat: fix.lat, lon: fix.lon };
    userPoint = point;
    let label = "Current location";
    try {
      const ctx = await resolveCityContext({ point, force: !cityContext, endpointBase: apiBaseUrl });
      if (ctx) cityContext = ctx;
      const { hits } = await reverseGeocode({ point, endpointBase: apiBaseUrl });
      const normalized = hits.map(normalizeHit).filter(Boolean);
      if (normalized[0]) {
        label = normalized[0].secondary
          ? `${normalized[0].primary}, ${normalized[0].secondary}`
          : normalized[0].primary;
      }
    } catch (e) {
      // Reverse geocoding is best-effort only — the coordinates themselves
      // are already resolved and usable regardless.
    }
    return { lat: point.lat, lon: point.lon, label };
  }

  let startSelectedResult = null;
  let endSelectedResult = null;

  const startAutocomplete = new AutocompleteController({
    input: startInput,
    listEl: document.getElementById("startAcList"),
    statusEl: document.getElementById("startAcStatus"),
    isStartField: true,
    geocodingService: { forwardGeocode },
    endpointBase: apiBaseUrl,
    ranking: { rankHits },
    getUserContext,
    onSelect: (result) => {
      startSelectedResult = result;
      resolvedStart = { label: result.label, lat: result.lat, lon: result.lon };
    },
    onUseCurrentLocation: useCurrentLocationForStart,
  });
  const endAutocomplete = new AutocompleteController({
    input: endInput,
    listEl: document.getElementById("endAcList"),
    statusEl: document.getElementById("endAcStatus"),
    isStartField: false,
    geocodingService: { forwardGeocode },
    endpointBase: apiBaseUrl,
    ranking: { rankHits },
    getUserContext,
    onSelect: (result) => {
      endSelectedResult = result;
      resolvedEnd = { label: result.label, lat: result.lat, lon: result.lon };
    },
  });
  startInput.addEventListener("focus", ensureUserLocation);
  endInput.addEventListener("focus", ensureUserLocation);

  function showError(message) {
    errorBanner.textContent = message;
    errorBanner.style.display = "block";
  }
  function clearError() {
    errorBanner.style.display = "none";
  }

  travelModePills.forEach((pill) => {
    pill.addEventListener("click", () => {
      travelModePills.forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      travelMode = pill.dataset.travel;
      if (lastResult) runSearch();
    });
  });

  const CLASS_COLORS = {
    path: "#4F7A6E", track: "#6B9C8C", pedestrian: "#7FADA0", living_street: "#96C2B3",
    footway: "#5C8F80", cycleway: "#8FB8AC", residential: "#B7CDBE", unclassified: "#CBB98A",
    service: "#D8C9A0", tertiary: "#D6A254", secondary: "#C1592E", primary: "#A8391B",
    trunk: "#7E2A13", motorway: "#5C1D0C", other: "#AAAAAA",
  };

  function renderBar(el, breakdownPct) {
    el.innerHTML = "";
    Object.keys(breakdownPct).forEach((k) => {
      const seg = document.createElement("span");
      seg.style.width = breakdownPct[k] + "%";
      seg.style.background = CLASS_COLORS[k] || CLASS_COLORS.other;
      seg.title = `${k}: ${breakdownPct[k]}%`;
      el.appendChild(seg);
    });
  }

  function fmtMin(ms) { return Math.round(ms / 60000) + " min"; }
  function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(1) + " km" : Math.round(m) + " m"; }
  // Wall-clock arrival time (e.g. "14:32") for the top card's "Arrival time"
  // field — computed fresh from the current time + remaining duration on
  // every fix, not tracked as separate state, so it's never stale even if a
  // fix is missed.
  function fmtArrivalClock(remainingMs) {
    const d = new Date(Date.now() + Math.max(0, remainingMs));
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  let lastResult = null;
  let selected = "calm";

  // GraphHopper "sign" codes → simple turn icons. Standard convention:
  // 0 continue, ±1 slight turn, ±2 turn, ±3 sharp turn, 4 arrive, 6 roundabout.
  function signIcon(sign) {
    if (sign === 4 || sign === 5) return "🏁";
    if (sign === 6) return "↻";
    if (sign <= -2) return "↰";
    if (sign === -1) return "↖";
    if (sign === 0) return "↑";
    if (sign === 1) return "↗";
    if (sign >= 2) return "↱";
    return "↑";
  }

  const stepsList = document.getElementById("stepsList");
  function renderSteps(which) {
    if (!lastResult) return;
    const route = which === "fast" ? lastResult.fastest : lastResult.calm;
    const steps = route.steps || [];
    stepsList.innerHTML = "";
    if (!steps.length) {
      stepsList.innerHTML = '<div class="step-empty">No turn-by-turn available for this route.</div>';
      return;
    }
    steps.forEach((s) => {
      const row = document.createElement("div");
      row.className = "step-row";
      const icon = document.createElement("span");
      icon.className = "step-icon";
      icon.textContent = signIcon(s.sign);
      const text = document.createElement("span");
      text.className = "step-text";
      text.textContent = s.text;
      const dist = document.createElement("span");
      dist.className = "step-dist";
      dist.textContent = s.distanceM > 0 ? fmtDist(s.distanceM) : "";
      row.appendChild(icon);
      row.appendChild(text);
      row.appendChild(dist);
      stepsList.appendChild(row);
    });
  }

  function selectRoute(which) {
    selected = which;
    calmCard.classList.toggle("selected", which === "calm");
    fastCard.classList.toggle("selected", which === "fast");
    renderSteps(which);
  }
  calmCard.addEventListener("click", () => selectRoute("calm"));
  fastCard.addEventListener("click", () => selectRoute("fast"));

  const findBtnLabel = document.getElementById("findBtnLabel");
  let isSearching = false;

  async function runSearch() {
    // Guards all three trigger paths (Find button, travel-mode pills, safety
    // toggle) against firing a second overlapping request while one is still
    // in flight — two concurrent fetchCalmRoute calls could otherwise race
    // and let the earlier (stale) response's drawRoute() overwrite the later one.
    if (isSearching) return;
    isSearching = true;
    findBtn.disabled = true;
    findBtn.classList.add("loading");
    findBtnLabel.textContent = "Finding your calm route…";
    modeNote.textContent = "";
    clearError();

    // Geocoding/routing both go through same-origin Functions proxies
    // (functions/api/*.js) — no API key lives in this bundle. If the
    // deployment has no key configured server-side, these calls resolve
    // with a non-ok response and everything below degrades to demo mode.
    //
    // If the user picked a suggestion from autocomplete and hasn't edited
    // the field since, its exact lat/lon is already known — skip re-geocoding
    // it, both to save a request and to avoid the (small) chance a second
    // lookup resolves to a different point than the one actually selected.
    const startAlreadyResolved = startSelectedResult && startSelectedResult.label === startInput.value;
    const endAlreadyResolved = endSelectedResult && endSelectedResult.label === endInput.value;
    const [s, e] = await Promise.all([
      startAlreadyResolved
        ? Promise.resolve({ label: startSelectedResult.label, lat: startSelectedResult.lat, lon: startSelectedResult.lon })
        : geocode(startInput.value, apiBaseUrl),
      endAlreadyResolved
        ? Promise.resolve({ label: endSelectedResult.label, lat: endSelectedResult.lat, lon: endSelectedResult.lon })
        : geocode(endInput.value, apiBaseUrl),
    ]);
    // Checked independently: previously this only warned when BOTH failed,
    // so a single mistyped address silently kept navigating from/to the
    // last resolved (often default) location with no indication to the user.
    const startFailed = !s && startInput.value !== resolvedStart.label;
    const endFailed = !e && endInput.value !== resolvedEnd.label;
    if (s) resolvedStart = s;
    if (e) resolvedEnd = e;
    if (startFailed && endFailed) {
      // Unlike the two single-field branches below, this used to stop at
      // "couldn't find either place" with no mention of what happens next —
      // but the route search still runs against the previous start/end
      // (see resolvedStart/resolvedEnd below), so the map and time
      // estimates that appear right after this error keep showing a route,
      // just not the one the user just typed. Matching the other two
      // branches' wording so that's no longer surprising.
      showError("Couldn't find either place — check the spelling, or try a nearby landmark. Kept the previous start and destination instead.");
    } else if (startFailed) {
      showError(`Couldn't find "${startInput.value}" — kept the previous start location instead.`);
    } else if (endFailed) {
      showError(`Couldn't find "${endInput.value}" — kept the previous destination instead.`);
    }

    let result;
    try {
      result = await fetchCalmRoute({
        start: resolvedStart,
        end: resolvedEnd,
        peakWindows: CONFIG.PEAK_WINDOWS,
        safetyMode: safetyToggle.checked,
        specialEvents: CONFIG.SPECIAL_EVENTS,
        ghProfile: NavLogic.TRAVEL_MODES[travelMode].ghProfile,
        endpointBase: apiBaseUrl,
      });
    } catch (e) {
      isSearching = false;
      findBtn.disabled = false;
      findBtn.classList.remove("loading");
      findBtnLabel.textContent = "Find calm route";
      showError("Something went wrong finding a route. Please try again.");
      return;
    }
    lastResult = result;

    const specialEventBanner = document.getElementById("specialEventBanner");
    if (result.specialEvent) {
      specialEventBanner.textContent = `Today is ${result.specialEvent.name}. ${result.specialEvent.note}`;
      specialEventBanner.style.display = "block";
    } else {
      specialEventBanner.style.display = "none";
    }

    drawRoute(result, resolvedStart, resolvedEnd);

    calmCard.querySelector(".rc-time").textContent = fmtMin(result.calm.timeMs);
    document.getElementById("calmDist").textContent = fmtDist(result.calm.distanceM);
    document.getElementById("fastTime").textContent = fmtMin(result.fastest.timeMs);
    document.getElementById("fastDist").textContent = fmtDist(result.fastest.distanceM);
    renderBar(document.getElementById("calmBar"), result.calm.breakdownPct);
    renderBar(document.getElementById("fastBar"), result.fastest.breakdownPct);
    routeCompare.style.display = "flex";
    routeResultsCard.classList.add("visible");
    startNavBtn.style.display = "flex";
    selectRoute("calm");

    let note = result.note ? result.note + " " : "";
    if (result.mode === "live") {
      note += result.extraMinutes > 0
        ? `Calm route takes about ${result.extraMinutes} min longer than fastest.`
        : `Calm route is about as fast as the fastest one — easy choice.`;
    }
    if (result.peak) note += " (Peak-hours heuristic applied — busier road types were weighted down further.)";
    modeNote.textContent = note.trim();

    // Real feedback flagged that a purely sensory-calm route (quiet paths, parks)
    // can mean fewer people around — a safety tradeoff, not just a sensory one.
    // Surface it explicitly, especially at night, rather than silently picking
    // "calm" for someone without telling them what that traded off.
    if (result.night && result.calm.isolatedPct >= 25 && !result.safetyMode) {
      safetyNote.textContent = `Heads up: this calm route is ${result.calm.isolatedPct}% quiet paths/parks — calmer, but also less populated, and it's currently night hours. If personal safety is a concern, try "prefer well-lit, busier streets" above.`;
      safetyNote.style.display = "block";
    } else {
      safetyNote.style.display = "none";
    }

    isSearching = false;
    findBtn.disabled = false;
    findBtn.classList.remove("loading");
    findBtnLabel.textContent = "Find calm route";
  }

  findBtn.addEventListener("click", runSearch);
  safetyToggle.addEventListener("change", () => { if (lastResult) runSearch(); });

  // ---------------------------------------------------------------------
  // Live GPS turn-by-turn navigation ("Start", like Maps).
  //
  // Architecture: this block is UI/IO glue only. All the actual navigation
  // decisions (off-route detection, step advancement, arrival, state
  // transitions) live in navlogic.js's NavLogic.processFix() — a pure
  // function with no DOM/network access, unit-tested in navlogic.test.js.
  // That separation is what makes "does the nav logic work" testable
  // without a browser or a real GPS.
  //
  // State machine (NavLogic.NavState): idle -> requesting_location ->
  // calculating_route -> route_ready -> navigating <-> off_route ->
  // recalculating -> navigating | arrived | error. "idle"/"route_ready"
  // are implicit here (before Start / after a search), the rest are
  // explicit below.
  // ---------------------------------------------------------------------
  const pageInner0 = document.querySelector("#page-0 .page-inner");
  const appShellEl = document.querySelector(".app-shell");

  // Third layer of defense against the "unexpected text-edit/undo popup
  // during navigation" bug, alongside style.css's .app-shell.nav-fullscreen
  // user-select/touch-callout hardening and startNavigation()'s explicit
  // focus blur: suppress the native context menu outright while navigating,
  // in case any platform/browser combination still surfaces one despite the
  // CSS hardening (Android WebView's long-press handling doesn't always
  // fully respect user-select the way desktop browsers do). Checked at
  // event time against the live class, not tied to a specific element, so
  // it stays correct regardless of what's under the touch point.
  document.addEventListener("contextmenu", (e) => {
    if (appShellEl.classList.contains("nav-fullscreen")) e.preventDefault();
  });

  const recenterBtn = document.getElementById("recenterBtn");
  const navMuteBtn = document.getElementById("navMuteBtn");
  const navArrived = document.getElementById("navArrived");
  const simBtn = document.getElementById("simBtn");
  const simBadge = document.getElementById("simBadge");

  const voice = new VoiceEngine(audioManager);
  if (!NavBridge.isNative) NavBridge.speech = new WebSpeechGuidanceProvider(voice);
  const navEffects = new EffectsEngine(audioManager);
  const navCaption = document.getElementById("navCaption");
  voice.setCaptionsEnabled(prefs.get().audio.captionsEnabled);
  voice.onCaption = (text) => {
    if (text) { navCaption.textContent = text; navCaption.style.display = "block"; }
    else { navCaption.style.display = "none"; }
  };
  document.getElementById("captionsToggle").addEventListener("change", (e) => {
    voice.setCaptionsEnabled(e.target.checked);
    prefs.set({ audio: { captionsEnabled: e.target.checked } });
  });

  const DEV_SIMULATION = !!CONFIG.DEV_SIMULATION || /[?&]simulate=1\b/.test(location.search);
  if (DEV_SIMULATION) simBtn.style.display = "inline-flex";

  let navState = null;          // NavLogic state object (route, stepIdx, offRouteStreak, ...)
  let currentState = NavLogic.NavState.IDLE;
  let navWatchId = null;
  let backgroundNavActive = false;
  const backgroundNavRow = document.getElementById("backgroundNavRow");
  const backgroundNavToggle = document.getElementById("backgroundNavToggle");
  const backgroundNavNote = document.getElementById("backgroundNavNote");
  if (NavBridge.isNative) backgroundNavRow.style.display = "flex";
  let navRerouting = false;
  let followMode = true;        // auto-recenter the map on every fix, until the user pans
  let lastFixLatLng = null;
  let wakeLock = null;
  let simulator = null;
  let usingSimulatedGps = false;
  let userDotMarker = null;
  let userAccuracyCircle = null;
  let smoothedHeadingDeg = null;
  let markerTweenRAF = null;
  let markerTweenFrom = null;
  let markerTweenTo = null;
  let markerTweenStartMs = 0;
  const MARKER_TWEEN_MS = 450; // matches --motion-slow — camera/marker motion reads as one consistent "speed of calm" with the rest of the app's animation timing

  function cancelMarkerTween() {
    if (markerTweenRAF != null) { cancelAnimationFrame(markerTweenRAF); markerTweenRAF = null; }
  }
  function stepMarkerTween(nowMs) {
    const t = (nowMs - markerTweenStartMs) / MARKER_TWEEN_MS;
    const point = NavLogic.lerpLatLon(markerTweenFrom.lat, markerTweenFrom.lon, markerTweenTo.lat, markerTweenTo.lon, t);
    if (userDotMarker) userDotMarker.setLatLng([point.lat, point.lon]);
    if (userAccuracyCircle) userAccuracyCircle.setLatLng([point.lat, point.lon]);
    markerTweenRAF = t < 1 ? requestAnimationFrame(stepMarkerTween) : null;
  }

  // The user-location marker "should feel alive": smoothly interpolated
  // between fixes (no teleporting), heading-smoothed (no jitter from noisy
  // compass/GPS-derived bearings), and its confidence ring reacts to
  // reported GPS accuracy rather than a fixed radius.
  function updateUserMarker(lat, lon, accuracy, headingDeg) {
    if (!userDotMarker) {
      userDotMarker = L.marker([lat, lon], { icon: makeUserDotIcon(), zIndexOffset: 1000 }).addTo(map);
      userAccuracyCircle = L.circle([lat, lon], { radius: accuracy || 15, color: getVar("--sky"), fillColor: getVar("--sky"), fillOpacity: 0.12, weight: 1 }).addTo(map);
      smoothedHeadingDeg = headingDeg != null ? headingDeg : null;
    } else {
      cancelMarkerTween();
      const current = userDotMarker.getLatLng();
      markerTweenFrom = { lat: current.lat, lon: current.lng };
      markerTweenTo = { lat, lon };
      markerTweenStartMs = performance.now();
      markerTweenRAF = requestAnimationFrame(stepMarkerTween);
      smoothedHeadingDeg = NavLogic.smoothHeading(smoothedHeadingDeg, headingDeg, 0.35);
      userAccuracyCircle.setRadius(accuracy || 15);
    }
    const el = userDotMarker.getElement();
    const effectiveHeading = smoothedHeadingDeg != null ? smoothedHeadingDeg : headingDeg;
    if (el) {
      const inner = el.querySelector(".user-dot-inner");
      el.classList.toggle("has-heading", effectiveHeading != null);
      if (inner && effectiveHeading != null) inner.style.transform = `rotate(${effectiveHeading}deg)`;
    }
    // "When GPS accuracy decreases, show confidence naturally" — a larger,
    // more visible ring for a genuinely uncertain fix; a subtle, barely-
    // there one once accuracy is good, rather than a fixed appearance that
    // implies the same confidence regardless of what the device actually
    // reported.
    if (userAccuracyCircle) {
      const acc = accuracy || 15;
      const fillOpacity = acc > 30 ? 0.22 : acc > 15 ? 0.16 : 0.08;
      userAccuracyCircle.setStyle({ fillOpacity, opacity: Math.min(0.9, fillOpacity * 3) });
    }
    return effectiveHeading;
  }

  function removeUserMarker() {
    cancelMarkerTween();
    smoothedHeadingDeg = null;
    if (userDotMarker) { map.removeLayer(userDotMarker); map.removeLayer(userAccuracyCircle); userDotMarker = null; userAccuracyCircle = null; }
  }

  // Camera intelligence: walking/cycling look-ahead (bias the visual center
  // a little ahead of the user, in their direction of travel, once a real
  // heading exists) + velocity-aware pan duration (a fix that jumped a
  // real distance gets a slightly longer, smoother pan; a near-stationary
  // fix settles quickly rather than lingering in an unnecessary animation).
  // Never fights manual exploration — only ever called while followMode is on.
  let lastCameraLatLng = null;
  function panCameraTo(lat, lon, headingDeg) {
    const lookAheadM = travelMode === "bike" ? 35 : 18;
    const target = headingDeg != null ? NavLogic.destinationPoint(lat, lon, headingDeg, lookAheadM) : { lat, lon };
    const movedM = lastCameraLatLng ? NavLogic.haversineM(lastCameraLatLng[0], lastCameraLatLng[1], lat, lon) : 0;
    const duration = movedM < 3 ? 0.35 : movedM > 25 ? 1.0 : 0.6;
    lastCameraLatLng = [lat, lon];
    map.setView([target.lat, target.lon], map.getZoom() < 16 ? 17 : map.getZoom(), { animate: true, duration, easeLinearity: 0.25 });
  }

  function renderNavStep(step) {
    if (!step) return;
    navIcon.textContent = signIcon(step.sign);
    navInstr.textContent = step.text;
    navStreet.textContent = step.streetName || "";
    navStreet.style.display = step.streetName ? "block" : "none";
  }

  function setFollowMode(on) {
    followMode = on;
    recenterBtn.classList.toggle("active", !on);
  }

  // Only a real user drag should break follow-mode — programmatic
  // map.setView() calls (our own recentering) don't fire 'dragstart'.
  map.on("dragstart", () => {
    if (currentState === NavLogic.NavState.NAVIGATING || currentState === NavLogic.NavState.OFF_ROUTE) {
      setFollowMode(false);
      // Auto-return to follow mode after a real user pan/explore, rather
      // than requiring an explicit recenter tap forever — a common,
      // expected premium-nav-app pattern ("manual exploration mode,
      // automatic return to follow mode"). Any further manual interaction
      // (another drag, a pinch) pushes the return out again via the same
      // dragstart/zoomstart handlers re-arming this timer.
      resetAutoReturnToFollowTimer();
    }
  });
  map.on("zoomstart", () => { if (!followMode) resetAutoReturnToFollowTimer(); });
  let autoReturnToFollowTimer = null;
  const AUTO_RETURN_TO_FOLLOW_MS = 12000;
  function resetAutoReturnToFollowTimer() {
    clearTimeout(autoReturnToFollowTimer);
    autoReturnToFollowTimer = setTimeout(() => {
      if (!followMode && (currentState === NavLogic.NavState.NAVIGATING || currentState === NavLogic.NavState.OFF_ROUTE)) {
        setFollowMode(true);
        if (lastFixLatLng) map.setView(lastFixLatLng, 17, { animate: true });
      }
    }, AUTO_RETURN_TO_FOLLOW_MS);
  }
  recenterBtn.addEventListener("click", () => {
    clearTimeout(autoReturnToFollowTimer);
    setFollowMode(true);
    if (lastFixLatLng) map.setView(lastFixLatLng, 17, { animate: true });
  });

  // ---------------------------------------------------------------------
  // Smart controls: "when the user is actively walking, automatically
  // minimise controls... if the user taps the screen, reveal hidden
  // controls... after several seconds of inactivity, fade them away
  // again... never interrupt navigation." Only the bottom controls card
  // is ever hidden this way — the top manoeuvre card and the map itself
  // are never affected, so essential guidance is always on screen.
  // ---------------------------------------------------------------------
  const SMART_CONTROLS_IDLE_MS = 6000;
  let smartControlsTimer = null;
  function hideSmartControls() {
    if (currentState === NavLogic.NavState.NAVIGATING || currentState === NavLogic.NavState.OFF_ROUTE) {
      navBottom.classList.add("nav-controls-hidden");
    }
  }
  function revealSmartControls() {
    navBottom.classList.remove("nav-controls-hidden");
  }
  function resetSmartControlsTimer() {
    revealSmartControls();
    clearTimeout(smartControlsTimer);
    smartControlsTimer = setTimeout(hideSmartControls, SMART_CONTROLS_IDLE_MS);
  }
  function clearSmartControlsTimer() {
    clearTimeout(smartControlsTimer);
    smartControlsTimer = null;
  }
  // Tapping anywhere on the map (not just the controls themselves) reveals
  // them again and restarts the idle countdown — "if the user taps the
  // screen, reveal hidden controls."
  map.getContainer().addEventListener("pointerdown", () => {
    if (currentState === NavLogic.NavState.NAVIGATING || currentState === NavLogic.NavState.OFF_ROUTE) resetSmartControlsTimer();
  });
  // Interacting with a control itself obviously counts as activity too —
  // otherwise reaching for Mute right as the card fades could tap through
  // to a half-hidden button.
  navBottom.addEventListener("pointerdown", () => resetSmartControlsTimer());

  navMuteBtn.addEventListener("click", () => {
    voice.setMuted(!voice.muted);
    navMuteBtn.classList.toggle("muted", voice.muted);
    navMuteBtn.classList.toggle("active", !voice.muted);
    // iOS Safari (most aggressively in installed-PWA/standalone mode) only
    // ever lets speechSynthesis actually produce sound if speak() is called
    // synchronously inside a real user-gesture handler at least once per
    // page load. Every other announce() call in this app fires later,
    // asynchronously, off a geolocation watchPosition callback — which iOS
    // silently swallows (no error, just no audio) unless this tap already
    // "primed" the API. Doubles as real audible confirmation that the
    // toggle actually did something.
    if (!voice.muted) voice.speakGeneric("Voice guidance on.", true);
    // The native engine (when driving a background session) keeps its own
    // separate muted flag — see NavigationEngine.swift/NavEngine.kt — since
    // it speaks independently of this page's VoiceEngine. Kept in sync here
    // rather than merged into one flag, since the two genuinely run on
    // different threads/processes once backgrounded.
    if (NavBridge.isNative && backgroundNavActive) {
      Capacitor.Plugins.CalmNavBackground.setMuted({ muted: voice.muted }).catch(() => {});
    }
  });
  navMuteBtn.classList.add("muted"); // voice is opt-in / off by default

  // Quick-access haptic toggle in the nav controls card — mirrors and stays
  // in sync with the existing global haptics-enabled setting (Haptic
  // Fidgeting page / prefs.js) rather than being a second, independent
  // on/off flag; toggling either one updates both. `hapticsEnabledToggle`
  // is declared later in this file (Pillar 3 section) but this handler only
  // ever runs on a later click, by which point the whole script has
  // finished loading — same convention already used elsewhere in this file.
  navHapticBtn.addEventListener("click", () => {
    const enabled = !prefs.get().haptics.enabled;
    prefs.set({ haptics: { enabled } });
    navHapticBtn.classList.toggle("active", enabled);
    if (typeof hapticsEnabledToggle !== "undefined") hapticsEnabledToggle.checked = enabled;
  });
  navHapticBtn.classList.toggle("active", prefs.get().haptics.enabled);

  // Settings is reachable from the nav controls card too, since the header
  // (and its own settings button) is hidden in full-screen nav mode.
  // openSettings() is declared near the very top of this file (a hoisted
  // function declaration), safe to call from here regardless of definition
  // order.
  navSettingsBtn.addEventListener("click", () => openSettings());

  // Lock-screen/notification controls (Android's persistent notification,
  // iOS's Now Playing/Control Center commands) — see
  // native/nativeNotificationController.js. No-op on web (WebNotification
  // Controller never fires onAction).
  NavBridge.notification.onAction((event) => {
    if (event.action === "stop") { endNavigation(); }
    else if (event.action === "mute") {
      voice.setMuted(true);
      navMuteBtn.classList.add("muted");
      navMuteBtn.classList.remove("active");
      if (NavBridge.isNative) Capacitor.Plugins.CalmNavBackground.setMuted({ muted: true }).catch(() => {});
    } else if (event.action === "unmute") {
      voice.setMuted(false);
      navMuteBtn.classList.remove("muted");
      navMuteBtn.classList.add("active");
      if (NavBridge.isNative) Capacitor.Plugins.CalmNavBackground.setMuted({ muted: false }).catch(() => {});
    }
  });

  // Reconcile the foreground UI with whatever the native engine did while
  // this page was backgrounded/suspended — see shared/lifecycleReconciler.js.
  // Only ever acts when a native background session was actually running;
  // otherwise a no-op; never starts a second location watcher.
  NavBridge.lifecycle.onForeground(async () => {
    if (!NavBridge.isNative || !backgroundNavActive) return;
    let nativeSnapshot = null;
    try {
      const snap = await NavBridge.backgroundNav.getSnapshot();
      nativeSnapshot = snap && snap.active ? snap : null;
    } catch (e) { /* leave null — reconciler treats that as "nothing to restore" */ }

    const result = reconcileForegroundState({
      nativeSnapshot,
      webSnapshot: { hasLocalWatcher: navWatchId != null, stepIdx: navState ? navState.stepIdx : 0, state: currentState },
    });
    if (result.stopWebWatcher && navWatchId != null) {
      navigator.geolocation.clearWatch(navWatchId);
      navWatchId = null;
    }
    if (result.source !== "native") return;

    if (result.restoreState === "arrived") {
      currentState = NavLogic.NavState.ARRIVED;
      showArrivedScreen();
      return;
    }
    currentState = result.restoreState === "off_route" ? NavLogic.NavState.OFF_ROUTE : NavLogic.NavState.NAVIGATING;
    if (result.restoreDistToNextManeuver != null) navDist.textContent = fmtDist(result.restoreDistToNextManeuver);
    if (result.restoreDistToDestination != null) {
      const modeSpeedMps = NavLogic.TRAVEL_MODES[travelMode].speedMps;
      const remainingMs = (result.restoreDistToDestination / modeSpeedMps) * 1000;
      navEta.textContent = fmtMin(remainingMs) + " remaining";
      navArrivalClock.textContent = fmtArrivalClock(remainingMs);
    }
    const route = result.restoreRoute;
    if (route && route.maneuvers && route.maneuvers[result.restoreStepIdx]) {
      const m = route.maneuvers[result.restoreStepIdx];
      navInstr.textContent = m.text;
      navIcon.textContent = signIcon(m.sign);
    }
  });

  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
    } catch (e) {
      wakeLock = null; // unsupported or refused — navigation still works, screen may just sleep
    }
  }
  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }

  function showArrivedScreen() {
    document.getElementById("arrivedSub").textContent =
      `You reached ${resolvedEnd.label || "your destination"}.`;
    navArrived.style.display = "flex";
    // Arrival flourish: a soft scale+fade entrance (see style.css's
    // .nav-arrived/.nav-arrived.visible) rather than an instant snap —
    // .visible is added a frame later so the browser registers the
    // opacity:0/scale(0.96) starting state first and actually has
    // something to transition from.
    requestAnimationFrame(() => navArrived.classList.add("visible"));
    voice.announceArrival();
    navEffects.playArrival();
    if (typeof feedbackEngine !== "undefined") feedbackEngine.onArrival();
    if (typeof ambient !== "undefined") ambient.setLevel(0.85);
  }

  // The single, unconditional teardown for "whatever might currently be
  // feeding handleFix() / the native nav engine." Root-cause fix for a real
  // bug: startNavigation() used to assume it was only ever called once per
  // session, so a double-tap on Start/Simulate (or Start followed by
  // Simulate, or any other combination) left the PREVIOUS watchPosition
  // subscription/simulator timer/native session running and un-tracked
  // (its ID was simply overwritten), while a second one started alongside
  // it — both silently feeding the same shared navState forever after.
  // Every fix from every leaked source then ran the full pipeline a second
  // time: duplicate camera pans interrupting each other mid-animation,
  // duplicate marker-tween restarts, duplicate haptic/turn-tick sounds, and
  // duplicate NavLogic.processFix() calls on shared mutable state — this is
  // what "audio hops/stutters/repeats" during navigation actually was.
  // Calling this unconditionally at the top of startNavigation(), not just
  // in endNavigation(), is what makes "at most one location source is ever
  // active" true by construction instead of by hoping nothing ever calls
  // startNavigation() twice.
  function stopActiveLocationSource() {
    if (navWatchId != null) navigator.geolocation.clearWatch(navWatchId);
    navWatchId = null;
    if (simulator) simulator.stop();
    if (backgroundNavActive || NavBridge.isNative) NavBridge.backgroundNav.stopSession().catch(() => {});
    backgroundNavActive = false;
  }

  function endNavigation(message) {
    stopActiveLocationSource();
    backgroundNavNote.style.display = "none";
    usingSimulatedGps = false;
    simBadge.style.display = "none";
    navState = null;
    currentState = NavLogic.NavState.IDLE;
    navRerouting = false;
    appShellEl.classList.remove("nav-fullscreen");
    pageInner0.classList.remove("nav-active");
    navBottom.classList.remove("nav-controls-hidden");
    clearSmartControlsTimer();
    navArrived.style.display = "none";
    navArrived.classList.remove("visible");
    recenterBtn.style.display = "none";
    startNavBtn.style.display = lastResult ? "flex" : "none";
    startNavBtn.disabled = false;
    simBtn.disabled = false;
    removeUserMarker();
    releaseWakeLock();
    if (typeof ambient !== "undefined") ambient.setLevel(1);
    if (message) modeNote.textContent = message;
  }

  async function reroute(lat, lon) {
    if (navRerouting) return;
    navRerouting = true;
    currentState = NavLogic.NavState.RECALCULATING;
    navInstr.textContent = "Recalculating route…";
    navIcon.textContent = "↻";
    voice.announceRecalculating();
    navEffects.playRecalculating();
    if (typeof feedbackEngine !== "undefined") feedbackEngine.onRecalculating();
    try {
      const newStart = { label: "Current location", lat, lon };
      const result = await fetchCalmRoute({
        start: newStart,
        end: resolvedEnd,
        peakWindows: CONFIG.PEAK_WINDOWS,
        safetyMode: safetyToggle.checked,
        specialEvents: CONFIG.SPECIAL_EVENTS,
        ghProfile: NavLogic.TRAVEL_MODES[travelMode].ghProfile,
        endpointBase: apiBaseUrl,
      });
      lastResult = result;
      resolvedStart = newStart;
      const freshRoute = selected === "fast" ? result.fastest : result.calm;
      NavLogic.resetForNewRoute(navState, freshRoute);
      voice.reset();
      if (typeof feedbackEngine !== "undefined") feedbackEngine.reset();
      drawRoute(result, newStart, resolvedEnd, { isReroute: true });
      renderNavStep(freshRoute.steps && freshRoute.steps[0]);
      currentState = NavLogic.NavState.NAVIGATING;
    } catch (e) {
      // Recalculation failed outright (rare — fetchCalmRoute itself already
      // falls back to a demo route on network/API errors). Keep navigating
      // on the last known-good route rather than stranding the user.
      currentState = NavLogic.NavState.NAVIGATING;
      showError("Couldn't recalculate your route — continuing on the original one.");
    } finally {
      navRerouting = false;
    }
  }

  function handleFix(pos) {
    const { latitude: lat, longitude: lon, accuracy, speed, heading } = pos.coords;
    lastFixLatLng = [lat, lon];

    if (!navState) return;
    const info = NavLogic.processFix(navState, { lat, lon, speedMps: speed, headingDeg: heading });

    const effectiveHeading = updateUserMarker(lat, lon, accuracy, info.heading);
    if (followMode) panCameraTo(lat, lon, effectiveHeading);

    if (info.arrived) {
      currentState = NavLogic.NavState.ARRIVED;
      showArrivedScreen();
      if (navWatchId != null) navigator.geolocation.clearWatch(navWatchId);
      if (simulator) simulator.stop();
      return;
    }

    if (info.shouldReroute && !navRerouting) {
      if (currentState !== NavLogic.NavState.OFF_ROUTE) {
        navEffects.playOffRouteAlert();
        if (typeof feedbackEngine !== "undefined") feedbackEngine.onOffRoute();
      }
      reroute(lat, lon);
      return;
    }
    if (navRerouting) return;

    currentState = info.state;
    renderNavStep(info.step);
    navDist.textContent = fmtDist(info.distToNextManeuver);
    const modeSpeedMps = NavLogic.TRAVEL_MODES[travelMode].speedMps;
    const remainingMs = (info.distToDestination / modeSpeedMps) * 1000;
    navEta.textContent = fmtMin(remainingMs) + " remaining";
    navArrivalClock.textContent = fmtArrivalClock(remainingMs);
    voice.announce(info.stepIdx, info.distToNextManeuver, info.step && info.step.text, info.passedStep);
    if (info.distToNextManeuver <= 40 && info.distToNextManeuver > NavLogic.THRESHOLDS.ARRIVE_STEP_M) navEffects.playTurnTick();

    // Context-aware ambient mix: what's actually available is the road class
    // under the user's current position (from the route's own data — see
    // roadClassAt in navlogic.js), their real walking/riding speed from GPS,
    // and nav state. No traffic API and no weather API are wired into this
    // app, so those two named context sources are simply not inputs here.
    if (typeof ambient !== "undefined" && ambient.soundscape !== "off") {
      const suggestion = NavLogic.suggestAmbientLevel({ navState: currentState, roadClass: info.currentRoadClass, speedMps: info.speedMps });
      ambient.setLevel(suggestion.level);
    }
    if (typeof feedbackEngine !== "undefined" && feedbackEngine.onNavStep) feedbackEngine.onNavStep(info);
  }

  // Foreground UI updates only, for when CalmNavBackground is the engine
  // actually driving navigation (native platform). Never re-runs
  // NavLogic.processFix (the native side already did the equivalent math
  // natively) and never calls voice.announce (the native side already spoke
  // it, natively — see IOS_/ANDROID_BACKGROUND_NAVIGATION.md). This is what
  // keeps exactly one engine in charge of a given fix stream.
  function handleNativeNavEvent(event) {
    if (event.type === "fix" && event.fix) {
      const { lat, lon, accuracyM, headingDeg } = event.fix;
      lastFixLatLng = [lat, lon];
      const effectiveHeading = updateUserMarker(lat, lon, accuracyM, headingDeg);
      if (followMode) panCameraTo(lat, lon, effectiveHeading);
      return;
    }
    if (event.type === "maneuver") {
      currentState = NavLogic.NavState.NAVIGATING;
      navInstr.textContent = event.instruction || navInstr.textContent;
      navDist.textContent = fmtDist(event.distToNextManeuver || 0);
      const modeSpeedMps = NavLogic.TRAVEL_MODES[travelMode].speedMps;
      const remainingMs = ((event.distToDestination || 0) / modeSpeedMps) * 1000;
      navEta.textContent = fmtMin(remainingMs) + " remaining";
      navArrivalClock.textContent = fmtArrivalClock(remainingMs);
      return;
    }
    if (event.type === "offroute") {
      currentState = NavLogic.NavState.OFF_ROUTE;
      navEffects.playOffRouteAlert();
      if (typeof feedbackEngine !== "undefined") feedbackEngine.onOffRoute();
      return;
    }
    if (event.type === "reroute-needed") {
      currentState = NavLogic.NavState.RECALCULATING;
      navInstr.textContent = "Recalculating route…";
      navIcon.textContent = "↻";
      navEffects.playRecalculating();
      if (typeof feedbackEngine !== "undefined") feedbackEngine.onRecalculating();
      return;
    }
    if (event.type === "rerouted") {
      currentState = NavLogic.NavState.NAVIGATING;
      return;
    }
    if (event.type === "arrived") {
      currentState = NavLogic.NavState.ARRIVED;
      showArrivedScreen();
      return;
    }
    if (event.type === "error") {
      showError(event.message || "Background navigation hit a problem.");
      return;
    }
    if (event.type === "state" && event.state === "audio-interrupted") {
      // Phone call / Siri / other app took audio focus — nothing to do here;
      // the native side resumes its own audio session once it's clear.
      return;
    }
  }

  function geoErrorMessage(err) {
    // GeolocationPositionError codes: 1 permission denied, 2 position
    // unavailable, 3 timeout. Only permission denial is treated as fatal
    // (navigator.geolocation.watchPosition keeps retrying on its own for 2/3).
    if (err && err.code === 1) return { fatal: true, message: "Location access was denied. Turn on location permission for this site to use live navigation." };
    if (err && err.code === 2) return { fatal: false, message: "Can't get a GPS fix right now — keep the app open, this usually recovers outdoors." };
    return { fatal: false, message: "GPS signal is temporarily unavailable." };
  }

  function startNavigation() {
    if (!lastResult) return;
    if (!NavBridge.isNative && !navigator.geolocation) {
      showError("Live GPS navigation isn't available on this browser.");
      return;
    }
    // Belt-and-suspenders alongside stopActiveLocationSource() below: this
    // stops a rapid double-tap (or tapping Start then Simulate before the
    // first has visibly started) from even reaching the rest of this
    // function while a previous call is still mid-transition. Re-enabled
    // only in endNavigation() — from this point until navigation actually
    // ends, a second trigger is a no-op rather than a second concurrent
    // session.
    if (startNavBtn.disabled && simBtn.disabled) return;
    startNavBtn.disabled = true;
    simBtn.disabled = true;
    // The actual root-cause fix: unconditionally tear down whatever might
    // already be feeding handleFix() before starting a new source. Safe to
    // call even when nothing is active (every step inside is itself
    // guarded). See stopActiveLocationSource()'s own comment for the bug
    // this closes — a real, reproduced double-watchPosition leak.
    stopActiveLocationSource();
    clearError();
    currentState = NavLogic.NavState.REQUESTING_LOCATION;
    const route = selected === "fast" ? lastResult.fastest : lastResult.calm;
    navState = NavLogic.createNavState(route);
    voice.reset();
    if (typeof feedbackEngine !== "undefined") feedbackEngine.reset();
    setFollowMode(true);
    lastCameraLatLng = null;
    // Root-cause fix, paired with the CSS hardening on
    // .app-shell.nav-fullscreen in style.css: if an input (most plausibly
    // startInput/endInput, if the user was still editing an address when
    // they tapped Start/Simulate) held focus, explicitly clear it before
    // navigation takes over the screen. Some browsers blur a text input
    // automatically when a <button> is tapped, but iOS Safari/WKWebView
    // specifically does not move focus to buttons on tap — without this, a
    // previously-focused input could stay focused straight into full-screen
    // nav mode (invisible, since .nav-active resizes it to zero size, but
    // still logically focused), which is exactly the condition that can
    // surface the OS's own text-edit/undo popup on a later long-press or
    // system gesture. document.activeElement is always an Element per spec
    // (defaults to <body>), never null.
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
    appShellEl.classList.add("nav-fullscreen");
    pageInner0.classList.add("nav-active");
    navArrived.style.display = "none";
    navArrived.classList.remove("visible");
    startNavBtn.style.display = "none";
    renderNavStep(route.steps && route.steps[0]);
    navDist.textContent = "Locating…";
    navEta.textContent = "";
    navArrivalClock.textContent = "—";
    // The actual full-screen resize is CSS-driven now (.page-inner.nav-active
    // .map-wrap/#map — see style.css); the ResizeObserver set up alongside
    // the map (near its creation, above) keeps Leaflet's tile grid in sync
    // with .map-wrap's real size throughout and after this transition, no
    // explicit call needed here.
    resetSmartControlsTimer();
    requestWakeLock();

    if (usingSimulatedGps) {
      simulator = simulator || new NavSimulator(() => navState && navState.route, handleFix);
      simBadge.style.display = "block";
      simulator.start(NavLogic.TRAVEL_MODES[travelMode].speedMps * 6, 500); // 6x real pace, for fast demoing
      currentState = NavLogic.NavState.NAVIGATING;
      return;
    }

    if (NavBridge.isNative) {
      startNativeNavigation(route);
      return;
    }

    navWatchId = navigator.geolocation.watchPosition(
      handleFix,
      (err) => {
        const { fatal, message } = geoErrorMessage(err);
        if (fatal) {
          currentState = NavLogic.NavState.ERROR;
          endNavigation();
        }
        showError(message);
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
  }

  // Hands the route to the native CalmNavBackground plugin, which becomes
  // the sole engine driving this session (foreground UI updates flow back
  // via handleNativeNavEvent — see that function's own header comment for
  // why it never touches NavLogic.processFix or voice.announce directly).
  // Never falls back to navigator.geolocation on native: Capacitor's WebView
  // does not implement the Geolocation Web API reliably, which is exactly
  // why this plugin exists.
  async function startNativeNavigation(route) {
    const wantsBackground = backgroundNavToggle.checked;
    backgroundNavNote.style.display = "none";
    const plugin = Capacitor.Plugins.CalmNavBackground;

    const fgStatus = await plugin.getPermissionStatus();
    if (fgStatus.foreground !== "granted") {
      const req = await plugin.requestForegroundLocationPermission();
      if (!req.granted) {
        showError("Location access was denied. Turn on location permission in Settings to use live navigation.");
        endNavigation();
        return;
      }
    }
    // Staged by design: background ("Always"/"allow all the time") is only
    // ever requested here, after the user has already started foreground
    // navigation and explicitly checked "keep navigating when locked" —
    // never on first launch.
    if (wantsBackground && fgStatus.background !== "granted") {
      const bgReq = await plugin.requestBackgroundLocationPermission();
      if (!bgReq.granted) {
        backgroundNavNote.textContent = bgReq.reason || "Background permission wasn't granted — navigation will pause while locked/backgrounded.";
        backgroundNavNote.style.display = "block";
      }
    }

    const payload = buildNavRoutePayload({
      route, destination: resolvedEnd, travelMode, safetyMode: safetyToggle.checked, thresholds: NavLogic.THRESHOLDS,
    });
    const validation = validateNavRoutePayload(payload);
    if (!validation.valid) {
      showError("Couldn't start navigation: " + validation.errors.join("; "));
      endNavigation();
      return;
    }

    NavBridge.backgroundNav.onEvent(handleNativeNavEvent);
    let result;
    try {
      result = await NavBridge.backgroundNav.startSession(payload, {
        wantsBackground,
        muted: voice.muted,
        allowAmbient: typeof ambient !== "undefined" && ambient.soundscape !== "off",
        apiBaseUrl,
      });
    } catch (e) {
      showError("Couldn't start background navigation — falling back isn't available on this platform.");
      endNavigation();
      return;
    }
    backgroundNavActive = !!result.backgrounded;
    currentState = NavLogic.NavState.NAVIGATING;
    if (!result.backgrounded && result.reason) {
      backgroundNavNote.textContent = result.reason;
      backgroundNavNote.style.display = "block";
    }
  }

  startNavBtn.addEventListener("click", () => { usingSimulatedGps = false; startNavigation(); });
  simBtn.addEventListener("click", () => { usingSimulatedGps = true; startNavigation(); });
  navEndBtn.addEventListener("click", () => endNavigation());
  document.getElementById("arrivedDoneBtn").addEventListener("click", () => endNavigation());

  // ---------------------------------------------------------------------
  // PILLAR 2 — Auditory regulation
  // An adaptive audio layer: AmbientEngine (soundscapes) + VoiceEngine
  // (already wired above, nav voice) + EffectsEngine share one AudioManager,
  // so a preset or a volume slider here affects the whole app's mix, not
  // just this page. See ambientengine.js's file header for why "café" isn't
  // offered as a soundscape (nothing here is a placeholder — it's an
  // honestly-scoped omission).
  //
  // prefs.get().audio is the one authoritative state object for this whole
  // screen (per the fix task's "one authoritative state object" requirement)
  // — every control below reads FROM it and writes THROUGH it; DOM
  // classes/slider values are a rendering of that state, never the source of
  // it. Every interaction follows: action -> prefs.set/applyAudioPreset ->
  // apply*ToEngines() -> render*UI() -> already persisted (Prefs.set saves
  // synchronously).
  // ---------------------------------------------------------------------
  const ambient = new AmbientEngine(audioManager);
  const presetChips = document.querySelectorAll("#presetChips .pill");
  const modeChips = document.querySelectorAll("#modeChips .pill");
  const soundChips = document.querySelectorAll("#soundChips .pill");
  const ambientVolSlider = document.getElementById("ambientVolSlider");
  const voiceVolSlider = document.getElementById("voiceVolSlider");
  const effectsVolSlider = document.getElementById("effectsVolSlider");
  const captionsToggleEl = document.getElementById("captionsToggle");
  const auditoryMasterBtn = document.getElementById("auditoryMasterBtn");
  const auditoryEnabledToggle = document.getElementById("auditoryEnabledToggle");
  const settingsPresetChips = document.querySelectorAll("#settingsPresetChips .pill");
  const settingsModeChips = document.querySelectorAll("#settingsModeChips .pill");
  const settingsSoundChips = document.querySelectorAll("#settingsSoundChips .pill");
  const settingsAmbientVol = document.getElementById("settingsAmbientVol");
  const settingsVoiceVol = document.getElementById("settingsVoiceVol");
  const settingsEffectsVol = document.getElementById("settingsEffectsVol");
  const resetAudioDefaultsBtn = document.getElementById("resetAudioDefaultsBtn");

  // iOS Safari only allows the audio context to unlock inside a direct user
  // gesture — do it on the very first tap anywhere, not just a sound chip, so
  // it's unlocked as early as possible. Respects the master enabled switch:
  // if the user had auditory regulation OFF last session, don't start
  // playing anything just because they tapped elsewhere in the app.
  const unlockAudioOnce = () => {
    audioManager.ensureCtx();
    const a = prefs.get().audio;
    if (a.enabled && ambient.soundscape && ambient.soundscape !== "off" && !ambient.layers.length) {
      ambient.setSoundscape(ambient.soundscape, a.ambientVolume);
    }
    window.removeEventListener("touchend", unlockAudioOnce);
    window.removeEventListener("click", unlockAudioOnce);
  };
  window.addEventListener("touchend", unlockAudioOnce, { once: true });
  window.addEventListener("click", unlockAudioOnce, { once: true });

  // Slider <-> state-field pairing, built once rather than re-allocated on
  // every render — renderVolumesUI below just iterates this.
  const VOLUME_SLIDER_FIELDS = [
    [ambientVolSlider, "ambientVolume"], [voiceVolSlider, "voiceVolume"], [effectsVolSlider, "effectsVolume"],
    [settingsAmbientVol, "ambientVolume"], [settingsVoiceVol, "voiceVolume"], [settingsEffectsVol, "effectsVolume"],
  ];

  // ---- render: state -> DOM (never the other direction) ----
  function renderPresetUI(name) {
    presetChips.forEach((c) => c.classList.toggle("calm-active", c.dataset.preset === name));
    settingsPresetChips.forEach((c) => c.classList.toggle("calm-active", c.dataset.preset === name));
  }
  function renderModeUI(mode) {
    modeChips.forEach((c) => c.classList.toggle("calm-active", c.dataset.mode === mode));
    settingsModeChips.forEach((c) => c.classList.toggle("calm-active", c.dataset.mode === mode));
  }
  function renderSoundUI(name) {
    soundChips.forEach((c) => c.classList.toggle("active", c.dataset.sound === name));
    settingsSoundChips.forEach((c) => c.classList.toggle("active", c.dataset.sound === name));
  }
  function renderVolumesUI(a) {
    VOLUME_SLIDER_FIELDS.forEach(([el, field]) => {
      const pct = String(Math.round(a[field] * 100));
      el.value = pct;
      el.setAttribute("aria-valuenow", pct);
    });
  }
  function renderMasterUI(enabled) {
    auditoryMasterBtn.setAttribute("aria-pressed", String(enabled));
    auditoryMasterBtn.setAttribute("aria-label", enabled ? "Turn auditory regulation off" : "Turn auditory regulation on");
    auditoryEnabledToggle.checked = enabled;
  }
  // The one place a full state object is reflected into every control on
  // this screen — used after any change that can affect more than one field
  // (preset selection, reset-to-defaults, initial load) so those call sites
  // never have to remember which of the five render* functions to call.
  function renderAuditoryUI(a) {
    renderPresetUI(a.preset);
    renderModeUI(a.mode);
    renderSoundUI(a.soundscape);
    renderVolumesUI(a);
    renderMasterUI(a.enabled);
  }

  // ---- apply: state -> real audio engines (no duplicate audio systems —
  // this only ever calls into the existing AmbientEngine/AudioManager) ----
  function applyVolumesToEngines(a) {
    audioManager.setBusVolume("ambient", a.ambientVolume);
    audioManager.setBusVolume("voice", a.voiceVolume);
    audioManager.setBusVolume("effects", a.effectsVolume);
  }
  function applyModeToEngines(mode) {
    ambient.setMode(mode);
    audioManager.setRegulationMode(mode);
  }
  function applyNightModeToEngines(on) {
    ambient.setNightMode(on);
    audioManager.setNightMode(on);
  }
  // Only actually plays a.soundscape if the master switch is on — otherwise
  // just remembers the selection on the engine so turning regulation back on
  // can resume it without re-reading prefs.
  function applySoundscapeToEngine(a) {
    if (!a.enabled) { ambient.soundscape = a.soundscape; return; }
    ambient.setSoundscape(a.soundscape, a.ambientVolume);
  }
  // Counterpart to renderAuditoryUI — mode, volumes, and soundscape all at
  // once. Night mode is deliberately NOT included here: it's set only via
  // setNightMode(), never as a side effect of a preset/reset.
  function applyAuditoryState(a) {
    applyModeToEngines(a.mode);
    applyVolumesToEngines(a);
    applySoundscapeToEngine(a);
  }

  // Exposed for setNightMode() (called from the theme-toggle handler above,
  // defined before `ambient`/`audioManager` exist in file order but only
  // ever invoked later, after the whole script has loaded).
  function setNightMode(on) {
    prefs.set({ audio: { nightMode: on } });
    applyNightModeToEngines(on);
  }

  // ---- the interaction flow every control below goes through:
  // user action -> update state (prefs) -> update engines -> update UI ----

  /**
   * Applies a named preset (or restores the last-captured Custom state) and
   * syncs it everywhere: prefs, both audio buses, the selected soundscape,
   * and every control's on-screen state. `name` is trusted to be one of
   * Prefs.AUDIO_PRESETS' own keys — callers below validate that first.
   */
  function setPreset(name) {
    const a = prefs.applyAudioPreset(name);
    renderAuditoryUI(a);
    applyAuditoryState(a);
  }
  /** Manual mode change: persists it, demotes the active preset to Custom (per the fix task's requirement), then re-syncs. */
  function setMode(mode) {
    prefs.set({ audio: { mode } });
    prefs.captureCustomAudio();
    const a = prefs.get().audio;
    renderModeUI(a.mode);
    renderPresetUI(a.preset);
    applyModeToEngines(a.mode);
  }
  /**
   * Manual soundscape change: persists it, demotes to Custom, plays it,
   * preserving the current ambient volume. Picking an actual sound (not
   * "Off") is an unambiguous "play this" gesture, so it also turns the
   * master switch on if it was off — previously it only remembered the
   * choice silently until the separate master toggle was found and tapped,
   * which read as "no sound coming out" once the simplified page no longer
   * showed presets/mode alongside it as a hint that a master switch existed.
   */
  function setSoundscape(name) {
    const enabled = name !== "off" ? true : prefs.get().audio.enabled;
    prefs.set({ audio: { soundscape: name, enabled } });
    prefs.captureCustomAudio();
    const a = prefs.get().audio;
    renderSoundUI(a.soundscape);
    renderPresetUI(a.preset);
    renderMasterUI(a.enabled);
    applySoundscapeToEngine(a);
  }
  /** Manual slider drag (any of ambient/voice/effects, from either the main page or the settings sheet): persists, demotes to Custom, re-syncs both slider sets and the live gain nodes. */
  function setVolumes(vols) {
    prefs.set({ audio: vols });
    prefs.captureCustomAudio();
    const a = prefs.get().audio;
    renderVolumesUI(a);
    renderPresetUI(a.preset);
    applyVolumesToEngines(a);
  }
  /**
   * Master on/off. Turning off pauses playback only — the selected
   * soundscape and every slider value stay exactly as they were, so turning
   * back on resumes the same mix rather than reverting to defaults.
   */
  function setAuditoryEnabled(enabled) {
    const a = prefs.set({ audio: { enabled } }).audio;
    renderMasterUI(a.enabled);
    if (a.enabled) {
      applySoundscapeToEngine(a); // resume the remembered soundscape/level
    } else {
      ambient.setSoundscape("off"); // pause playback only — a.soundscape (the selection) is untouched
    }
  }

  // dataset.* values are trusted app markup, not external input — still
  // validated defensively here (per this file's own bar for input handling)
  // so a future typo'd data-preset/-mode/-sound attribute fails obviously
  // instead of silently corrupting persisted state.
  function isKnownPreset(name) { return Object.prototype.hasOwnProperty.call(Prefs.AUDIO_PRESETS, name); }
  function isKnownMode(mode) { return Prefs.VALID_MODES.indexOf(mode) !== -1; }
  function isKnownSoundscape(name) { return Prefs.VALID_SOUNDSCAPES.indexOf(name) !== -1; }

  function bindChipGroup(chips, datasetKey, isValid, handler) {
    chips.forEach((chip) => {
      const value = chip.dataset[datasetKey];
      if (!isValid(value)) {
        console.warn(`Auditory regulation: control has an unrecognized data-${datasetKey}="${value}" and was left unwired.`, chip);
        return;
      }
      chip.addEventListener("click", () => handler(value));
    });
  }
  bindChipGroup(presetChips, "preset", isKnownPreset, setPreset);
  bindChipGroup(settingsPresetChips, "preset", isKnownPreset, setPreset);
  bindChipGroup(modeChips, "mode", isKnownMode, setMode);
  bindChipGroup(settingsModeChips, "mode", isKnownMode, setMode);
  bindChipGroup(soundChips, "sound", isKnownSoundscape, setSoundscape);
  bindChipGroup(settingsSoundChips, "sound", isKnownSoundscape, setSoundscape);

  [ambientVolSlider, voiceVolSlider, effectsVolSlider].forEach((slider) => {
    slider.addEventListener("input", () => setVolumes({
      ambientVolume: parseFloat(ambientVolSlider.value) / 100,
      voiceVolume: parseFloat(voiceVolSlider.value) / 100,
      effectsVolume: parseFloat(effectsVolSlider.value) / 100,
    }));
  });
  [settingsAmbientVol, settingsVoiceVol, settingsEffectsVol].forEach((slider) => {
    slider.addEventListener("input", () => setVolumes({
      ambientVolume: parseFloat(settingsAmbientVol.value) / 100,
      voiceVolume: parseFloat(settingsVoiceVol.value) / 100,
      effectsVolume: parseFloat(settingsEffectsVol.value) / 100,
    }));
  });

  // Master control — the large circular waveform icon at the top of this
  // page doubles as a real button (role="button"/tabindex in index.html);
  // click and keyboard (Enter/Space) both activate it.
  function toggleAuditoryMaster() { setAuditoryEnabled(!prefs.get().audio.enabled); }
  auditoryMasterBtn.addEventListener("click", toggleAuditoryMaster);
  auditoryMasterBtn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleAuditoryMaster(); }
  });
  auditoryEnabledToggle.addEventListener("change", () => setAuditoryEnabled(auditoryEnabledToggle.checked));

  resetAudioDefaultsBtn.addEventListener("click", () => {
    const a = prefs.resetAudioDefaults();
    renderAuditoryUI(a);
    applyAuditoryState(a);
    captionsToggleEl.checked = a.captionsEnabled;
    voice.setCaptionsEnabled(a.captionsEnabled);
  });

  captionsToggleEl.checked = prefs.get().audio.captionsEnabled;

  // Restore last session's mix on load. Soundscape playback itself waits for
  // ensureCtx() on first user gesture (unlockAudioOnce above) — this only
  // records which one is selected and drives the UI/bus volumes, since
  // mobile browsers block audio autoplay before a valid user gesture.
  (function initAudioFromPrefs() {
    const a = prefs.get().audio;
    renderAuditoryUI(a);
    applyModeToEngines(a.mode);
    applyVolumesToEngines(a);
    applyNightModeToEngines(a.nightMode);
    ambient.soundscape = a.soundscape;
  })();

  // ---------------------------------------------------------------------
  // Haptic Fidgeting — no longer page 3 (that's the Kalimba now, see
  // index.html's .haptic-fidget-legacy), but every wire below is still
  // live and correct, just against hidden markup rather than deleted code.
  // A full Haptic Fidget Engine: HapticManager (device vibration + battery/
  // enabled awareness), PatternLibrary (named patterns), GestureEngine
  // (tap/doubleTap/press/longPress/swipe/drag/rub/circle recognition on the
  // ripple canvas), FeedbackEngine (ties a gesture to pattern+tone+visual).
  // The three named buttons below are quick-access presets with their own
  // hand-tuned feel; the ripple canvas is the open "interactive fidget
  // surface" driven by the gesture engine.
  // ---------------------------------------------------------------------
  const hapticSlider = document.getElementById("hapticSlider");
  const sensitivitySlider = document.getElementById("sensitivitySlider");
  const hapticsEnabledToggle = document.getElementById("hapticsEnabledToggle");
  const soundOnToggle = document.getElementById("hapticSoundToggle");

  const hapticManager = new HapticManager(prefs);
  if (!NavBridge.isNative) NavBridge.haptics = new WebHapticProvider(hapticManager);
  const feedbackEngine = new FeedbackEngine(hapticManager, audioManager, prefs);
  const PENTATONIC = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25]; // C D E G A C D E

  if (!HapticSupport.available) {
    document.getElementById("noHapticNote").style.display = "block";
  }

  (function initHapticsFromPrefs() {
    const h = prefs.get().haptics;
    hapticSlider.value = Math.round(h.intensity * 100);
    sensitivitySlider.value = Math.round(h.sensitivity * 100);
    hapticsEnabledToggle.checked = h.enabled;
    soundOnToggle.checked = h.soundOn;
  })();
  hapticSlider.addEventListener("input", () => prefs.set({ haptics: { intensity: parseFloat(hapticSlider.value) / 100 } }));
  sensitivitySlider.addEventListener("input", () => prefs.set({ haptics: { sensitivity: parseFloat(sensitivitySlider.value) / 100 } }));
  hapticsEnabledToggle.addEventListener("change", () => prefs.set({ haptics: { enabled: hapticsEnabledToggle.checked } }));
  soundOnToggle.addEventListener("change", () => prefs.set({ haptics: { soundOn: soundOnToggle.checked } }));

  function playFidgetTone(freq, duration) { feedbackEngine._tone(freq, duration); }

  document.getElementById("fidgetTap").addEventListener("click", () => {
    hapticManager.vibratePattern(PatternLibrary.PATTERNS.softTap);
    burstRipple(1);
    playFidgetTone(PENTATONIC[2], 0.5);
  });
  let holdInterval = null;
  const holdBtn = document.getElementById("fidgetHold");
  function startHold() {
    hapticManager.vibratePattern(PatternLibrary.PATTERNS.slowPulse);
    burstRipple(1);
    let step = 0;
    playFidgetTone(PENTATONIC[0], 0.4);
    holdInterval = setInterval(() => {
      hapticManager.vibratePulse(10);
      step = (step + 1) % PENTATONIC.length;
      playFidgetTone(PENTATONIC[step], 0.35);
    }, 220);
  }
  function endHold() { clearInterval(holdInterval); }
  holdBtn.addEventListener("mousedown", startHold);
  holdBtn.addEventListener("touchstart", (e) => { startHold(); e.preventDefault(); }, { passive: false });
  window.addEventListener("mouseup", endHold);
  window.addEventListener("touchend", endHold);

  document.getElementById("fidgetPattern").addEventListener("click", () => {
    hapticManager.vibratePattern(PatternLibrary.PATTERNS.rollingPulse);
    burstRipple(3);
    [0, 2, 4, 7].forEach((idx, i) => setTimeout(() => playFidgetTone(PENTATONIC[idx], 0.4), i * 110));
  });

  // ---------------------------------------------------------------------
  // Ripple canvas — the open interactive fidget surface. Visual rendering
  // (drawRipples/resizeRipple) is unchanged; GestureEngine below replaces
  // the old single "click = one ripple" handler with full gesture
  // recognition (tap, doubleTap, press, longPress, swipe, drag, rub, circle).
  // ---------------------------------------------------------------------
  const rippleCanvas = document.getElementById("rippleCanvas");
  const rCtx = rippleCanvas.getContext("2d");
  let ripples = [];

  function resizeRipple() {
    const rect = rippleCanvas.getBoundingClientRect();
    rippleCanvas.width = rect.width * (window.devicePixelRatio || 1);
    rippleCanvas.height = rect.height * (window.devicePixelRatio || 1);
  }
  window.addEventListener("resize", resizeRipple);

  let rippleLoopRunning = false;

  function burstRipple(count, atX, atY) {
    const rect = rippleCanvas.getBoundingClientRect();
    const scaleX = rippleCanvas.width / rect.width, scaleY = rippleCanvas.height / rect.height;
    const cx = atX != null ? (atX - rect.left) * scaleX : (rect.width / 2) * scaleX;
    const cy = atY != null ? (atY - rect.top) * scaleY : (rect.height / 2) * scaleY;
    for (let i = 0; i < (count || 1); i++) {
      ripples.push({ x: cx, y: cy, r: 2 + i * 6, alpha: 0.6 });
    }
    if (ripples.length > 24) ripples = ripples.slice(-24);
    // The draw loop stops rescheduling itself once idle (see drawRipples) to
    // avoid animating an empty canvas forever — restart it here if needed.
    if (!rippleLoopRunning) {
      rippleLoopRunning = true;
      requestAnimationFrame(drawRipples);
    }
  }

  const GESTURE_RIPPLE_COUNT = { tap: 1, doubleTap: 2, press: 1, longPress: 2, swipe: 2, drag: 1, rub: 3, circle: 4 };
  feedbackEngine.visualFn = (gesture) => {
    burstRipple(GESTURE_RIPPLE_COUNT[gesture.type] || 1, gesture.x, gesture.y);
  };
  new GestureEngine(
    rippleCanvas,
    (gesture) => { feedbackEngine.onGesture(gesture, rippleCanvas.getBoundingClientRect()); },
    () => prefs.get().haptics.sensitivity
  );

  function drawRipples() {
    const w = rippleCanvas.width, h = rippleCanvas.height;
    rCtx.clearRect(0, 0, w, h);
    const accent = getVar("--accent");
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      rCtx.beginPath();
      rCtx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      rCtx.strokeStyle = accent;
      rCtx.globalAlpha = r.alpha;
      rCtx.lineWidth = 2 * (window.devicePixelRatio || 1);
      rCtx.stroke();
      r.r += 1.8;
      r.alpha -= 0.014;
      if (r.alpha <= 0) ripples.splice(i, 1);
    }
    rCtx.globalAlpha = 1;
    // Ripples are direct feedback for a user's own gesture, not ambient
    // motion, so they're exempt from the reduced-motion gate below — but the
    // loop still shouldn't run forever once every ripple has faded out, or
    // while the tab is backgrounded.
    if (ripples.length > 0 && !document.hidden) {
      requestAnimationFrame(drawRipples);
    } else {
      rippleLoopRunning = false;
    }
  }

  resizeRipple();

  // ---------------------------------------------------------------------
  // Sound canvas — simple level visualization for the auditory page, so it
  // isn't a bare control panel; reacts to whether sound is on and its volume.
  // ---------------------------------------------------------------------
  const soundCanvas = document.getElementById("soundCanvas");
  const sCtx = soundCanvas.getContext("2d");
  let soundT = 0;

  function resizeSoundCanvas() {
    const rect = soundCanvas.getBoundingClientRect();
    soundCanvas.width = rect.width * (window.devicePixelRatio || 1);
    soundCanvas.height = rect.height * (window.devicePixelRatio || 1);
  }
  window.addEventListener("resize", resizeSoundCanvas);

  function drawSoundCanvas() {
    const w = soundCanvas.width, h = soundCanvas.height;
    sCtx.clearRect(0, 0, w, h);
    const playing = ambient.soundscape !== "off";
    const vol = prefs.get().audio.ambientVolume;
    const calm = getVar("--calm");
    const bars = 28;
    const barW = w / bars;
    for (let i = 0; i < bars; i++) {
      const phase = soundT * (playing ? 2.2 : 0.4) + i * 0.35;
      const amp = playing ? (0.25 + vol * 0.65) : 0.08;
      const barH = (Math.sin(phase) * 0.5 + 0.5) * amp * h * 0.85 + h * 0.05;
      sCtx.fillStyle = calm;
      sCtx.globalAlpha = playing ? 0.85 : 0.35;
      const x = i * barW + barW * 0.18;
      const bw = barW * 0.64;
      const y = (h - barH) / 2;
      const r = Math.min(bw / 2, 6 * (window.devicePixelRatio || 1));
      sCtx.beginPath();
      sCtx.roundRect ? sCtx.roundRect(x, y, bw, barH, r) : sCtx.rect(x, y, bw, barH);
      sCtx.fill();
    }
    sCtx.globalAlpha = 1;
    // This is ambient, non-interactive motion (unlike the ripple canvas,
    // which only ever animates in direct response to a gesture) — it's
    // exactly what the reduced-motion setting is meant to stop, so it's
    // gated on both that and tab visibility (no point animating a hidden tab).
    if (root.getAttribute("data-motion") !== "reduced" && !document.hidden) {
      soundT += 0.045;
      requestAnimationFrame(drawSoundCanvas);
    } else {
      soundCanvasLoopRunning = false;
    }
  }
  resizeSoundCanvas();
  let soundCanvasLoopRunning = true;
  requestAnimationFrame(drawSoundCanvas);

  // Resume both canvas loops when motion is re-enabled or the tab regains
  // focus — they only pause themselves, nothing currently restarts them.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (ripples.length > 0 && !rippleLoopRunning) { rippleLoopRunning = true; requestAnimationFrame(drawRipples); }
    if (!soundCanvasLoopRunning && root.getAttribute("data-motion") !== "reduced") { soundCanvasLoopRunning = true; requestAnimationFrame(drawSoundCanvas); }
  });
  reducedMotionToggle.addEventListener("change", () => {
    if (!reducedMotionToggle.checked && !soundCanvasLoopRunning) { soundCanvasLoopRunning = true; requestAnimationFrame(drawSoundCanvas); }
  });

  // ---------------------------------------------------------------------
  // CALM ECHOES — the signature feature: after walking a bit, leave a short
  // Kalimba melody + optional message at this spot; another walker can
  // discover it later and choose whether to hear it. See CALM_ECHOES.md for
  // the full architecture/schema/API/privacy/security writeup.
  //
  // Uses NavBridge.location.start()/stop() (shared/interfaces.js) for a
  // dedicated, always-on watch — deliberately NOT threaded through the
  // turn-by-turn nav fix pipeline (navWatchId/handleFix), since exploration
  // tracking is a property of real-world walking, independent of whether the
  // user is actively following a route. During active navigation this means
  // two concurrent location subscriptions (nav's own + this one) — a modest,
  // disclosed battery tradeoff chosen over coupling two independent concerns.
  // ---------------------------------------------------------------------
  const kalimbaEngine = new KalimbaEngine(audioManager);
  const echoRecorder = new EchoRecorder({
    engine: kalimbaEngine, audioManager, hapticManager,
    onNote: (tineIndex) => triggerFlowReactivePulse(tineIndex),
  });

  // Flow Mode's Kalimba reactivity: "tiny light waves travel through the
  // interface... colours gently shift with the melody... everything remains
  // subtle." One shared fixed overlay (#flowReactivePulse), nudged per note
  // via a CSS custom property + a class toggle — a single cheap transition,
  // never a continuous requestAnimationFrame loop, so this costs nothing
  // when idle and very little even during a fast sweep across the tines.
  // No-ops entirely outside Flow Mode and under reduced motion (the element
  // is display:none there — see style.css).
  // Performance: "pause decorative animations when battery saver is enabled
  // [or] the app is backgrounded." Battery state uses the exact same
  // honest-limitation pattern as hapticmanager.js's own battery check — the
  // Battery Status API is gone from Chrome and was never in Safari, so this
  // real code activates on the shrinking set of browsers that still expose
  // it and is simply inert everywhere else (a platform gap, not a bug).
  // Deliberately NOT gated on navigation state — see FLOW_MODE.md for why
  // "pause outside active navigation" was interpreted as inapplicable here.
  let flowBatterySaver = false;
  if (typeof navigator !== "undefined" && typeof navigator.getBattery === "function") {
    navigator.getBattery().then((battery) => {
      const update = () => {
        flowBatterySaver = battery.level <= 0.2 && !battery.charging;
        updateFlowDecorPauseState();
      };
      update();
      battery.addEventListener("levelchange", update);
      battery.addEventListener("chargingchange", update);
    }).catch(() => {});
  }
  function updateFlowDecorPauseState() {
    const shouldAnimate = FlowTheme.shouldAnimateFlowDecor({
      reducedMotion: root.getAttribute("data-motion") === "reduced",
      batterySaver: flowBatterySaver,
      backgrounded: typeof document !== "undefined" && document.hidden,
    });
    root.setAttribute("data-flow-decor", shouldAnimate ? "running" : "paused");
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", updateFlowDecorPauseState);
  }
  updateFlowDecorPauseState();

  const flowReactivePulseEl = document.getElementById("flowReactivePulse");
  function triggerFlowReactivePulse(tineIndex) {
    if (!FlowTheme.isFlowActive(root.getAttribute("data-theme"))) return;
    flowReactivePulseEl.style.setProperty("--flow-reactive-tint", FlowTheme.paletteColorForTine(tineIndex));
    flowReactivePulseEl.classList.remove("active");
    // Force a reflow so re-adding the class restarts the fade-in transition
    // even if the previous pulse hasn't finished fading out yet.
    void flowReactivePulseEl.offsetWidth;
    flowReactivePulseEl.classList.add("active");
  }

  // A random, per-device pseudonymous identifier — generated here, hashed
  // server-side on arrival, and never itself sent anywhere but this app's own
  // API (see echovalidation.js's hashCreatorToken and migrations/0001_create_echoes.sql).
  function getOrCreateCreatorToken() {
    let token = localStorage.getItem("calmEchoes.creatorToken");
    if (!token) {
      token = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem("calmEchoes.creatorToken", token);
    }
    return token;
  }
  const creatorToken = getOrCreateCreatorToken();

  // One shared ephemeral toast element for every Calm Echoes message
  // ("nearby", discovery notifications, save confirmation) — see index.html's
  // own comment on #echoToast for why these don't get three separate elements.
  const echoToastEl = document.getElementById("echoToast");
  let echoToastTimer = null;
  function showEchoToast(text, ms) {
    if (echoToastTimer) clearTimeout(echoToastTimer);
    echoToastEl.textContent = text;
    echoToastEl.style.display = "block";
    echoToastTimer = setTimeout(() => { echoToastEl.style.display = "none"; }, ms || 3200);
  }

  // ---- Exploration tracking + unlock gate ----
  let explorationState = ExplorationTracker.initialExplorationState();

  // The kalimba (page 3) is always playable — playing it never requires
  // having walked anywhere. Only Record (saving what you play as a Calm
  // Echo) is gated, via refreshEchoRecordGate() below, on every GPS fix so
  // reaching the unlock mid-session enables Record live without needing to
  // navigate away and back.
  function updateUnlockCta() {
    refreshEchoRecordGate();
  }

  // ---- Nearby Echo discovery + map markers/clustering ----
  const echoMarkersLayer = L.layerGroup().addTo(map);
  let nearbyEchoes = [];
  let lastNearbyFetch = { at: 0, lat: null, lon: null };
  const shownNearbyToastIds = new Set();

  function renderEchoMarkers() {
    echoMarkersLayer.clearLayers();
    EchoMarkerClustering.clusterEchoes(nearbyEchoes, 40).forEach((cluster) => {
      const isCluster = cluster.count > 1;
      const icon = L.divIcon({
        className: "echo-marker-pin" + (isCluster ? " echo-cluster" : ""),
        html: `<div class="echo-marker-glow" aria-hidden="true"></div><div class="echo-marker-icon">${isCluster ? cluster.count : "🪕"}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      L.marker([cluster.lat, cluster.lon], { icon, keyboard: false })
        .addTo(echoMarkersLayer)
        .on("click", (e) => {
          if (FlowTheme.isFlowActive(root.getAttribute("data-theme")) && e.originalEvent) {
            spawnFlowTapRipple(e.originalEvent.clientX, e.originalEvent.clientY);
          }
          if (isCluster) { map.setView([cluster.lat, cluster.lon], Math.min(19, map.getZoom() + 2)); return; }
          openEchoDetail(cluster.echoes[0]);
        });
    });
  }

  // Flow Mode: "when tapped, a small ripple expands." One-shot, removed
  // after its own animation ends — never accumulates DOM nodes even if a
  // person taps many markers in a row.
  function spawnFlowTapRipple(clientX, clientY) {
    const ripple = document.createElement("div");
    ripple.className = "flow-tap-ripple";
    ripple.style.left = `${clientX}px`;
    ripple.style.top = `${clientY}px`;
    ripple.setAttribute("aria-hidden", "true");
    document.body.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove());
  }

  async function fetchNearbyEchoes(lat, lon) {
    try {
      const resp = await fetch(`${apiBaseUrl}/api/echoes/nearby?lat=${lat}&lon=${lon}&radiusM=500`);
      if (!resp.ok) return;
      const data = await resp.json();
      nearbyEchoes = data.echoes || [];
      renderEchoMarkers();
      const veryClose = nearbyEchoes.find((e) => e.distanceM <= 40 && !shownNearbyToastIds.has(e.id));
      if (veryClose) {
        shownNearbyToastIds.add(veryClose.id);
        showEchoToast("✨ Calm Echo nearby");
      }
    } catch (e) {
      // Best-effort: markers/toast just don't refresh this round — nothing
      // else in the app depends on this succeeding.
    }
  }

  function onEchoFix(fix) {
    explorationState = ExplorationTracker.applyFix(explorationState, { lat: fix.lat, lon: fix.lon }, Date.now());
    updateUnlockCta();
    const now = Date.now();
    const moved = lastNearbyFetch.lat == null || NavLogic.haversineM(lastNearbyFetch.lat, lastNearbyFetch.lon, fix.lat, fix.lon) > 50;
    if (moved || now - lastNearbyFetch.at > 20000) {
      lastNearbyFetch = { at: now, lat: fix.lat, lon: fix.lon };
      fetchNearbyEchoes(fix.lat, fix.lon);
    }
  }
  NavBridge.location.start(onEchoFix, () => {
    // Silent, harmless degradation (no unlock progress, no nearby markers) —
    // routing/turn-by-turn navigation have their own, separate location
    // error handling and are unaffected by this failing.
  });

  // ---- Kalimba (page 3): play always, record + leave an Echo once unlocked ----
  const kalimbaTineButtons = Array.from(document.querySelectorAll("#kalimbaTineButtons .kalimba-tine-btn"));
  const echoRecordStatus = document.getElementById("echoRecordStatus");
  const echoRecordBtn = document.getElementById("echoRecordBtn");
  const echoStopBtn = document.getElementById("echoStopBtn");
  const echoRedoBtn = document.getElementById("echoRedoBtn");
  const echoPlayBackBtn = document.getElementById("echoPlayBackBtn");
  const echoMessageField = document.getElementById("echoMessageField");
  const echoMessageInput = document.getElementById("echoMessageInput");
  const echoMessageCount = document.getElementById("echoMessageCount");
  const echoSaveBtn = document.getElementById("echoSaveBtn");

  function flashTineButton(tineIndex) {
    const btn = kalimbaTineButtons.find((b) => Number(b.dataset.tine) === tineIndex);
    if (!btn) return;
    btn.classList.add("plucked");
    setTimeout(() => btn.classList.remove("plucked"), 130);
  }

  // Pointer/multi-touch path (drag/sweep/tap/doubleTap/hold) — see
  // kalimbacontroller.js's own header for why this is a dedicated pointer
  // pipeline rather than reusing GestureEngine.
  new KalimbaController({
    canvas: document.getElementById("kalimbaTineButtons"),
    engine: kalimbaEngine,
    tuning: KalimbaTuning,
    hapticManager,
    onPluck: (tineIndex, velocity) => {
      if (echoRecorder.state.phase === "recording") echoRecorder.registerPluck(tineIndex, velocity);
      flashTineButton(tineIndex);
      triggerFlowReactivePulse(tineIndex);
    },
  });

  // Accessible fallback path — a real <button> per tine, keyboard/screen-
  // reader operable. `e.detail === 0` is the standard way to tell a
  // keyboard-triggered click apart from one synthesized after a pointer
  // tap that kalimbaController above already handled; without this guard
  // every pointer/touch tap would double-pluck (once via the controller,
  // once via this button's native click).
  kalimbaTineButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      if (e.detail !== 0) return;
      const tineIndex = Number(btn.dataset.tine);
      const velocity = KalimbaTuning.velocityFromGesture("tap");
      kalimbaEngine.pluck(tineIndex, velocity);
      if (hapticManager) hapticManager.vibratePulse(12);
      if (echoRecorder.state.phase === "recording") echoRecorder.registerPluck(tineIndex, velocity);
      flashTineButton(tineIndex);
      triggerFlowReactivePulse(tineIndex);
    });
  });

  // The one place that decides whether Record is actually pressable right
  // now. Playing the kalimba itself (kalimbaTineButtons below) is never
  // gated by this — only starting a recording (the first step toward
  // saving a Calm Echo) requires the 500m/~3min walk from
  // explorationtracker.js. Called on open and again on every GPS fix while
  // the sheet is open, so reaching the unlock mid-session enables Record
  // live rather than requiring a close/reopen.
  function refreshEchoRecordGate() {
    if (echoRecorder.state.phase === "recording") return; // don't yank the button out from under an in-progress recording
    const progress = ExplorationTracker.unlockProgress(explorationState, Date.now());
    if (progress.unlocked) {
      echoRecordBtn.disabled = false;
      echoRecordBtn.classList.remove("locked");
      echoRecordStatus.textContent = "Tap Record, then play something on the kalimba.";
    } else {
      echoRecordBtn.disabled = true;
      echoRecordBtn.classList.add("locked");
      echoRecordStatus.textContent = ExplorationTracker.progressMessage(explorationState, Date.now()) + " Feel free to play in the meantime — it's yours to enjoy any time.";
    }
  }

  function resetKalimbaSheetUI() {
    echoRecordBtn.style.display = "flex";
    echoRecordBtn.classList.remove("recording");
    echoStopBtn.style.display = "none";
    echoRedoBtn.style.display = "none";
    echoPlayBackBtn.style.display = "none";
    echoMessageField.style.display = "none";
    echoMessageInput.value = "";
    echoMessageCount.textContent = `0 / ${EchoValidation.MAX_MESSAGE_CHARS}`;
    echoSaveBtn.disabled = true;
    refreshEchoRecordGate();
  }

  let autoStopTimer = null;
  function clearAutoStopTimer() {
    if (autoStopTimer) clearTimeout(autoStopTimer);
    autoStopTimer = null;
  }
  // The kalimba used to live in a dismissible modal (open on tap, cancel any
  // in-progress recording on close). It's now just page 3's permanent
  // content instead, so there's nothing to "open" — this runs once, at
  // startup, to set the sheet to its initial ready-to-record state.
  // cancelKalimbaRecording() covers the one thing closing the old modal used
  // to guarantee: an in-progress recording can't survive you navigating
  // away — called from setActivePage() below whenever you swipe off page 3.
  resetKalimbaSheetUI();
  function cancelKalimbaRecording() {
    if (echoRecorder.state.phase !== "recording") return;
    clearAutoStopTimer();
    echoRecorder.cancel();
    resetKalimbaSheetUI();
  }

  echoRecordBtn.addEventListener("click", () => {
    echoRecorder.startRecording();
    echoRecordStatus.textContent = "Recording — play the kalimba. Stop when you're done (up to 20 seconds).";
    echoRecordBtn.style.display = "none";
    echoStopBtn.style.display = "flex";
    clearAutoStopTimer();
    autoStopTimer = setTimeout(() => {
      if (echoRecorder.state.phase === "recording") echoStopBtn.click();
    }, EchoValidation.MAX_DURATION_MS + 50);
  });

  echoStopBtn.addEventListener("click", () => {
    clearAutoStopTimer();
    echoRecorder.stopRecording();
    echoStopBtn.style.display = "none";
    if (echoRecorder.canSave()) {
      echoRecordStatus.textContent = "Nice. Listen back, add a message if you like, then leave it here.";
      echoRedoBtn.style.display = "flex";
      echoPlayBackBtn.style.display = "flex";
      echoMessageField.style.display = "block";
      echoSaveBtn.disabled = false;
    } else {
      echoRecordStatus.textContent = "That was a bit short — melodies need to be at least 2 seconds. Try again.";
      echoRedoBtn.style.display = "flex";
      echoSaveBtn.disabled = true;
    }
  });

  echoRedoBtn.addEventListener("click", () => {
    clearAutoStopTimer();
    echoRecorder.redo();
    resetKalimbaSheetUI();
  });

  echoPlayBackBtn.addEventListener("click", () => echoRecorder.play());

  echoMessageInput.addEventListener("input", () => {
    echoMessageCount.textContent = `${echoMessageInput.value.length} / ${EchoValidation.MAX_MESSAGE_CHARS}`;
  });

  echoSaveBtn.addEventListener("click", async () => {
    const payload = echoRecorder.buildSavePayload();
    if (!payload) return;
    const messageCheck = EchoValidation.validateMessage(echoMessageInput.value);
    if (!messageCheck.valid) {
      echoRecordStatus.textContent = messageCheck.error;
      return;
    }
    const fix = explorationState.lastFix;
    if (!fix) {
      echoRecordStatus.textContent = "Still finding your location — try again in a moment.";
      return;
    }
    echoSaveBtn.disabled = true;
    echoRecordStatus.textContent = "Leaving your Echo…";
    try {
      const resp = await fetch(`${apiBaseUrl}/api/echoes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lat: fix.lat, lon: fix.lon,
          durationMs: payload.durationMs, melody: payload.melody,
          message: messageCheck.value, nickname: null,
          creatorToken,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        echoRecordStatus.textContent = err.error || "Couldn't save your Echo — please try again.";
        echoSaveBtn.disabled = false;
        return;
      }
      explorationState = ExplorationTracker.consumeUnlock(explorationState, Date.now());
      updateUnlockCta();
      resetKalimbaSheetUI();
      showEchoToast("✨ Your Calm Echo was left here.");
    } catch (e) {
      echoRecordStatus.textContent = "Couldn't reach the server — please try again.";
      echoSaveBtn.disabled = false;
    }
  });

  // ---- Discovery detail sheet ----
  const echoDetailOverlay = document.getElementById("echoDetailOverlay");
  const echoDetailMessage = document.getElementById("echoDetailMessage");
  const echoDetailDistance = document.getElementById("echoDetailDistance");
  const echoDetailTime = document.getElementById("echoDetailTime");
  const echoDetailPlayBtn = document.getElementById("echoDetailPlayBtn");
  const echoDetailCloseBtn = document.getElementById("echoDetailCloseBtn");
  let openEchoId = null;
  let echoDetailReturnFocusEl = null;

  function formatRelativeTime(ms) {
    const diffMin = Math.round((Date.now() - ms) / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
    const diffDay = Math.round(diffHr / 24);
    return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  }

  function openEchoDetail(echo) {
    openEchoId = echo.id;
    echoDetailReturnFocusEl = document.activeElement;
    echoDetailMessage.textContent = echo.message || "";
    echoDetailMessage.style.display = echo.message ? "block" : "none";
    echoDetailDistance.textContent = `${echo.distanceM} m away`;
    echoDetailTime.textContent = formatRelativeTime(echo.createdAt);
    echoDetailOverlay.classList.add("open");
    echoDetailPlayBtn.focus();
  }
  function closeEchoDetail() {
    openEchoId = null;
    echoDetailOverlay.classList.remove("open");
    if (echoDetailReturnFocusEl && typeof echoDetailReturnFocusEl.focus === "function") echoDetailReturnFocusEl.focus();
    echoDetailReturnFocusEl = null;
  }
  echoDetailCloseBtn.addEventListener("click", closeEchoDetail);
  echoDetailOverlay.addEventListener("click", (e) => { if (e.target === echoDetailOverlay) closeEchoDetail(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && echoDetailOverlay.classList.contains("open")) closeEchoDetail();
  });

  echoDetailPlayBtn.addEventListener("click", async () => {
    if (!openEchoId) return;
    const id = openEchoId;
    echoDetailPlayBtn.disabled = true;
    try {
      const resp = await fetch(`${apiBaseUrl}/api/echoes/${id}/play`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listenerToken: creatorToken }),
      });
      if (resp.ok) {
        const data = await resp.json();
        echoRecorder.play({ melody: data.melody, durationMs: data.durationMs });
      }
    } catch (e) {
      // Best-effort — failing to play a discovered Echo is disappointing but not destructive.
    } finally {
      echoDetailPlayBtn.disabled = false;
    }
  });

  // ---- Creator notifications ("Someone discovered your Calm Echo.") ----
  // Polled, not pushed — this app has no push infrastructure, and a minute's
  // delay before a creator sees this is entirely in keeping with the
  // feature's own unhurried, non-engagement-optimized philosophy.
  async function pollEchoNotifications() {
    try {
      const resp = await fetch(`${apiBaseUrl}/api/echoes/notifications?creatorToken=${encodeURIComponent(creatorToken)}`);
      if (!resp.ok) return;
      const data = await resp.json();
      (data.notifications || []).forEach((n, i) => setTimeout(() => showEchoToast(n.message), i * 3600));
    } catch (e) {
      // Best-effort — a missed notification isn't worth surfacing an error for.
    }
  }
  setInterval(pollEchoNotifications, 60000);

  // ---------------------------------------------------------------------
  // Swipeable page navigation (3 pages: routing / audio / haptics)
  // ---------------------------------------------------------------------
  const pagesWrap = document.getElementById("pagesWrap");
  const pages = Array.from(document.querySelectorAll(".page"));
  const dots = Array.from(document.querySelectorAll(".dot-btn"));
  const pageTagline = document.getElementById("pageTagline");
  const TAGLINES = ["calm routing", "auditory regulation", "kalimba"];
  let currentPage = 0;
  let scrollRAF = null;

  function goToPage(i, smooth) {
    i = Math.max(0, Math.min(pages.length - 1, i));
    pagesWrap.scrollTo({ left: pages[i].offsetLeft, behavior: smooth === false ? "auto" : "smooth" });
  }

  function setActivePage(i) {
    if (i === currentPage) return;
    // Leaving the Kalimba page mid-recording cancels it — recording is tied
    // to being on that page, same guarantee closing the old kalimba modal
    // used to give for free.
    if (currentPage === 2) cancelKalimbaRecording();
    currentPage = i;
    dots.forEach((d, idx) => {
      d.classList.toggle("active", idx === i);
      d.setAttribute("aria-selected", idx === i ? "true" : "false");
    });
    pageTagline.textContent = TAGLINES[i] || "";
    if (i === 0) requestAnimationFrame(() => map.invalidateSize());
    if (i === 2) refreshEchoRecordGate();
  }

  dots.forEach((dot) => {
    dot.addEventListener("click", () => goToPage(parseInt(dot.dataset.page, 10)));
  });

  pagesWrap.addEventListener("scroll", () => {
    if (scrollRAF) cancelAnimationFrame(scrollRAF);
    scrollRAF = requestAnimationFrame(() => {
      const idx = Math.round(pagesWrap.scrollLeft / pagesWrap.clientWidth);
      setActivePage(idx);
    });
  });

  // Basic swipe support is native via scroll-snap; keyboard left/right as a
  // non-touch fallback for accessibility.
  pagesWrap.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { goToPage(currentPage + 1); e.preventDefault(); }
    if (e.key === "ArrowLeft") { goToPage(currentPage - 1); e.preventDefault(); }
  });

  // ---------------------------------------------------------------------
  // Initial render
  // ---------------------------------------------------------------------
  window.addEventListener("load", () => {
    map.invalidateSize();
    goToPage(0, false);
    // Zero-decision first run: destination is the one field someone's
    // actually likely to want to change (start already defaults sensibly),
    // focused and pre-selected so the very first keystroke replaces the
    // demo placeholder instead of requiring a manual clear first. Placed
    // last in the load handler, not its own earlier rAF — goToPage's
    // scrollTo above was winning that race and blurring it.
    endInput.focus();
    endInput.select();
  });

  // Applies the persisted (or system-default) appearance now that every
  // dependency setTheme()/refreshMapTheme()/setNightMode() can reach —
  // map, tileLayer, prefs, audioManager, the ambient engines — has been
  // declared above. Must stay the last statement in this file; see
  // initTheme()'s own definition for why calling it any earlier throws.
  initTheme();
})();
