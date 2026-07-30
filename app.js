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
  // Map (MapLibre GL + OpenFreeMap vector tiles, built on OpenStreetMap data)
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
    // Flow uses the dark map palette too (see flowtheme.js's usesDarkMapTiles
    // for why: a night-sky base is what the aurora-style overlay is designed
    // to sit on top of).
    return t ? FlowTheme.usesDarkMapTiles(t) : (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  };

  // MapLibre GL + OpenFreeMap vector tiles (free, keyless, no rate cap),
  // replacing the old CARTO raster tiles. The whole point of going vector:
  // the basemap's colors are OURS now. One base style (Positron) is loaded
  // once, then recolorMapForTheme() below repaints its layers from the
  // app's own palette on every theme change — setPaintProperty only, never
  // setStyle(), so route lines, markers, and every custom source survive a
  // Light/Dark/Flow switch untouched instead of being torn down and rebuilt.
  const map = new maplibregl.Map({
    container: "map",
    style: "https://tiles.openfreemap.org/styles/positron",
    center: [CONFIG.DEFAULT_START.lon, CONFIG.DEFAULT_START.lat],
    zoom: 14,
    maxZoom: 19,
    attributionControl: false,
    // Pitch/rotate gestures stay off: this app's map is a flat, calm,
    // north-up surface — same interaction model the Leaflet build had.
    pitchWithRotate: false,
    dragRotate: false,
    touchPitch: false,
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  // QA hook (?debug=1): exposes the map instance + surfaces renderer errors
  // that would otherwise be swallowed. No-op in normal use.
  if (/[?&]debug=1\b/.test(location.search)) {
    window.__map = map;
    map.on("error", (e) => console.warn("map error:", e && e.error && e.error.message));
  }
  // The style itself carries the full OSM/OpenMapTiles/OpenFreeMap credit
  // line — adding a customAttribution on top rendered it twice. compact:true
  // collapses it to the standard (i) toggle, same honest credits, calmer.
  map.addControl(new maplibregl.AttributionControl({ compact: true }));

  // The map palettes are map-specific shades OF the app palette — deliberate
  // hexes rather than raw tokens, because the token set has no concept of
  // "water at 60% visual weight under a route line". Both halves stay in the
  // same families as --bg/--surface/--calm/--sky per theme.
  const MAP_PALETTES = {
    light: {
      land: "#F3F1EA", residential: "#EEEBE2", green: "#DEE9DC", water: "#C4DCD6",
      building: "#E7E3D8", casing: "#E2DDD2", roadMinor: "#FFFFFF", roadMajor: "#FDFCF8",
      motorway: "#F7F4EC", rail: "#DCD7CC", boundary: "#C9C4B9", aeroway: "#EBE8DF",
      label: "#6F7480", labelHalo: "#F3F1EA", waterLabel: "#7C9A93",
    },
    dark: {
      land: "#12141F", residential: "#141726", green: "#16211D", water: "#0B0E16",
      building: "#1A1D2B", casing: "#0D0F18", roadMinor: "#232637", roadMajor: "#2A2E42",
      motorway: "#303550", rail: "#1E2233", boundary: "#333850", aeroway: "#171A28",
      label: "#8B90A5", labelHalo: "#12141F", waterLabel: "#5F7A8C",
    },
  };

  // Repaints every basemap layer from the current theme's palette. Grouped
  // by Positron's stable layer ids (captured from the style JSON) with a
  // type-based fallback so an upstream style tweak degrades to "slightly
  // wrong shade", never a crash — every set is individually best-effort.
  function recolorMapForTheme() {
    const p = MAP_PALETTES[isDark() ? "dark" : "light"];
    const trySet = (layerId, prop, value) => {
      try { map.setPaintProperty(layerId, prop, value); } catch (e) { /* layer/prop absent — fine */ }
    };
    (map.getStyle().layers || []).forEach((layer) => {
      const id = layer.id;
      if (layer.type === "background") { trySet(id, "background-color", p.land); return; }
      if (layer.type === "fill") {
        let c = p.land;
        if (id === "water") c = p.water;
        else if (id === "park" || id.startsWith("landcover_")) c = p.green;
        else if (id.startsWith("landuse_")) c = p.residential;
        else if (id === "building") c = p.building;
        else if (id.startsWith("aeroway") || id.startsWith("road_area")) c = p.aeroway;
        trySet(id, "fill-color", c);
        trySet(id, "fill-outline-color", c);
        return;
      }
      if (layer.type === "line") {
        let c = p.roadMinor;
        if (id === "waterway") c = p.water;
        else if (id.includes("casing")) c = p.casing;
        else if (id.includes("motorway")) c = p.motorway;
        else if (id.includes("major")) c = p.roadMajor;
        else if (id.startsWith("railway")) c = p.rail;
        else if (id.startsWith("boundary")) c = p.boundary;
        else if (id.startsWith("aeroway") || id === "road_pier") c = p.aeroway;
        trySet(id, "line-color", c);
        return;
      }
      if (layer.type === "symbol") {
        const isWater = id.startsWith("water") || id.startsWith("waterway");
        trySet(id, "text-color", isWater ? p.waterLabel : p.label);
        trySet(id, "text-halo-color", p.labelHalo);
      }
    });
  }
  // isStyleLoaded() is NOT a reliable "has the style ever loaded" signal —
  // it flips false transiently during any style mutation, and "style.load"
  // fires exactly once, so code that misses the moment and re-subscribes
  // waits forever. One latched flag + a queue is the dependable version:
  // callbacks run immediately once the style has loaded, in order, exactly
  // once each.
  let mapStyleReady = false;
  const styleReadyQueue = [];
  function whenStyleReady(fn) {
    if (mapStyleReady) fn();
    else styleReadyQueue.push(fn);
  }
  map.once("style.load", () => {
    mapStyleReady = true;
    recolorMapForTheme();
    while (styleReadyQueue.length) styleReadyQueue.shift()();
  });

  // The map's container can be resized by layout changes it can't see
  // (entering/leaving full-screen nav mode, banners toggling above it) — a
  // ResizeObserver telling the renderer about every genuine layout-box
  // change was the hard-won fix for the old raster build's gray-tile bugs
  // (timing-based approaches were repeatedly flaky), and it carries over
  // unchanged: map.resize() is MapLibre's equivalent of invalidateSize(),
  // and a resize() call when nothing meaningfully changed is a cheap no-op.
  new ResizeObserver(() => map.resize()).observe(document.querySelector(".map-wrap"));

  function refreshMapTheme() {
    // No tile-layer swap anymore — repaint the one loaded style in place.
    // Guarded for the startup race where a theme is applied before the
    // style has finished loading (the style.load hook above then does the
    // first recolor anyway).
    whenStyleReady(() => {
    recolorMapForTheme();
    // Flow's route-glow underlayer follows the theme live, so switching
    // into/out of Flow while a route is on screen behaves like the old
    // CSS-class toggle did.
    if (map.getLayer("route-calm-glow")) {
      map.setLayoutProperty("route-calm-glow", "visibility",
        FlowTheme.isFlowActive(root.getAttribute("data-theme")) ? "visible" : "none");
    }
    });
  }

  // Route rendering: two GeoJSON sources + three line layers (a soft glow
  // under the calm line, Flow Mode only), created once the style loads and
  // then only ever fed new data — never torn down, which is what keeps
  // reroutes and theme switches flicker-free by construction.
  let startMarker = null, endMarker = null;
  let routeDrawRAF = null;
  let calmRouteCoords = []; // [lon,lat][] of the current calm route
  const EMPTY_LINE = { type: "Feature", geometry: { type: "LineString", coordinates: [] } };
  function lineFeature(coords) {
    return { type: "Feature", geometry: { type: "LineString", coordinates: coords } };
  }

  function ensureRouteLayers() {
    if (map.getSource("route-calm")) return;
    map.addSource("route-fast", { type: "geojson", data: EMPTY_LINE });
    map.addSource("route-calm", { type: "geojson", data: EMPTY_LINE });
    map.addLayer({
      id: "route-fast-line", type: "line", source: "route-fast",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": getVar("--busy"), "line-width": 3, "line-opacity": 0.55, "line-dasharray": [1.5, 2.2] },
    });
    // Flow Mode's "route slowly shimmers, suggesting calm energy flowing
    // toward the destination": with GL rendering there's no SVG <path> to
    // hang the old CSS animation on, so the shimmer is a wide, blurred
    // under-line instead — toggled via layer visibility so Light/Dark keep
    // the exact same single static line as before.
    map.addLayer({
      id: "route-calm-glow", type: "line", source: "route-calm",
      layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
      paint: { "line-color": getVar("--calm"), "line-width": 12, "line-opacity": 0.3, "line-blur": 8 },
    });
    map.addLayer({
      id: "route-calm-line", type: "line", source: "route-calm",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": getVar("--calm"), "line-width": 5, "line-opacity": 0.95 },
    });
  }

  function clearRouteLayers() {
    if (routeDrawRAF) { cancelAnimationFrame(routeDrawRAF); routeDrawRAF = null; }
    calmRouteCoords = [];
    if (map.getSource("route-calm")) {
      map.getSource("route-calm").setData(EMPTY_LINE);
      map.getSource("route-fast").setData(EMPTY_LINE);
    }
    if (startMarker) { startMarker.remove(); startMarker = null; }
    if (endMarker) { endMarker.remove(); endMarker = null; }
  }

  // "Line drawing on" effect, reimplemented for GL: the calm source's data
  // grows from the route's start to its end over `durationMs`, interpolating
  // within the current segment each frame — reads identically to the old
  // SVG stroke-dashoffset trick. Distance-weighted so the drawing speed is
  // constant along the ground, not per-vertex.
  function animateRouteDrawOn(coords, durationMs) {
    if (routeDrawRAF) cancelAnimationFrame(routeDrawRAF);
    const src = map.getSource("route-calm");
    if (!src || coords.length < 2) { if (src) src.setData(lineFeature(coords)); return; }
    const segLens = [];
    let total = 0;
    for (let i = 1; i < coords.length; i++) {
      const d = NavLogic.haversineM(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
      segLens.push(d); total += d;
    }
    if (total <= 0) { src.setData(lineFeature(coords)); return; }
    const startedAt = performance.now();
    function step(now) {
      const t = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out, matching the old CSS curve
      let remaining = eased * total;
      const drawn = [coords[0]];
      for (let i = 0; i < segLens.length; i++) {
        if (remaining >= segLens[i]) { drawn.push(coords[i + 1]); remaining -= segLens[i]; }
        else {
          const f = segLens[i] > 0 ? remaining / segLens[i] : 1;
          drawn.push([
            coords[i][0] + (coords[i + 1][0] - coords[i][0]) * f,
            coords[i][1] + (coords[i + 1][1] - coords[i][1]) * f,
          ]);
          break;
        }
      }
      src.setData(lineFeature(drawn));
      routeDrawRAF = t < 1 ? requestAnimationFrame(step) : null;
    }
    routeDrawRAF = requestAnimationFrame(step);
  }

  function boundsOfCoords(coords) {
    return coords.reduce(
      (b, c) => b.extend(c),
      new maplibregl.LngLatBounds(coords[0], coords[0])
    );
  }

  // ---- Public transport (Transitous via /api/transit) ----
  // Standard Google encoded-polyline decoder, precision-aware (MOTIS sends
  // precision 6 geometry; the classic algorithm is precision 5).
  function decodePolyline(str, precision) {
    const factor = Math.pow(10, precision == null ? 6 : precision);
    const coords = [];
    let index = 0, lat = 0, lon = 0;
    while (index < str.length) {
      for (const which of ["lat", "lon"]) {
        let result = 0, shift = 0, b;
        do {
          b = str.charCodeAt(index++) - 63;
          result |= (b & 0x1f) << shift;
          shift += 5;
        } while (b >= 0x20);
        const delta = (result & 1) ? ~(result >> 1) : (result >> 1);
        if (which === "lat") lat += delta; else lon += delta;
      }
      coords.push([lon / factor, lat / factor]);
    }
    return coords;
  }

  function ensureTransitLayers() {
    if (map.getSource("transit-ride")) return;
    map.addSource("transit-ride", { type: "geojson", data: EMPTY_LINE });
    map.addSource("transit-walk", { type: "geojson", data: EMPTY_LINE });
    map.addLayer({
      id: "transit-walk-line", type: "line", source: "transit-walk",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": getVar("--muted"), "line-width": 4, "line-opacity": 0.8, "line-dasharray": [0.5, 1.6] },
    });
    map.addLayer({
      id: "transit-ride-line", type: "line", source: "transit-ride",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": getVar("--sky"), "line-width": 5, "line-opacity": 0.95 },
    });
  }

  function clearTransitRoute() {
    if (map.getSource("transit-ride")) {
      map.getSource("transit-ride").setData(EMPTY_LINE);
      map.getSource("transit-walk").setData(EMPTY_LINE);
    }
  }

  // Draws one itinerary: ride legs solid, walking connections dashed —
  // MultiLineStrings so a 3-leg journey stays three separate strokes
  // instead of one line doubling back through stations.
  function drawTransitItinerary(itinerary) {
    ensureTransitLayers();
    clearRouteLayers();
    const ride = [], walk = [], all = [];
    itinerary.legs.forEach((leg) => {
      if (!leg.points) return;
      const coords = decodePolyline(leg.points, leg.precision);
      if (coords.length < 2) return;
      (leg.mode === "WALK" ? walk : ride).push(coords);
      all.push(...coords);
    });
    map.getSource("transit-ride").setData({ type: "Feature", geometry: { type: "MultiLineString", coordinates: ride } });
    map.getSource("transit-walk").setData({ type: "Feature", geometry: { type: "MultiLineString", coordinates: walk } });
    if (all.length >= 2) {
      startMarker = new maplibregl.Marker({ element: makePinElement(getVar("--calm")), anchor: "bottom" })
        .setLngLat(all[0]).addTo(map);
      endMarker = new maplibregl.Marker({ element: makePinElement(getVar("--accent")), anchor: "bottom" })
        .setLngLat(all[all.length - 1]).addTo(map);
      map.resize();
      map.fitBounds(boundsOfCoords(all), { padding: 32, animate: false });
    }
  }

  function drawRoute(result, start, end, options) {
    const isReroute = !!(options && options.isReroute);
    const render = () => {
      ensureRouteLayers();
      clearRouteLayers();
      clearTransitRoute();
      calmRouteCoords = result.calm.coordinates.slice();
      map.getSource("route-fast").setData(lineFeature(result.fastest.coordinates));
      animateRouteDrawOn(calmRouteCoords, isReroute ? 700 : 1000);
      map.setLayoutProperty("route-calm-glow", "visibility",
        FlowTheme.isFlowActive(root.getAttribute("data-theme")) ? "visible" : "none");

      startMarker = new maplibregl.Marker({ element: makePinElement(getVar("--calm")), anchor: "bottom" })
        .setLngLat([start.lon, start.lat]).addTo(map);
      endMarker = new maplibregl.Marker({ element: makePinElement(getVar("--accent")), anchor: "bottom" })
        .setLngLat([end.lon, end.lat]).addTo(map);

      // The container's size can have changed since the renderer last
      // measured it (banners toggling above the map) — resize() before
      // fitBounds so the fit is computed against the real box.
      map.resize();
      map.fitBounds(boundsOfCoords(calmRouteCoords), { padding: 32, animate: false });
    };
    // First search can land before the style finishes loading (fast typer,
    // slow network) — defer once rather than crash on addSource.
    whenStyleReady(render);
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

  // Marker elements: MapLibre positions the OUTER element it's given via
  // its own inline transform, so every animated/styled class lives on an
  // inner child instead — the old Leaflet divIcon put classes on the
  // positioned element itself, where a CSS transform animation and the
  // positioning transform would now fight. Same DOM/CSS beyond that.
  function makeUserDotElement() {
    const wrap = document.createElement("div");
    wrap.style.pointerEvents = "none"; // taps pass through to the map
    wrap.style.width = "16px"; wrap.style.height = "16px"; // anchor math needs a real box
    wrap.innerHTML = `<div class="user-dot"><div class="user-dot-inner"></div></div>`;
    return wrap;
  }

  // Pikmin-Bloom-style pillowy teardrop pin (rounded, gently swaying) — the
  // app's own CSS animation on the inner .map-pin, not a static marker image.
  function makePinElement(color) {
    const wrap = document.createElement("div");
    wrap.style.pointerEvents = "none";
    wrap.style.width = "26px"; wrap.style.height = "26px";
    wrap.innerHTML = `<div class="map-pin"><svg viewBox="0 0 26 26"><path d="M13 2c-5.5 0-9 4-9 8.5C4 17 13 24 13 24s9-7 9-13.5C22 6 18.5 2 13 2z" fill="${color}"/><circle cx="13" cy="10.5" r="4" fill="rgba(255,255,255,0.85)"/></svg></div>`;
    return wrap;
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
      // Only re-search when the form is already expanded (i.e. a destination
      // exists) — changing the start before any destination has been chosen
      // has nothing to route to yet.
      if (!routeSearchCard.classList.contains("collapsed")) runSearch();
    },
    onUseCurrentLocation: useCurrentLocationForStart,
  });
  // Search-bar-first flow: the card starts as a single "Where to?" bar
  // (see index.html/.route-search-card.collapsed). Choosing a destination
  // expands the full form AND immediately searches — picking a place IS
  // the intent, no separate Find tap required. Adjusting the start after
  // that re-searches live for the same reason. runSearch's isSearching
  // guard absorbs any double-trigger (Enter + selection racing).
  const routeSearchCard = document.getElementById("routeSearchCard");
  function expandSearchCard() {
    routeSearchCard.classList.remove("collapsed");
  }
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
      expandSearchCard();
      runSearch();
    },
  });
  endInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && endInput.value.trim()) {
      expandSearchCard();
      runSearch();
    }
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
      // Re-search on mode change whenever a destination has been chosen
      // (the card is expanded) — the old `if (lastResult)` gate never
      // passed for transit-first sessions, where no calm/fast result
      // exists yet.
      if (!routeSearchCard.classList.contains("collapsed")) runSearch();
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

  // ---- Transit options: fetch, render as cards, draw selection ----
  const transitResultsEl = document.getElementById("transitResults");
  const transitNoteEl = document.getElementById("transitNote");
  let transitItineraries = [];

  const TRANSIT_MODE_ICONS = {
    WALK: "🚶", TRAM: "🚊", BUS: "🚌", RAIL: "🚆", SUBWAY: "🚇",
    METRO: "🚇", FERRY: "⛴", COACH: "🚌", HIGHSPEED_RAIL: "🚆",
    REGIONAL_RAIL: "🚆", REGIONAL_FAST_RAIL: "🚆", LONG_DISTANCE: "🚆", NIGHT_RAIL: "🚆",
  };
  function transitTimeHHMM(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return isNaN(d) ? "—" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function setTransitModeUI(on) {
    routeResultsCard.classList.toggle("transit-mode", on);
    transitNoteEl.style.display = on ? "block" : "none";
    if (!on) { transitResultsEl.innerHTML = ""; clearTransitRoute(); }
  }

  function selectTransitOption(idx) {
    transitResultsEl.querySelectorAll(".transit-option").forEach((el, i) => {
      el.classList.toggle("selected", i === idx);
    });
    if (transitItineraries[idx]) drawTransitItinerary(transitItineraries[idx]);
  }

  function renderTransitOptions(itineraries) {
    transitResultsEl.innerHTML = "";
    itineraries.forEach((it, idx) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "route-card transit-option" + (idx === 0 ? " selected" : "");
      card.setAttribute("role", "listitem");
      const mins = it.durationS != null ? Math.round(it.durationS / 60) : null;
      const legsHtml = it.legs.map((leg) => {
        const icon = TRANSIT_MODE_ICONS[leg.mode] || "🚌";
        return `<span class="transit-leg">${icon}${leg.route ? ` <b>${leg.route}</b>` : ""}</span>`;
      }).join('<span class="transit-leg-sep" aria-hidden="true">›</span>');
      card.innerHTML = `
        <div class="rc-label">${transitTimeHHMM(it.startTime)} → ${transitTimeHHMM(it.endTime)}</div>
        <div class="rc-time">${mins != null ? mins + " min" : "—"}</div>
        <div class="rc-sub">${it.transfers} transfer${it.transfers === 1 ? "" : "s"}</div>
        <div class="transit-legs">${legsHtml}</div>`;
      card.addEventListener("click", () => selectTransitOption(idx));
      transitResultsEl.appendChild(card);
    });
  }

  async function fetchTransitPlan(start, end) {
    const resp = await fetch(`${apiBaseUrl}/api/transit?from=${start.lat},${start.lon}&to=${end.lat},${end.lon}`);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || "Journey planner unavailable.");
    }
    const data = await resp.json();
    return data.itineraries || [];
  }

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
    // The whole body runs inside try/finally: these three flags MUST reset
    // no matter what throws mid-search (a renderer edge case, a rejected
    // fetch) — reported from real device testing as "stopped a route, then
    // couldn't search again": one uncaught throw left isSearching stuck
    // true and the guard above silently swallowed every later tap.
    try {

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

    if (travelMode === "transit") {
      // Public-transport plan instead of the calm/fastest pair. Everything
      // above (input resolution, error surfacing) is shared; everything
      // below (calm scoring, Start button, turn-by-turn) is walk/bike-only.
      findBtnLabel.textContent = "Finding transit options…";
      transitItineraries = await fetchTransitPlan(resolvedStart, resolvedEnd);
      setTransitModeUI(true);
      routeResultsCard.classList.add("visible");
      startNavBtn.style.display = "none";
      if (!transitItineraries.length) {
        transitResultsEl.innerHTML = '<div class="mode-note">No public-transport options found for this trip right now.</div>';
        clearTransitRoute();
      } else {
        renderTransitOptions(transitItineraries);
        whenStyleReady(() => selectTransitOption(0));
      }
      modeNote.textContent = "";
      safetyNote.style.display = "none";
      return;
    }
    setTransitModeUI(false);

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
    // Every fresh search resets to the zero-decision default: calm route
    // selected, alternatives disclosure collapsed — a leftover open state
    // (or a leftover "fastest" selection) from a previous search shouldn't
    // silently carry into a new route.
    document.getElementById("routeAlternatives").open = false;
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

    } catch (err) {
      console.warn("Route search failed:", err && err.message);
      showError("Something went wrong finding that route — please try again.");
    } finally {
      isSearching = false;
      findBtn.disabled = false;
      findBtn.classList.remove("loading");
      findBtnLabel.textContent = "Find calm route";
    }
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

  // Tap-to-navigate: tapping anywhere on the map sets that point as the
  // destination and searches immediately — no typing required. Only on the
  // planning screen: during active navigation a map tap already means
  // "reveal the auto-hidden controls" (see the smart-controls pointerdown
  // handler below), and the two meanings must not overlap. A tap on an
  // Echo/POI marker is swallowed by the marker element's own handler, so
  // there's no marker conflict. The route search starts against the raw
  // coordinates right away; the human-readable label arrives from a
  // parallel best-effort reverse geocode and only ever replaces the interim
  // coordinate label — never the selection itself — and is skipped if the
  // user has meanwhile picked a different destination.
  //
  // Unlike Leaflet, MapLibre does NOT cancel the pending single-click when
  // a double-click zoom lands — without the 300ms hold below, every
  // double-tap zoom would also pin a destination and fire a route search.
  let pendingMapTap = null;
  map.on("dblclick", () => { clearTimeout(pendingMapTap); pendingMapTap = null; });
  map.on("click", (e) => {
    clearTimeout(pendingMapTap);
    pendingMapTap = setTimeout(() => handleMapTap(e), 300);
  });
  async function handleMapTap(e) {
    if (pageInner0.classList.contains("nav-active")) return;
    if (isSearching) return;
    expandSearchCard(); // a tapped destination expands the form like a typed one
    const point = { lat: e.lngLat.lat, lon: e.lngLat.lng };
    const interimLabel = `Pinned spot (${point.lat.toFixed(4)}, ${point.lon.toFixed(4)})`;
    const selection = { label: interimLabel, lat: point.lat, lon: point.lon };
    endSelectedResult = selection;
    resolvedEnd = { label: interimLabel, lat: point.lat, lon: point.lon };
    endInput.value = interimLabel;
    endAutocomplete.close();
    runSearch();
    try {
      const { hits } = await reverseGeocode({ point, endpointBase: apiBaseUrl });
      const normalized = hits.map(normalizeHit).filter(Boolean);
      if (normalized[0] && endSelectedResult === selection) {
        const label = normalized[0].secondary
          ? `${normalized[0].primary}, ${normalized[0].secondary}`
          : normalized[0].primary;
        selection.label = label;
        resolvedEnd.label = label;
        endInput.value = label;
      }
    } catch (err) {
      // Best-effort only — the coordinate label above already works.
    }
  }

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
    if (userDotMarker) userDotMarker.setLngLat([point.lon, point.lat]);
    if (accuracyCircleState) setAccuracyCircle(point.lat, point.lon, accuracyCircleState.radiusM);
    markerTweenRAF = t < 1 ? requestAnimationFrame(stepMarkerTween) : null;
  }

  // GPS-accuracy confidence ring as a GeoJSON polygon (GL has no circle
  // primitive with a meters radius — a 48-segment polygon at these sizes is
  // visually indistinguishable from a true circle).
  let accuracyCircleState = null; // { lat, lon, radiusM }
  function circleFeature(lat, lon, radiusM) {
    const pts = [];
    const latR = radiusM / 111320;
    const lonR = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push([lon + Math.cos(a) * lonR, lat + Math.sin(a) * latR]);
    }
    return { type: "Feature", geometry: { type: "Polygon", coordinates: [pts] } };
  }
  function ensureAccuracyLayer() {
    if (map.getSource("user-accuracy")) return;
    map.addSource("user-accuracy", { type: "geojson", data: EMPTY_LINE });
    map.addLayer({
      id: "user-accuracy-fill", type: "fill", source: "user-accuracy",
      paint: { "fill-color": getVar("--sky"), "fill-opacity": 0.12 },
    });
  }
  function setAccuracyCircle(lat, lon, radiusM) {
    accuracyCircleState = { lat, lon, radiusM };
    if (!mapStyleReady) return; // first fix can beat the style — drawn on next update
    ensureAccuracyLayer();
    map.getSource("user-accuracy").setData(circleFeature(lat, lon, radiusM));
  }

  // The user-location marker "should feel alive": smoothly interpolated
  // between fixes (no teleporting), heading-smoothed (no jitter from noisy
  // compass/GPS-derived bearings), and its confidence ring reacts to
  // reported GPS accuracy rather than a fixed radius.
  function updateUserMarker(lat, lon, accuracy, headingDeg) {
    if (!userDotMarker) {
      userDotMarker = new maplibregl.Marker({ element: makeUserDotElement(), anchor: "center" })
        .setLngLat([lon, lat]).addTo(map);
      userDotMarker.getElement().style.zIndex = "1000";
      setAccuracyCircle(lat, lon, accuracy || 15);
      smoothedHeadingDeg = headingDeg != null ? headingDeg : null;
    } else {
      cancelMarkerTween();
      const current = userDotMarker.getLngLat();
      markerTweenFrom = { lat: current.lat, lon: current.lng };
      markerTweenTo = { lat, lon };
      markerTweenStartMs = performance.now();
      markerTweenRAF = requestAnimationFrame(stepMarkerTween);
      smoothedHeadingDeg = NavLogic.smoothHeading(smoothedHeadingDeg, headingDeg, 0.35);
      setAccuracyCircle(lat, lon, accuracy || 15);
    }
    const el = userDotMarker.getElement().querySelector(".user-dot");
    const effectiveHeading = smoothedHeadingDeg != null ? smoothedHeadingDeg : headingDeg;
    if (el) {
      const inner = el.querySelector(".user-dot-inner");
      el.classList.toggle("has-heading", effectiveHeading != null);
      if (inner && effectiveHeading != null) inner.style.transform = `rotate(${effectiveHeading}deg)`;
    }
    // "When GPS accuracy decreases, show confidence naturally" — a larger,
    // more visible ring for a genuinely uncertain fix; a subtle, barely-
    // there one once accuracy is good.
    if (map.getLayer("user-accuracy-fill")) {
      const acc = accuracy || 15;
      const fillOpacity = acc > 30 ? 0.22 : acc > 15 ? 0.16 : 0.08;
      map.setPaintProperty("user-accuracy-fill", "fill-opacity", fillOpacity);
    }
    return effectiveHeading;
  }

  function removeUserMarker() {
    cancelMarkerTween();
    smoothedHeadingDeg = null;
    accuracyCircleState = null;
    if (userDotMarker) { userDotMarker.remove(); userDotMarker = null; }
    if (map.getSource("user-accuracy")) map.getSource("user-accuracy").setData(EMPTY_LINE);
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
    // easeTo takes ms (Leaflet's setView took seconds) — same felt speeds.
    map.easeTo({ center: [target.lon, target.lat], zoom: map.getZoom() < 16 ? 17 : map.getZoom(), duration: duration * 1000 });
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
  // easeTo() calls (our own recentering) don't fire 'dragstart'.
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
        if (lastFixLatLng) map.easeTo({ center: [lastFixLatLng[1], lastFixLatLng[0]], zoom: 17 });
      }
    }, AUTO_RETURN_TO_FOLLOW_MS);
  }
  recenterBtn.addEventListener("click", () => {
    clearTimeout(autoReturnToFollowTimer);
    setFollowMode(true);
    if (lastFixLatLng) map.easeTo({ center: [lastFixLatLng[1], lastFixLatLng[0]], zoom: 17 });
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
  let echoMarkers = []; // maplibregl.Marker[]
  let nearbyEchoes = [];
  let lastNearbyFetch = { at: 0, lat: null, lon: null };
  const shownNearbyToastIds = new Set();

  function renderEchoMarkers() {
    echoMarkers.forEach((m) => m.remove());
    echoMarkers = [];
    EchoMarkerClustering.clusterEchoes(nearbyEchoes, 40).forEach((cluster) => {
      const isCluster = cluster.count > 1;
      const el = document.createElement("div");
      el.className = "echo-marker-pin" + (isCluster ? " echo-cluster" : "");
      el.innerHTML = `<div class="echo-marker-glow" aria-hidden="true"></div><div class="echo-marker-icon">${isCluster ? cluster.count : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="14" width="16" height="7" rx="2"/><path d="M7 14V10M10.5 14V6.5M13.5 14V6.5M17 14V10M12 14V3.5"/></svg>'}</div>`;
      // stopPropagation is what keeps a marker tap from ALSO reaching the
      // map's own click handler (tap-to-navigate) — MapLibre marker
      // elements live inside the canvas container, so without this every
      // Echo tap would simultaneously pin a new destination underneath.
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (FlowTheme.isFlowActive(root.getAttribute("data-theme"))) {
          spawnFlowTapRipple(e.clientX, e.clientY);
        }
        if (isCluster) { map.easeTo({ center: [cluster.lon, cluster.lat], zoom: Math.min(19, map.getZoom() + 2) }); return; }
        openEchoDetail(cluster.echoes[0]);
      });
      echoMarkers.push(
        new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([cluster.lon, cluster.lat]).addTo(map)
      );
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

  // Echo markers were previously fetched ONLY off GPS fixes (onEchoFix
  // above) — with location denied, slow, or simply not yet granted, the map
  // showed zero Echoes no matter where you panned, which read as "Echoes
  // missing from the map" (reported as mode-dependent, but there is one
  // shared map/marker layer for walk and bike — the real variable was
  // whether a GPS fix had arrived yet). Now the visible map area itself is
  // also a fetch trigger: pan/zoom refreshes markers around the map center,
  // reusing the same throttle state (>50m moved or >20s stale) as the GPS
  // path so the two triggers can't stack into request spam. Debounced so a
  // continuous pan gesture fetches once at rest, not per frame.
  let echoMoveDebounce = null;
  map.on("moveend", () => {
    clearTimeout(echoMoveDebounce);
    echoMoveDebounce = setTimeout(() => {
      const c = map.getCenter();
      const now = Date.now();
      const moved = lastNearbyFetch.lat == null || NavLogic.haversineM(lastNearbyFetch.lat, lastNearbyFetch.lon, c.lat, c.lng) > 50;
      if (moved || now - lastNearbyFetch.at > 20000) {
        lastNearbyFetch = { at: now, lat: c.lat, lon: c.lng };
        fetchNearbyEchoes(c.lat, c.lng);
      }
    }, 400);
  });

  // ---- Points of interest: shops & restaurants (OSM via /api/pois) ----
  // External community data (Overpass), fetched sparingly by design:
  //   - only at neighborhood zoom (>= POI_MIN_ZOOM — at city zoom the
  //     markers would be unreadable clutter AND the bbox would blow the
  //     server-side area cap anyway),
  //   - debounced to the end of a pan/zoom gesture,
  //   - bbox snapped OUTWARD to a coarse grid, so wandering around one
  //     neighborhood keeps hitting the same cache key instead of minting a
  //     fresh request per pixel of pan,
  //   - answers cached for 10 minutes client-side (matching the server's
  //     own cache-control) with a hard floor between upstream calls,
  //   - paused entirely during navigation — route guidance is not the
  //     moment to decorate the map.
  let poiMarkers = []; // maplibregl.Marker[]
  function clearPoiMarkers() { poiMarkers.forEach((m) => m.remove()); poiMarkers = []; }
  const POI_MIN_ZOOM = 14;
  const POI_CACHE_MS = 10 * 60 * 1000;
  const POI_MIN_FETCH_GAP_MS = 2500;
  const poiCache = new Map(); // gridKey -> { at, pois }
  let poiDebounce = null;
  let lastPoiFetchAt = 0;

  function poiGridBbox() {
    // The query area is the viewport CLAMPED to ±0.0125° around the map
    // center — a wide desktop/tablet window at street zoom must not turn
    // into a multi-km Overpass query just because the screen is big. POIs
    // beyond the clamp simply arrive when the user pans there (each pan is
    // its own fetch trigger anyway). Snapped outward to a coarse grid so
    // small pans reuse the same cache key.
    const b = map.getBounds();
    const c = map.getCenter();
    const HALF = 0.0125;
    const G = 0.005; // ~500m of latitude per grid step
    const snap = (v, up) => (up ? Math.ceil(v / G) : Math.floor(v / G)) * G;
    return {
      minLat: snap(Math.max(b.getSouth(), c.lat - HALF), false),
      minLon: snap(Math.max(b.getWest(), c.lng - HALF), false),
      maxLat: snap(Math.min(b.getNorth(), c.lat + HALF), true),
      maxLon: snap(Math.min(b.getEast(), c.lng + HALF), true),
    };
  }

  function renderPois(pois) {
    clearPoiMarkers();
    pois.forEach((p) => {
      const el = document.createElement("div");
      el.className = "poi-pin";
      el.innerHTML = `<span class="poi-dot ${p.kind === "shop" ? "poi-shop" : p.kind === "transit" ? "poi-transit" : "poi-food"}" aria-hidden="true"></span>`;
      const popup = new maplibregl.Popup({ closeButton: false, offset: 10 }).setText(p.name);
      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([p.lon, p.lat]).setPopup(popup).addTo(map);
      // Same stopPropagation rationale as the Echo markers: a POI tap opens
      // its name popup, it must not also pin a new destination underneath.
      el.addEventListener("click", (e) => e.stopPropagation());
      poiMarkers.push(marker);
    });
  }

  async function refreshPois() {
    if (pageInner0.classList.contains("nav-active")) return;
    if (map.getZoom() < POI_MIN_ZOOM) { clearPoiMarkers(); return; }
    const bbox = poiGridBbox();
    const key = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
    const cached = poiCache.get(key);
    if (cached && Date.now() - cached.at < POI_CACHE_MS) { renderPois(cached.pois); return; }
    if (Date.now() - lastPoiFetchAt < POI_MIN_FETCH_GAP_MS) return; // grid cache misses can't stampede Overpass
    lastPoiFetchAt = Date.now();
    try {
      const resp = await fetch(`${apiBaseUrl}/api/pois?bbox=${key}`);
      if (!resp.ok) return;
      const data = await resp.json();
      const pois = data.pois || [];
      poiCache.set(key, { at: Date.now(), pois });
      renderPois(pois);
    } catch (e) {
      // Best-effort decoration — the map is complete without POI markers.
    }
  }

  map.on("moveend", () => {
    clearTimeout(poiDebounce);
    poiDebounce = setTimeout(refreshPois, 600);
  });

  // ---- Kalimba (page 3): play always, record + leave an Echo once unlocked ----
  const kalimbaTineButtons = Array.from(document.querySelectorAll("#kalimbaTineButtons .kalimba-tine-btn"));
  const echoRecordStatus = document.getElementById("echoRecordStatus");
  const echoRecordBtn = document.getElementById("echoRecordBtn");
  const echoStopBtn = document.getElementById("echoStopBtn");
  const echoRedoBtn = document.getElementById("echoRedoBtn");
  const echoPlayBackBtn = document.getElementById("echoPlayBackBtn");
  const echoLayerBtn = document.getElementById("echoLayerBtn");
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
    echoLayerBtn.style.display = "none";
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

  // The fix an Echo is actually SAVED at. Captured fresh, once, the moment
  // recording starts — NOT read from explorationState.lastFix at save time.
  // lastFix comes from the exploration watchPosition stream, which pauses
  // whenever the tab is backgrounded (iOS Safari suspends it aggressively):
  // unlock recording near home, pocket the phone, walk to work, record
  // there — lastFix could still be holding the near-home coordinate, and
  // the Echo pinned itself to where recording was *unlocked*, not where the
  // melody was actually played. A one-shot getCurrentPosition at record
  // start is what "where it was recorded" actually means.
  let recordingFix = null;
  echoRecordBtn.addEventListener("click", () => {
    echoRecorder.startRecording();
    echoRecordStatus.textContent = "Recording — play the kalimba. Stop when you're done (up to 20 seconds).";
    echoRecordBtn.style.display = "none";
    echoStopBtn.style.display = "flex";
    recordingFix = null;
    NavBridge.location.getCurrentPosition()
      .then((fix) => { recordingFix = { lat: fix.lat, lon: fix.lon }; })
      .catch(() => { /* falls back to explorationState.lastFix at save time */ });
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
      echoRecordStatus.textContent = echoRecorder.state.layers >= 2
        ? "Two layers down. Listen back, add a message if you like, then leave it here."
        : "Nice. Listen back, add a second layer, or leave it here.";
      echoRedoBtn.style.display = "flex";
      echoPlayBackBtn.style.display = "flex";
      // Two layers max — the button only offers an overlay on a single-layer take.
      echoLayerBtn.style.display = echoRecorder.state.layers < 2 ? "flex" : "none";
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

  // Overlay a second melody on the first: layer 1 plays as an audible guide
  // while layer 2 records on the same t=0 timeline (see echorecorder.js's
  // startOverdub). Reuses the exact Record-in-progress UI — Stop works the
  // same way, the auto-stop cap still applies, and the save-time location
  // fix stays whatever Record originally captured (the Echo belongs to
  // where the take was started, an overlay seconds later doesn't move it).
  echoLayerBtn.addEventListener("click", () => {
    if (echoRecorder.state.phase !== "recorded" || echoRecorder.state.layers >= 2) return;
    echoRecorder.startOverdub();
    echoRecordStatus.textContent = "Layer 2 — play along with your first melody. Stop when you're done.";
    echoRedoBtn.style.display = "none";
    echoPlayBackBtn.style.display = "none";
    echoLayerBtn.style.display = "none";
    echoMessageField.style.display = "none";
    echoSaveBtn.disabled = true;
    echoStopBtn.style.display = "flex";
    clearAutoStopTimer();
    autoStopTimer = setTimeout(() => {
      if (echoRecorder.state.phase === "recording") echoStopBtn.click();
    }, EchoValidation.MAX_DURATION_MS + 50);
  });

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
    // Prefer the fresh fix captured when Record was pressed (see
    // recordingFix above); the exploration stream's lastFix is only the
    // fallback for the rare case where that one-shot lookup failed.
    const fix = recordingFix || explorationState.lastFix;
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
    if (i === 0) requestAnimationFrame(() => map.resize());
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
    map.resize();
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
