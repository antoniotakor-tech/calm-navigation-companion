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
    const labels = { light: "Switch to dark theme", dark: "Switch to Flow theme", flow: "Switch to Bloom theme", bloom: "Switch to light theme" };
    themeToggleBtn.setAttribute("aria-label", labels[theme] || "Toggle theme");
    refreshMapTheme();
    setNightMode(FlowTheme.usesDarkMapTiles(theme));
    // Defined later in this file (hoisted); flowers follow the theme.
    if (typeof refreshBloomFlowers === "function") refreshBloomFlowers();
  }

  const themeToggleBtn = document.getElementById("themeToggle");
  const appearanceChips = Array.from(document.querySelectorAll("#appearanceChips .pill"));

  // Appearance mode (2026-10-12): "auto" follows the sun where you are (Light
  // by day, Dark at night — weatherdoodles.js knows sunrise/sunset); choosing
  // Light or Dark yourself switches to "manual" and sticks.
  const THEME_MODE_KEY = "calmTheme.mode.v1";
  function themeMode() { try { return localStorage.getItem(THEME_MODE_KEY) || "auto"; } catch (e) { return "auto"; } }
  function setThemeMode(m) { try { localStorage.setItem(THEME_MODE_KEY, m); } catch (e) { /* storage off */ } }
  function renderModeChips() {
    if (themeMode() !== "auto") return;
    appearanceChips.forEach((chip) => {
      const on = chip.dataset.appearance === "auto";
      chip.classList.toggle("active", on);
      chip.setAttribute("aria-pressed", String(on));
    });
  }
  let autoNight = null;
  function applyAutoTheme(isNight) {
    if (typeof isNight === "boolean") autoNight = isNight;
    if (themeMode() !== "auto") return;
    const h = new Date().getHours();
    const night = autoNight != null ? autoNight : (h < 7 || h >= 20);
    const want = night ? "dark" : "light";
    if (root.getAttribute("data-theme") !== want) setTheme(want);
    renderModeChips();
  }
  window.CalmTheme = { applyAuto: applyAutoTheme, mode: themeMode };
  setInterval(() => applyAutoTheme(), 5 * 60 * 1000);

  themeToggleBtn.addEventListener("click", () => {
    const cur = root.getAttribute("data-theme") || FlowTheme.DEFAULT_THEME;
    setThemeMode("manual");
    setTheme(FlowTheme.nextTheme(cur));
  });
  appearanceChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      if (chip.dataset.appearance === "auto") { setThemeMode("auto"); applyAutoTheme(); return; }
      setThemeMode("manual");
      setTheme(chip.dataset.appearance);
    });
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
    renderPinnedPlacesList();
    settingsReturnFocusEl = document.activeElement;
    settingsOverlay.classList.add("open");
    const focusables = getFocusableInSettings();
    if (focusables.length) focusables[0].focus();
  }
  function closeSettingsSheet() {
    if (!settingsOverlay.classList.contains("open")) return;
    settingsOverlay.classList.remove("open");
    // Don't hand focus back to a text box: on iPhone that opens the keyboard
    // and zooms the page just from closing Settings.
    if (settingsReturnFocusEl && typeof settingsReturnFocusEl.focus === "function" && !settingsReturnFocusEl.matches("input, textarea")) settingsReturnFocusEl.focus();
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
    // 2026-10-12: only Light and Dark remain, both in the hand-drawn look.
    // Light (paper) is the default; old Flow/Bloom/Doodle choices become Light.
    let raw = null;
    try { raw = localStorage.getItem("calmcompanion.theme.v1"); } catch (e) { /* storage off */ }
    if (themeMode() === "auto") { applyAutoTheme(); return; }
    if (raw !== "dark") { setTheme("light"); return; }
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
    ensureCalmSpotsLayer();
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
    // Custom layers capture their colors from CSS tokens at creation time —
    // a theme switch after that would leave route lines/POI dots painted in
    // the previous theme's palette unless they're repainted here too. Every
    // set is guarded: layers that don't exist yet simply get the right
    // colors when they're created.
    const trySet = (id, prop, value) => { try { map.setPaintProperty(id, prop, value); } catch (e) {} };
    trySet("route-calm-line", "line-color", getVar("--calm"));
    trySet("route-calm-glow", "line-color", getVar("--calm"));
    trySet("route-fast-line", "line-color", getVar("--busy"));
    trySet("transit-ride-line", "line-color", getVar("--sky"));
    trySet("transit-walk-line", "line-color", getVar("--muted"));
    trySet("user-accuracy-fill", "fill-color", getVar("--sky"));
    trySet("poi-circles", "circle-color", ["match", ["get", "kind"], "shop", getVar("--sky"), "transit", getVar("--calm"), getVar("--accent")]);
    trySet("poi-circles", "circle-stroke-color", getVar("--surface"));
    trySet("calmspot-circles", "circle-color", getVar("--calm-spot"));
    trySet("calmspot-circles", "circle-stroke-color", getVar("--surface"));
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
      fitToVisibleMap(all);
    }
  }

  // Frame a route inside the part of the map you can actually SEE — between
  // the search card on top and the results card at the bottom — the way
  // Google/Apple Maps fit a route above their bottom sheet. A flat 32px
  // padding used to put most of the route underneath the two cards.
  // Measured live (both cards change height), deferred one frame so the
  // results card that runSearch() shows right after this has laid out.
  // Falls back to the flat padding if the cards would leave too little map.
  function fitToVisibleMap(coords) {
    requestAnimationFrame(() => {
      const mapRect = map.getContainer().getBoundingClientRect();
      const pad = { top: 32, bottom: 32, left: 32, right: 32 };
      const search = document.getElementById("routeSearchCard");
      if (search && search.offsetParent) {
        pad.top = Math.max(pad.top, search.getBoundingClientRect().bottom - mapRect.top + 24);
      }
      if (routeResultsCard.classList.contains("visible")) {
        pad.bottom = Math.max(pad.bottom, mapRect.bottom - routeResultsCard.getBoundingClientRect().top + 24);
      }
      if (pad.top + pad.bottom > mapRect.height - 80) { pad.top = 32; pad.bottom = 32; }
      map.fitBounds(boundsOfCoords(coords), { padding: pad, animate: false, maxZoom: 17 });
    });
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
      if (!isReroute) fitToVisibleMap(calmRouteCoords);
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
  // Recent routes + pinned places (2026-08-03) — localStorage only, see
  // placesstore.js's header for the privacy-stance context.
  const placesStore = new PlacesStore();

  // Reduced motion starts on if EITHER the OS currently prefers it OR the
  // user previously turned it on in this app (persisted — see prefs.js).
  // This is what makes the setting actually survive a refresh: previously it
  // only ever reflected the OS preference and was never saved at all.
  const prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // 2026-10-12: the in-app switch was removed (animations are part of the
  // app's identity); only the phone's own Reduce Motion setting still applies.
  if (prefs.get().audio.reducedMotion) prefs.set({ audio: { reducedMotion: false } });
  if (prefersReducedMotion) {
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
  // Destination opens empty (2026-10-09): pre-filling a demo destination
  // ("Vondelpark") read as "the app thinks I'm going there" and had to be
  // cleared before every real trip. resolvedEnd keeps the config default
  // only as an internal placeholder; runSearch refuses an empty field, so
  // it can never be routed to without being chosen.
  endInput.value = "";
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
    // No GPS fix (desktop, location not granted yet)? Bias toward wherever
    // the map is showing instead of nowhere (2026-10-10): otherwise a street
    // typed in Amsterdam ranked an identically named street in another town
    // just as high. The map opens on the user's city and follows them, so
    // its centre is the best available stand-in.
    let point = userPoint;
    if (!point && typeof map !== "undefined" && map.getCenter) {
      const c = map.getCenter();
      point = { lat: c.lat, lon: c.lng };
    }
    return {
      point,
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

  // Nearby cafés, shops and stops for the search box (2026-10-10), nearest
  // first — "Albert Heijn" should offer the one round the corner before any
  // geocoder result in another town, and a category word ("cafe",
  // "supermarket", "station") should list the closest ones.
  // Uses the map's places data for ~1.3 km around you (or the map centre),
  // loading that area on demand if the map hasn't shown it yet — the
  // server keeps a per-area copy, so this is normally a fast cache hit.
  const PLACE_CATEGORY_WORDS = {
    food: ["cafe", "coffee", "koffie", "restaurant", "food", "eten", "bar", "lunch", "breakfast", "ontbijt", "pub", "eetcafe"],
    shop: ["shop", "store", "winkel", "supermarket", "supermarkt", "groceries", "boodschappen"],
    transit: ["stop", "halte", "station", "tram", "bus", "metro", "ferry", "pont"],
  };
  const foldText = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  // Places straight from the map's own vector tiles (OpenMapTiles "poi"
  // layer, 2026-10-12). Works in every city in Europe, instantly and even
  // when the Overpass-backed /api/pois is down — which is why restaurant
  // dots used to appear almost only around Amsterdam (where the server had
  // cached answers). Same shape as /api/pois results.
  const TILE_FOOD = new Set(["cafe", "restaurant", "fast_food", "bar", "pub", "beer", "biergarten", "ice_cream", "bakery", "food_court", "tea", "coffee"]);
  const TILE_CALM = new Set(["library", "books", "garden", "park", "place_of_worship", "tea", "museum"]);
  const TILE_TRANSIT = new Set(["bus", "railway", "tram", "subway", "ferry_terminal", "station", "bus_stop", "tram_stop", "halt"]);
  function tileSourceId() {
    const s = map.getStyle && map.getStyle();
    const e = s && Object.entries(s.sources || {}).find(([, v]) => v.type === "vector");
    return e ? e[0] : null;
  }
  // The map style doesn't draw the tiles' "poi" layer, and MapLibre throws
  // away tile layers no style layer uses — so an invisible layer keeps the
  // places loaded. Without this, querySourceFeatures returns nothing.
  function ensureTilePoiProbe(src) {
    if (map.getLayer("tile-poi-probe")) return;
    try {
      map.addLayer({ id: "tile-poi-probe", type: "circle", source: src, "source-layer": "poi", minzoom: 13,
        paint: { "circle-opacity": 0, "circle-stroke-opacity": 0, "circle-radius": 1 } });
    } catch (e) { /* style not ready yet; next call retries */ }
  }
  whenStyleReady(() => { const s = tileSourceId(); if (s) ensureTilePoiProbe(s); });
  function tilePois(bbox) {
    const src = tileSourceId();
    if (!src) return [];
    ensureTilePoiProbe(src);
    let feats = [];
    try { feats = map.querySourceFeatures(src, { sourceLayer: "poi" }); } catch (e) { return []; }
    const seen = new Set(), out = [];
    feats.forEach((f) => {
      if (!f.geometry || f.geometry.type !== "Point") return;
      const p = f.properties || {};
      const name = p["name:latin"] || p.name;
      if (!name) return;
      const [lon, lat] = f.geometry.coordinates;
      if (bbox && (lat < bbox.minLat || lat > bbox.maxLat || lon < bbox.minLon || lon > bbox.maxLon)) return;
      const cls = String(p.class || ""), sub = String(p.subclass || cls);
      let kind = null;
      if (TILE_CALM.has(sub) || TILE_CALM.has(cls)) kind = "calm";
      else if (TILE_FOOD.has(sub) || TILE_FOOD.has(cls)) kind = "food";
      else if (TILE_TRANSIT.has(sub) || TILE_TRANSIT.has(cls)) kind = "transit";
      else if (cls === "shop" || cls === "grocery" || cls.endsWith("_store") || cls === "clothing_store") kind = "shop";
      if (!kind) return;
      const key = name + "|" + lon.toFixed(4) + "," + lat.toFixed(4);
      if (seen.has(key)) return;
      seen.add(key);
      // OpenMapTiles "rank": 1 = most prominent/famous in the area, higher = obscure.
      out.push({ id: "t/" + key, name, lat, lon, kind, type: sub === "beer" ? "pub" : sub, rank: Number(p.rank) || 30 });
    });
    return out;
  }
  function mergePois(a, b) {
    const seen = new Set(a.map((p) => String(p.name).toLowerCase() + "|" + p.lat.toFixed(3) + "," + p.lon.toFixed(3)));
    return a.concat(b.filter((p) => !seen.has(String(p.name).toLowerCase() + "|" + p.lat.toFixed(3) + "," + p.lon.toFixed(3))));
  }

  async function placesAround(point) {
    const G = 0.005, HALF = 0.0125;
    const snap = (v, up) => ((up ? Math.ceil(v / G) : Math.floor(v / G)) * G).toFixed(3);
    const key = `${snap(point.lat - HALF, false)},${snap(point.lon - HALF, false)},${snap(point.lat + HALF, true)},${snap(point.lon + HALF, true)}`;
    const [s, w, n, e] = key.split(",").map(Number);
    const fromTiles = tilePois({ minLat: s, minLon: w, maxLat: n, maxLon: e });
    const hit = poiCache.get(key);
    if (hit && !hit.failed) return mergePois(hit.pois, fromTiles);
    let pois = [];
    try {
      const resp = await fetchPoisWithRetry(`${apiBaseUrl}/api/pois?bbox=${key}`);
      if (resp && resp.ok) { pois = (await resp.json()).pois || []; poiCache.set(key, { at: Date.now(), pois }); }
    } catch (err) { /* tiles still answer */ }
    return mergePois(pois, fromTiles);
  }
  const nameSearchCache = new Map(); // "q|lat2|lon2" -> places
  async function searchPlacesByName(query, here) {
    const key = `${String(query).trim().toLowerCase()}|${here.lat.toFixed(2)}|${here.lon.toFixed(2)}`;
    if (nameSearchCache.has(key)) return nameSearchCache.get(key);
    // Uses the geocoder (GraphHopper/Photon, already proxied for addresses)
    // with your position as the bias point: it returns chain branches nearest
    // first (measured: Starbucks at 468 m, 861 m, 996 m...). Overpass name
    // search was tried first but Overpass refuses/times out on these queries
    // from Cloudflare. Only real venues (amenity/shop/transit) are kept.
    const url = `${apiBaseUrl}/api/geocode?q=${encodeURIComponent(String(query).trim())}&point=${here.lat.toFixed(5)},${here.lon.toFixed(5)}&limit=10`;
    const resp = await fetch(url);
    if (!resp || !resp.ok) return [];
    const data = await resp.json();
    const VENUE_KEYS = { amenity: "food", shop: "shop", railway: "transit", public_transport: "transit", tourism: "food", leisure: "food" };
    const places = (data.hits || [])
      .filter((h) => h && h.point && h.name && VENUE_KEYS[h.osm_key])
      .map((h) => ({
        id: `g/${h.name}/${h.point.lat.toFixed(5)},${h.point.lng.toFixed(5)}`,
        name: h.name,
        lat: h.point.lat,
        lon: h.point.lng,
        kind: h.osm_key === "shop" ? "shop" : VENUE_KEYS[h.osm_key],
      }));
    nameSearchCache.set(key, places);
    return places;
  }

  async function nearbyPlaceMatches(query) {
    const q = foldText(query).trim();
    if (q.length < 2) return [];
    const here = getUserContext().point;
    if (!here) return [];
    const categoryKinds = Object.keys(PLACE_CATEGORY_WORDS)
      .filter((k) => q.length >= 3 && PLACE_CATEGORY_WORDS[k].some((w) => w.startsWith(q) || q.startsWith(w)));
    // Name/brand search around you (2026-10-12): "Starbucks" -> the nearest
    // branches within ~6 km, not only what's loaded on the map. Runs in
    // parallel with the local area load; either may fail independently.
    const isCategory = categoryKinds.length > 0;
    const [around, named] = await Promise.all([
      placesAround(here).catch(() => []),
      isCategory || q.length < 3 ? Promise.resolve([]) : searchPlacesByName(query, here).catch(() => []),
    ]);
    const pools = [named, around];
    for (const entry of poiCache.values()) pools.push(entry.pois || []);
    const seen = new Set();
    const hits = [];
    for (const pool of pools) {
      for (const p of pool) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        const name = foldText(p.name);
        const nameMatch = name.startsWith(q) || name.split(/[\s\-'’.,&()]+/).some((w) => w.startsWith(q));
        if (!nameMatch && !categoryKinds.includes(p.kind)) continue;
        const d = NavLogic.haversineM(here.lat, here.lon, p.lat, p.lon);
        if (d > 6000) continue;
        // Famous places first (2026-10-13): a well-known place counts as
        // ~150 m "closer" per rank step, so a landmark bar 1 km away beats an
        // unknown one next door. Places without a rank count as average.
        const fame = Math.max(0, 30 - (p.rank || 25)) * 150;
        hits.push({ p, d, nameMatch, score: d - fame });
      }
    }
    // A name match beats a category match; then nearest first.
    hits.sort((a, b) => (b.nameMatch - a.nameMatch) || (a.score - b.score));
    // One entry per name, the nearest: map data often holds several points
    // for one place (a station's tram/bus/metro stops, a shop mapped twice).
    const names = new Set();
    const distinct = hits.filter(({ p }) => {
      const n = foldText(p.name).trim();
      if (names.has(n)) return false;
      names.add(n);
      return true;
    });
    const KIND = { food: "Café / food", shop: "Shop", transit: "Stop" };
    return distinct.slice(0, 3).map(({ p, d }) => ({
      type: p.kind,
      primary: p.name,
      secondary: `${KIND[p.kind] || "Place"} · ${d < 1000 ? Math.round(d / 10) * 10 + " m" : (d / 1000).toFixed(1) + " km"} away`,
      lat: p.lat,
      lon: p.lon,
      label: p.name,
    }));
  }

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
      startInput.blur();
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
  // Compact top card while a route is on screen (2026-10-09), like Google
  // Maps' from/to header: the Find button, safety checkbox and status line
  // fold away so the route itself is visible between the two cards. Tapping
  // either field brings the full form back.
  function setRouteShown(on) {
    routeSearchCard.classList.toggle("route-shown", !!on);
  }
  endInput.addEventListener("focus", () => setRouteShown(false));
  startInput.addEventListener("focus", () => setRouteShown(false));
  [endInput, startInput].forEach((el) => el.addEventListener("blur", () => setTimeout(() => {
    if (routeResultsCard.classList.contains("visible") && !routeSearchCard.contains(document.activeElement)) setRouteShown(true);
  }, 250)));

  // Bottom-sheet expand/collapse for the results card (2026-10-09).
  const sheetHandle = document.getElementById("sheetHandle");
  const sheetHandleLabel = document.getElementById("sheetHandleLabel");
  function setSheetExpanded(on) {
    routeResultsCard.classList.toggle("expanded", !!on);
    sheetHandle.setAttribute("aria-expanded", on ? "true" : "false");
    sheetHandle.setAttribute("aria-label", on ? "Hide route details" : "Show route details");
    sheetHandleLabel.textContent = on ? "Less" : "Details";
    if (on) routeResultsCard.scrollTop = 0;
  }
  sheetHandle.addEventListener("click", () => setSheetExpanded(!routeResultsCard.classList.contains("expanded")));

  // ---- Map peek (2026-10-12): with a route on screen, moving or tapping the
  // map tucks both cards away so the map is free to explore; the slim bar
  // (time · distance · Start) or the top line brings them back.
  const peekBar = document.getElementById("peekBar");
  const peekTop = document.getElementById("peekTop");
  function inPeek() { return pageInner0.classList.contains("map-peek"); }
  function setMapPeek(on) {
    if (on && !routeResultsCard.classList.contains("visible")) return;
    if (on && pageInner0.classList.contains("nav-active")) return;
    pageInner0.classList.toggle("map-peek", !!on);
    if (on) {
      document.getElementById("peekTime").textContent = document.getElementById("calmTime").textContent;
      document.getElementById("peekDist").textContent = "· " + document.getElementById("calmDist").textContent;
      peekTop.textContent = "To: " + (endInput.value || "your destination");
      setSheetExpanded(false);
    }
    requestAnimationFrame(() => map.resize());
  }
  map.on("dragstart", () => { if (routeResultsCard.classList.contains("visible")) setMapPeek(true); });
  map.on("click", (e) => {
    if (!routeResultsCard.classList.contains("visible") || inPeek()) return;
    // a tap on a dot/flower opens its card instead; empty map tucks the cards away
    const hitLayers = ["poi-circles", "calmspot-circles"].filter((id) => map.getLayer(id));
    if (hitLayers.length && map.queryRenderedFeatures(e.point, { layers: hitLayers }).length) return;
    setMapPeek(true);
  });
  document.getElementById("peekOpen").addEventListener("click", () => setMapPeek(false));
  document.getElementById("peekStart").addEventListener("click", () => { setMapPeek(false); startNavBtn.click(); });
  peekTop.addEventListener("click", () => { setMapPeek(false); });
  document.getElementById("showMapBtn").addEventListener("click", () => setMapPeek(true));
  // Swipe the route card down to show the map.
  (function () {
    let y0 = null;
    routeResultsCard.addEventListener("touchstart", (e) => { y0 = routeResultsCard.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
    routeResultsCard.addEventListener("touchend", (e) => {
      if (y0 == null) return;
      const dy = e.changedTouches[0].clientY - y0;
      y0 = null;
      if (dy > 70 && !inPeek()) setMapPeek(true);
    }, { passive: true });
  })();
  endInput.addEventListener("focus", () => { if (inPeek()) setMapPeek(false); });
  const endAutocomplete = new AutocompleteController({
    input: endInput,
    listEl: document.getElementById("endAcList"),
    statusEl: document.getElementById("endAcStatus"),
    isStartField: false,
    geocodingService: { forwardGeocode },
    endpointBase: apiBaseUrl,
    ranking: { rankHits },
    getUserContext,
    getLocalMatches: nearbyPlaceMatches,
    onSelect: (result) => {
      endSelectedResult = result;
      destinationPlace = result && result.type ? { name: result.label, lat: result.lat, lon: result.lon, type: result.type, kind: result.kind } : null;
      endInput.blur();
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

  // ---- Nearby cafés & bars as instant "Where to?" suggestions ----
  // Tap the empty search bar and the names of real cafés/bars around your
  // current location (GPS if granted, map center otherwise) appear
  // immediately — pick one and it routes there. Reuses the same /api/pois
  // pipeline (and therefore its caching/mirror discipline); typing anything
  // hands the list back to the normal address autocomplete.
  const endAcListEl = document.getElementById("endAcList");
  // The free public Overpass mirrors behind /api/pois reject or time out
  // roughly half the time (measured 2026-10-10: 3 of 6 requests 502'd, some
  // instantly), and back-to-back requests usually land on a healthy one —
  // so one short, delayed retry turns most "no cafés on the map" into a
  // working layer. Returns the final Response either way.
  async function fetchPoisWithRetry(url) {
    let resp;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        resp = await fetch(url);
        if (resp.ok || (resp.status !== 502 && resp.status !== 503 && resp.status !== 504)) return resp;
      } catch (e) {
        if (attempt === 1) throw e;
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
    return resp;
  }

  let nearbySuggest = { at: 0, key: null, items: [] };
  async function fetchNearbyFood(center) {
    const key = `${center.lat.toFixed(3)},${center.lon.toFixed(3)}`;
    if (nearbySuggest.key === key && Date.now() - nearbySuggest.at < 5 * 60 * 1000) return nearbySuggest.items;
    const d = 0.006; // ~600m box — walkable "around here"
    const bbox = `${(center.lat - d).toFixed(4)},${(center.lon - d).toFixed(4)},${(center.lat + d).toFixed(4)},${(center.lon + d).toFixed(4)}`;
    const resp = await fetchPoisWithRetry(`${apiBaseUrl}/api/pois?bbox=${bbox}`);
    if (!resp.ok) return [];
    const data = await resp.json();
    const items = (data.pois || [])
      .filter((p) => p.kind === "food")
      .map((p) => ({ ...p, distanceM: Math.round(NavLogic.haversineM(center.lat, center.lon, p.lat, p.lon)) }))
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, 8);
    nearbySuggest = { at: Date.now(), key, items };
    return items;
  }

  // Selecting any empty-state suggestion (pinned place, recent route,
  // nearby café) all does the same thing to the destination field — pulled
  // out once so the three sections below share one code path instead of
  // three near-identical pointerdown handlers.
  // The place behind the current destination when it came from a known
  // venue (recommendation / nearby list) — lets "How calm was it?" learn
  // by place TYPE, not just by this one address.
  let destinationPlace = null;
  function selectDestinationSuggestion(label, lat, lon, place) {
    destinationPlace = place || null;
    const selection = { label, lat, lon };
    endSelectedResult = selection;
    resolvedEnd = { label, lat, lon };
    endInput.value = label;
    endAcListEl.style.display = "none";
    expandSearchCard();
    runSearch();
  }
  const PIN_ICONS = { home: "🏠", work: "💼", star: "📍" };
  function appendSuggestionHeading(text) {
    const note = document.createElement("li");
    note.className = "ac-nearby-note";
    note.textContent = text;
    endAcListEl.appendChild(note);
  }
  function appendSuggestionOption(icon, primary, secondary, onPick) {
    const li = document.createElement("li");
    li.className = "ac-option";
    li.setAttribute("role", "option");
    const iconEl = document.createElement("span");
    iconEl.className = "ac-option-icon";
    iconEl.setAttribute("aria-hidden", "true");
    iconEl.innerHTML = CalmIcons.html(icon);
    const textWrap = document.createElement("span");
    textWrap.className = "ac-option-text";
    const primaryEl = document.createElement("span");
    primaryEl.className = "ac-option-primary";
    primaryEl.textContent = primary;
    textWrap.appendChild(primaryEl);
    if (secondary) {
      const secondaryEl = document.createElement("span");
      secondaryEl.className = "ac-option-secondary";
      secondaryEl.textContent = secondary;
      textWrap.appendChild(secondaryEl);
    }
    li.appendChild(iconEl);
    li.appendChild(textWrap);
    // pointerdown (not click) so the input's blur can't close the list
    // before the selection lands — same trick the autocomplete uses.
    li.addEventListener("pointerdown", (e) => { e.preventDefault(); onPick(); });
    endAcListEl.appendChild(li);
  }

  // ---- Calm-place recommendations (2026-10-12, calmrec.js) ----
  const CALM_PREFS_KEY = "calmRec.prefs.v1";
  function loadCalmPrefs() {
    try { return CalmRec.sanitizePrefs(JSON.parse(localStorage.getItem(CALM_PREFS_KEY) || "null")); } catch (e) { return CalmRec.emptyPrefs(); }
  }
  function saveCalmPrefs(prefs) {
    try { localStorage.setItem(CALM_PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* storage blocked: learning just won't persist */ }
  }
  // Curated spots carry their own category: quiet bars stay bars (so the
  // evening/bar logic and labels are right), everything else is a calm spot.
  const calmSpotPlaces = (window.CalmSpots && CalmSpots.CALM_SPOTS || []).map((sp) => (
    sp.category === "bar"
      ? { name: sp.name, lat: sp.lat, lon: sp.lon, kind: "food", type: "bar" }
      : { name: sp.name, lat: sp.lat, lon: sp.lon, kind: "calm", type: "garden" }));
  const calmSpotKeys = new Set(calmSpotPlaces.map((p) => CalmRec.placeKey(p)));
  async function calmRecommendations(center) {
    let around = [];
    try { around = await placesAround(center); } catch (e) { around = []; }
    return CalmRec.recommend(around.concat(calmSpotPlaces), {
      here: center, hour: new Date().getHours(), prefs: loadCalmPrefs(), calmSpotKeys,
    }, 5);
  }

  async function showNearbySuggestions() {
    if (endInput.value.trim() !== "") return;
    const c = userPoint || (() => { const m = map.getCenter(); return { lat: m.lat, lon: m.lng }; })();
    let items;
    try { items = await calmRecommendations(c); } catch (e) { items = []; }
    // The bar may have been typed into (or unfocused) while we fetched.
    if (endInput.value.trim() !== "" || document.activeElement !== endInput) return;

    const pinned = placesStore.getPinned();
    const recent = placesStore.getRecentRoutes();
    if (!items.length && !pinned.length && !recent.length) return;
    endAcListEl.innerHTML = "";

    if (pinned.length) {
      appendSuggestionHeading("Pinned places");
      pinned.forEach((p) => {
        appendSuggestionOption(PIN_ICONS[p.icon] || PIN_ICONS.star, p.label, null, () => selectDestinationSuggestion(p.label, p.lat, p.lon));
      });
    }
    if (recent.length) {
      appendSuggestionHeading("Recent");
      // De-duplicated by destination label — searching to the same place
      // with different starts (rare) shouldn't repeat the same entry twice.
      const seen = new Set();
      recent.forEach((r) => {
        if (seen.has(r.endLabel)) return;
        seen.add(r.endLabel);
        appendSuggestionOption("🕒", r.endLabel, null, () => selectDestinationSuggestion(r.endLabel, r.endLat, r.endLon));
      });
    }
    if (items.length) {
      appendSuggestionHeading("Calm places for you");
      const ICON = { library: "📚", park: "🌳", garden: "🌿", cafe: "☕", tea: "🍵", books: "📖", bakery: "🥐", restaurant: "🍽️", bar: "🍸", pub: "🍺", biergarten: "🍺" };
      items.forEach((r) => {
        const p = r.place;
        const meta = [r.label, `${r.distanceM} m`, r.reason].filter(Boolean).join(" · ");
        appendSuggestionOption(ICON[p.type] || (p.kind === "calm" ? "🌿" : "📍"), p.name, meta, () => selectDestinationSuggestion(p.name, p.lat, p.lon, p));
      });
    }
    endAcListEl.style.display = "block";
  }
  endInput.addEventListener("focus", showNearbySuggestions);
  endInput.addEventListener("input", () => {
    if (!endInput.value.trim()) showNearbySuggestions();
    updateClearDestinationVisibility();
  });
  startInput.addEventListener("focus", ensureUserLocation);
  endInput.addEventListener("focus", ensureUserLocation);

  // ---- Start from where you actually are (2026-09-03) ------------------
  // The start field used to open hardcoded to Amsterdam Centraal, so anyone
  // who wasn't standing at Centraal had to clear it before every single
  // route. Now it resolves to your real location on load and Centraal is
  // only the fallback.
  //
  // Deliberately non-blocking and silent on failure: if location is denied,
  // unavailable, or slow, the field simply keeps the fallback and the app
  // stays usable. It also never overwrites something you already typed —
  // the guard re-checks at resolve time, because the fix can take seconds
  // and you may have started typing in the meantime.
  (async function defaultStartToCurrentLocation() {
    const untouched = () =>
      !startSelectedResult && startInput.value === CONFIG.DEFAULT_START.label;
    if (!untouched()) return;
    startInput.placeholder = "Finding your location…";
    let here = null;
    try {
      here = await useCurrentLocationForStart();
    } catch (e) {
      here = null;
    }
    startInput.placeholder = "";
    if (!here || !untouched()) return;   // denied, failed, or you typed meanwhile
    resolvedStart = here;
    startInput.value = here.label;
    startSelectedResult = here;
    showUserDotAt(here); // your blue dot, like any maps app, once we know it
  })();

  // ---- Clear/change destination (2026-08-03) ----
  // "I make a mistake with the destination and have to close and reopen" —
  // there was genuinely no way to back out of a chosen destination short of
  // reloading the page. Clears the text + resolved selection + any stale
  // route already drawn for the old destination, but deliberately leaves
  // the rest of the expanded form alone (start point, travel mode, safety
  // toggle) — the mistake was the destination, not those.
  const clearDestinationBtn = document.getElementById("clearDestinationBtn");
  function updateClearDestinationVisibility() {
    clearDestinationBtn.style.display = endInput.value.trim() ? "inline-flex" : "none";
  }
  updateClearDestinationVisibility(); // syncs against the pre-filled default destination (see endInput.value above)
  // `refocus: false` is for programmatic resets (after Stop/arrival), where
  // popping the keyboard and the suggestion list open uninvited is unwanted.
  function clearDestination({ refocus = true } = {}) {
    endInput.value = "";
    endSelectedResult = null;
    lastResult = null;
    clearRouteLayers();
    if (travelMode === "transit") clearTransitRoute();
    routeResultsCard.classList.remove("visible");
    setRouteShown(false);
    routeCompare.style.display = "none";
    startNavBtn.style.display = "none";
    document.getElementById("routeAlternatives").open = false;
    // Status text belongs to the search that was just discarded — leaving
    // it up ("routing service returned an error", a night-safety heads-up)
    // reads as a live problem with the NEXT search before one has even run.
    modeNote.textContent = "";
    safetyNote.style.display = "none";
    errorBanner.style.display = "none";
    // Same for the autocomplete's own status line ("couldn't load
    // suggestions for …") — it described the text that was just cleared.
    const endAcStatusEl = document.getElementById("endAcStatus");
    if (endAcStatusEl) endAcStatusEl.innerHTML = "";
    updatePinButtonVisibility();
    updateClearDestinationVisibility();
    if (!refocus) return;
    endInput.focus();
    showNearbySuggestions();
  }
  clearDestinationBtn.addEventListener("click", () => clearDestination());

  // ---- Save-as-pinned-place (2026-08-03) ----
  const pinDestinationBtn = document.getElementById("pinDestinationBtn");
  const pinEditor = document.getElementById("pinEditor");
  const pinEditorLabel = document.getElementById("pinEditorLabel");
  const pinEditorIcons = Array.from(document.querySelectorAll("#pinEditorIcons .pill"));
  let pinEditorIcon = "star";
  // Only meaningful once a destination is actually resolved to real
  // coordinates — a raw, unresolved text field has nothing to pin.
  function updatePinButtonVisibility() {
    pinDestinationBtn.style.display = endSelectedResult ? "inline-flex" : "none";
    updateClearDestinationVisibility();
  }
  pinDestinationBtn.addEventListener("click", () => {
    if (!endSelectedResult) return;
    pinEditorLabel.value = endSelectedResult.label;
    pinEditorIcon = "star";
    pinEditorIcons.forEach((btn) => btn.classList.toggle("active", btn.dataset.icon === "star"));
    pinEditor.style.display = "flex";
    pinEditorLabel.focus();
    pinEditorLabel.select();
  });
  pinEditorIcons.forEach((btn) => {
    btn.addEventListener("click", () => {
      pinEditorIcon = btn.dataset.icon;
      pinEditorIcons.forEach((b) => b.classList.toggle("active", b === btn));
    });
  });
  document.getElementById("pinEditorCancel").addEventListener("click", () => {
    pinEditor.style.display = "none";
  });
  document.getElementById("pinEditorSave").addEventListener("click", () => {
    if (!endSelectedResult) { pinEditor.style.display = "none"; return; }
    const label = pinEditorLabel.value.trim() || endSelectedResult.label;
    placesStore.addPin({ label, icon: pinEditorIcon, lat: endSelectedResult.lat, lon: endSelectedResult.lon });
    pinEditor.style.display = "none";
    modeNote.textContent = `Pinned "${label}".`;
    renderPinnedPlacesList();
  });

  // Settings-sheet management: list + delete only (adding happens from the
  // pin button above, in context, where the destination is already known).
  const pinnedPlacesListEl = document.getElementById("pinnedPlacesList");
  const pinnedPlacesEmptyEl = document.getElementById("pinnedPlacesEmpty");
  function renderPinnedPlacesList() {
    const pins = placesStore.getPinned();
    pinnedPlacesListEl.innerHTML = "";
    pinnedPlacesEmptyEl.style.display = pins.length ? "none" : "block";
    pins.forEach((p) => {
      const li = document.createElement("li");
      li.className = "pinned-place-row";
      const icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = CalmIcons.html(PIN_ICONS[p.icon] || PIN_ICONS.star);
      const label = document.createElement("span");
      label.className = "pinned-place-label";
      label.textContent = p.label;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "pinned-place-remove-btn";
      removeBtn.setAttribute("aria-label", `Remove pinned place "${p.label}"`);
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", () => {
        placesStore.removePin(p.id);
        renderPinnedPlacesList();
      });
      li.appendChild(icon);
      li.appendChild(label);
      li.appendChild(removeBtn);
      pinnedPlacesListEl.appendChild(li);
    });
  }

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

  // The calm ribbon's ramp. Retuned 2026-09-03 with the rest of the palette:
  // these were picked against the old cream ground and read as a stock
  // green->amber->red "risk" scale. The ramp now walks the app's own hues —
  // moss (--calm) through brass (--accent) to brick (--busy) — so a segment's
  // colour is recognisably the same language as the route line and the calm
  // badge, not a second, unrelated scale the reader has to learn.
  const CLASS_COLORS = {
    path: "#35604A", footway: "#3E6B52", track: "#4A7860", pedestrian: "#57856D",
    cycleway: "#66927B", living_street: "#77A08A", residential: "#8CAE9B",
    unclassified: "#A0A78C", service: "#B09E78", tertiary: "#B98A57",
    secondary: "#A86A3E", primary: "#96512F", trunk: "#8E4029", motorway: "#6E2E1C",
    other: "#8A9296",
  };

  // Quiet-to-busy order, so the ribbon reads as one scale rather than as
  // whatever order the routing response happened to list the classes in.
  const CLASS_ORDER = ["path","footway","track","pedestrian","cycleway","living_street",
    "residential","unclassified","service","tertiary","secondary","primary","trunk","motorway","other"];
  const CLASS_LABELS = {
    path: "path", footway: "footpath", track: "track", pedestrian: "pedestrian street",
    cycleway: "cycle path", living_street: "living street", residential: "residential street",
    unclassified: "minor road", service: "service road", tertiary: "small through-road",
    secondary: "through-road", primary: "main road", trunk: "major road",
    motorway: "motorway", other: "unclassified",
  };

  function renderBar(el, breakdownPct) {
    el.innerHTML = "";
    const keys = Object.keys(breakdownPct)
      .sort((a, b) => CLASS_ORDER.indexOf(a) - CLASS_ORDER.indexOf(b));
    keys.forEach((k) => {
      const seg = document.createElement("span");
      seg.style.width = breakdownPct[k] + "%";
      seg.style.background = CLASS_COLORS[k] || CLASS_COLORS.other;
      seg.title = `${CLASS_LABELS[k] || k}: ${breakdownPct[k]}%`;
      el.appendChild(seg);
    });
    // The ribbon is the only place the whole walk is shown at once. Sighted
    // users read it as a strip; without this a screen-reader user got a bare
    // row of empty spans. Named largest-first — the surfaces you will spend
    // most of the walk on are the ones worth hearing first.
    const spoken = keys
      .slice()
      .sort((a, b) => breakdownPct[b] - breakdownPct[a])
      .slice(0, 4)
      .map((k) => `${breakdownPct[k]}% ${CLASS_LABELS[k] || k}`)
      .join(", ");
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", `Route surfaces, quietest first: ${spoken}.`);
  }

  // greenPct is real, measured OSM data (see routing.js's fetchGreenWays +
  // greenscore.js), not another road-class guess — null means it genuinely
  // wasn't measured (demo mode, or the Overpass fetch failed), and the badge
  // hides itself rather than showing a fabricated number. Distinct wording
  // ("measured") from the road-class breakdown bar above it on purpose.
  function renderGreenMeasurement(el, greenPct) {
    if (greenPct == null) {
      el.style.display = "none";
      return;
    }
    el.style.display = "flex";
    el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22V12M12 12C12 7 8 4 3 4c0 5 3 8 9 8ZM12 12c0-5 4-8 9-8 0 5-3 8-9 8Z"/></svg>';
    el.appendChild(document.createTextNode(`${greenPct}% measured near green space`));
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
      icon.innerHTML = CalmIcons.html(signIcon(s.sign));
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
  let searchAgainAfter = false;

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
    document.getElementById("transitWhen").classList.toggle("on", on);
    transitNoteEl.style.display = on ? "block" : "none";
    if (!on) { transitResultsEl.innerHTML = ""; clearTransitRoute(); }
  }

  function selectTransitOption(idx) {
    transitResultsEl.querySelectorAll(".transit-option").forEach((el, i) => {
      el.classList.toggle("selected", i === idx);
    });
    if (transitItineraries[idx]) drawTransitItinerary(transitItineraries[idx]);
  }

  // Live-aware transit cards (2026-10-12): line colours, live/delay badge,
  // cancellations, platform, operator and stop counts from Transitous.
  function lineChip(leg) {
    const icon = CalmIcons.html(TRANSIT_MODE_ICONS[leg.mode] || "🚌");
    if (!leg.route) return `<span class="transit-leg">${icon}</span>`;
    const bg = leg.color ? `#${leg.color}` : "var(--surface-2)";
    const fg = leg.textColor ? `#${leg.textColor}` : (leg.color ? "#fff" : "var(--ink)");
    return `<span class="transit-leg">${icon}<b class="line-chip" style="background:${bg};color:${fg}">${escapeHtml(leg.route)}</b></span>`;
  }
  function delayBadge(leg) {
    if (!leg) return "";
    if (leg.cancelled) return `<span class="live-badge cancelled">Cancelled</span>`;
    if (!leg.realTime) return `<span class="live-badge sched">Timetable</span>`;
    if (leg.delayMin == null || leg.delayMin === 0) return `<span class="live-badge ok">Live · on time</span>`;
    return leg.delayMin > 0 ? `<span class="live-badge late">Live · +${leg.delayMin} min</span>` : `<span class="live-badge ok">Live · ${-leg.delayMin} min early</span>`;
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function renderTransitOptions(itineraries) {
    transitResultsEl.innerHTML = "";
    itineraries.forEach((it, idx) => {
      const card = document.createElement("button");
      card.type = "button";
      const first = it.legs.find((l) => l.mode !== "WALK");
      const cancelled = it.legs.some((l) => l.cancelled);
      card.className = "route-card transit-option" + (idx === 0 ? " selected" : "") + (cancelled ? " is-cancelled" : "");
      card.setAttribute("role", "listitem");
      const mins = it.durationS != null ? Math.round(it.durationS / 60) : null;
      const legsHtml = it.legs.map(lineChip).join('<span class="transit-leg-sep" aria-hidden="true">›</span>');
      const detail = first ? [
        first.fromName ? `from ${escapeHtml(first.fromName)}` : "",
        first.track ? `platform ${escapeHtml(first.track)}` : "",
        first.stops ? `${first.stops} stop${first.stops === 1 ? "" : "s"}` : "",
        first.agency ? escapeHtml(first.agency) : "",
      ].filter(Boolean).join(" · ") : "";
      card.innerHTML = `
        <div class="rc-label">${transitTimeHHMM(it.startTime)} → ${transitTimeHHMM(it.endTime)} ${delayBadge(first)}</div>
        <div class="rc-time">${mins != null ? mins + " min" : "—"}</div>
        <div class="rc-sub">${it.transfers} transfer${it.transfers === 1 ? "" : "s"}</div>
        <div class="transit-legs">${legsHtml}</div>
        ${detail ? `<div class="transit-detail">${detail}</div>` : ""}`;
      card.addEventListener("click", () => selectTransitOption(idx));
      transitResultsEl.appendChild(card);
    });
  }

  const transitWhenMode = document.getElementById("transitWhenMode");
  const transitWhenTime = document.getElementById("transitWhenTime");
  function transitWhenQuery() {
    const m = transitWhenMode.value;
    if (m === "now" || !transitWhenTime.value) return "";
    const t = new Date(transitWhenTime.value);
    if (isNaN(t)) return "";
    return `&time=${encodeURIComponent(t.toISOString())}${m === "arrive" ? "&arriveBy=true" : ""}`;
  }
  transitWhenMode.addEventListener("change", () => {
    const later = transitWhenMode.value !== "now";
    transitWhenTime.hidden = !later;
    if (later && !transitWhenTime.value) {
      const d = new Date(Date.now() + 30 * 60000);
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      transitWhenTime.value = d.toISOString().slice(0, 16);
    }
    if (endInput.value.trim()) runSearch();
  });
  transitWhenTime.addEventListener("change", () => { if (endInput.value.trim()) runSearch(); });

  async function fetchTransitPlan(start, end) {
    const resp = await fetch(`${apiBaseUrl}/api/transit?from=${start.lat},${start.lon}&to=${end.lat},${end.lon}${transitWhenQuery()}`);
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
    // A newer request during a search (e.g. an address typed while a pinned-
    // spot search was loading) used to be dropped, routing to the OLD place.
    // Now it runs right after the current one finishes (2026-10-13).
    if (isSearching) { searchAgainAfter = true; return; }
    // Nothing to route to yet — the destination now opens empty, and an
    // empty field must not silently fall back to a stale/default endpoint.
    if (!endInput.value.trim()) {
      endInput.focus();
      return;
    }
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

    // Recorded once here — shared by both the transit and walk/bike branches
    // below, since resolvedStart/resolvedEnd are already final at this point
    // regardless of which one runs. Not recorded on a failed resolution of
    // BOTH fields (that's not a real place the user searched for).
    if (!(startFailed && endFailed)) {
      placesStore.addRoute({
        startLabel: resolvedStart.label, startLat: resolvedStart.lat, startLon: resolvedStart.lon,
        endLabel: resolvedEnd.label, endLat: resolvedEnd.lat, endLon: resolvedEnd.lon,
        travelMode,
      });
    }
    updatePinButtonVisibility();

    if (travelMode === "transit") {
      // Public-transport plan instead of the calm/fastest pair. Everything
      // above (input resolution, error surfacing) is shared; everything
      // below (calm scoring, Start button, turn-by-turn) is walk/bike-only.
      findBtnLabel.textContent = "Finding transit options…";
      transitItineraries = await fetchTransitPlan(resolvedStart, resolvedEnd);
      setTransitModeUI(true);
      routeResultsCard.classList.add("visible");
      setRouteShown(true);
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
    // Weighted calm score out of 10 on each card (2026-10-13).
    [["calmScore", result.calm], ["fastScore", result.fastest]].forEach(([id, p]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = p && p.calm10 != null ? `Calm ${p.calm10.toFixed(1)}/10` : "";
      el.title = p && p.calmFactors ? Object.entries(p.calmFactors).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}`).join(" · ") : "";
    });
    renderBar(document.getElementById("fastBar"), result.fastest.breakdownPct);
    renderGreenMeasurement(document.getElementById("calmGreen"), result.calm.greenPct);
    renderGreenMeasurement(document.getElementById("fastGreen"), result.fastest.greenPct);
    routeCompare.style.display = "flex";
    routeResultsCard.classList.add("visible");
    setRouteShown(true);
    setSheetExpanded(false); // every new route opens compact
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
      // The safety checkbox is folded away while a route is shown (compact
      // top card), so the note carries its own one-tap switch instead of
      // pointing at a control the user can't see. (2026-10-09)
      safetyNote.textContent = `Heads up: this calm route is ${result.calm.isolatedPct}% quiet paths/parks — calmer, but also less populated, and it's currently night hours.`;
      const safer = document.createElement("button");
      safer.type = "button";
      safer.className = "safety-note-btn";
      safer.textContent = "Use well-lit, busier streets";
      safer.addEventListener("click", () => {
        safetyToggle.checked = true;
        safetyToggle.dispatchEvent(new Event("change"));
      });
      safetyNote.appendChild(safer);
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
      if (searchAgainAfter) { searchAgainAfter = false; setTimeout(runSearch, 0); }
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
  // Echo/POI/CalmSpot marker is swallowed by that marker's own handler, so
  // there's no marker conflict. The route search starts against the raw
  // coordinates right away; the human-readable label arrives from a
  // parallel best-effort reverse geocode and only ever replaces the interim
  // coordinate label — never the selection itself — and is skipped if the
  // user has meanwhile picked a different destination.
  //
  // Unlike Leaflet, MapLibre does NOT cancel the pending single-click when
  // a double-click zoom lands — without the 300ms hold below, every
  // double-tap zoom would also pin a destination and fire a route search.
  //
  // Long-press, not tap (2026-10-09), the way Google/Apple Maps drop a pin:
  // a plain tap fired a route search, so every slightly-off pan, a tap meant
  // to dismiss the keyboard, or a tap aimed at a marker that missed sent the
  // user off routing somewhere random. A single finger held still for
  // LONG_PRESS_MS drops the pin; any movement or a second finger (pinch)
  // cancels. Right-click (desktop, and Android's own long-press) does the same.
  const LONG_PRESS_MS = 500;
  const LONG_PRESS_SLOP_PX = 10;
  let longPressTimer = null;
  let longPressOrigin = null;
  let lastPinDropAt = 0;
  function dropPin(e) {
    // A touch long-press can ALSO surface as contextmenu on some engines —
    // whichever arrives first wins, the other is ignored.
    if (Date.now() - lastPinDropAt < 1000) return;
    lastPinDropAt = Date.now();
    if (navigator.vibrate) navigator.vibrate(12);
    handleMapTap(e);
  }
  function cancelLongPress() {
    clearTimeout(longPressTimer);
    longPressTimer = null;
    longPressOrigin = null;
  }
  map.on("touchstart", (e) => {
    cancelLongPress();
    if (!e.originalEvent.touches || e.originalEvent.touches.length !== 1) return;
    longPressOrigin = e.point;
    const pressed = { point: e.point, lngLat: e.lngLat };
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      dropPin(pressed);
    }, LONG_PRESS_MS);
  });
  map.on("touchmove", (e) => {
    if (!longPressOrigin) return;
    const moved = Math.hypot(e.point.x - longPressOrigin.x, e.point.y - longPressOrigin.y);
    if (moved > LONG_PRESS_SLOP_PX || (e.originalEvent.touches && e.originalEvent.touches.length > 1)) cancelLongPress();
  });
  map.on("touchend", cancelLongPress);
  map.on("touchcancel", cancelLongPress);
  map.on("movestart", (e) => { if (e.originalEvent) cancelLongPress(); });
  map.on("contextmenu", (e) => {
    cancelLongPress();
    dropPin(e);
  });
  // A plain tap on the map now means "I'm done typing": put the keyboard
  // and the suggestion list away so the map is actually visible.
  map.on("click", () => {
    const active = document.activeElement;
    if (active === endInput || active === startInput) active.blur();
    endAutocomplete.close();
  });
  async function handleMapTap(e) {
    if (pageInner0.classList.contains("nav-active")) return;
    if (isSearching) return;
    // A tap on a POI or CalmSpot circle means "what is this place?", not
    // "route here" — the layer's own click handler shows the name/note;
    // this handler stands down.
    if (map.getLayer("poi-circles") && map.queryRenderedFeatures(e.point, { layers: ["poi-circles"] }).length) return;
    if (map.getLayer("calmspot-circles") && map.queryRenderedFeatures(e.point, { layers: ["calmspot-circles"] }).length) return;
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

  // ---- "Show my location" (2026-10-09) --------------------------------
  // Google/Apple Maps' arrow button: one tap shows the blue dot (with its
  // accuracy ring) and flies the map there. Planning screen only.
  const locateBtn = document.getElementById("locateBtn");
  const mapWrapEl = document.getElementById("mapWrap");
  // Keep the button riding just above the results card, whatever its height.
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => {
      const h = routeResultsCard.classList.contains("visible") ? routeResultsCard.offsetHeight : 0;
      mapWrapEl.style.setProperty("--sheet-h", h + "px");
    }).observe(routeResultsCard);
  }
  function showUserDotAt(point, accuracyM) {
    if (pageInner0.classList.contains("nav-active")) return; // navigation owns the dot then
    updateUserMarker(point.lat, point.lon, accuracyM || 25, null);
  }
  async function locateMe() {
    if (locateBtn.classList.contains("locating")) return;
    locateBtn.classList.add("locating");
    try {
      if (NavBridge.isNative) {
        const status = await Capacitor.Plugins.CalmNavBackground.getPermissionStatus();
        if (status.foreground !== "granted") {
          const req = await Capacitor.Plugins.CalmNavBackground.requestForegroundLocationPermission();
          if (!req.granted) throw new Error("denied");
        }
      }
      const fix = await NavBridge.location.getCurrentPosition();
      userPoint = { lat: fix.lat, lon: fix.lon };
      showUserDotAt(userPoint, fix.accuracyM);
      map.flyTo({ center: [fix.lon, fix.lat], zoom: Math.max(map.getZoom(), 16), duration: 900 });
      locateBtn.classList.add("located");
    } catch (e) {
      showError("Couldn't find your location. Check that location access is turned on for this app.");
    } finally {
      locateBtn.classList.remove("locating");
    }
  }
  locateBtn.addEventListener("click", locateMe);
  // Panning away means the map is no longer centred on you — same cue as
  // Google/Apple Maps (filled arrow = following you, outline = not).
  map.on("dragstart", () => locateBtn.classList.remove("located"));

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

  // Dev-only GPS simulator (2026-10-13): never on the public site — only on
  // the developer's own machine (localhost), via ?simulate=1 or config.js.
  const IS_LOCAL_DEV = /^(localhost|127\.0\.0\.1|\[::1\]|.+\.localhost)$/.test(location.hostname);
  const DEV_SIMULATION = IS_LOCAL_DEV && (!!CONFIG.DEV_SIMULATION || /[?&]simulate=1\b/.test(location.search));
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

  const arrivedRate = document.getElementById("arrivedRate");
  arrivedRate.querySelectorAll("[data-rate]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const place = destinationPlace || (resolvedEnd && { name: resolvedEnd.label, lat: resolvedEnd.lat, lon: resolvedEnd.lon, type: null });
      if (!place) return;
      saveCalmPrefs(CalmRec.learn(loadCalmPrefs(), place, btn.dataset.rate));
      arrivedRate.querySelectorAll("[data-rate]").forEach((b) => b.classList.toggle("chosen", b === btn));
      arrivedRate.querySelector(".arrived-rate-q").textContent = "Thanks — your suggestions will learn from this.";
    });
  });

  function petalBurst() {
    const reduced = root.getAttribute("data-motion") === "reduced" ||
      (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (reduced || !FlowTheme.isBloomActive(root.getAttribute("data-theme"))) return;
    const colors = ["#FF9EC2", "#C9A7F2", "#FFC39B", "#8FD9C0", "#FFD86B"];
    for (let i = 0; i < 18; i++) {
      const p = document.createElement("div");
      p.className = "petal-burst";
      const angle = (i / 18) * Math.PI * 2;
      const dist = 90 + (i % 4) * 30;
      p.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
      p.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
      p.style.setProperty("--rot", `${(i % 2 ? 1 : -1) * (120 + i * 10)}deg`);
      p.style.background = colors[i % colors.length];
      p.setAttribute("aria-hidden", "true");
      document.body.appendChild(p);
      p.addEventListener("animationend", () => p.remove());
    }
  }

  function showArrivedScreen() {
    petalBurst();
    arrivedRate.querySelectorAll("[data-rate]").forEach((b) => b.classList.remove("chosen"));
    arrivedRate.querySelector(".arrived-rate-q").textContent = "How calm was it?";
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

  // The carousel page navigation was launched from, so ending a route
  // early can put you back exactly where you were.
  let pageBeforeNavigation = 0;

  function endNavigation(message) {
    stopActiveLocationSource();
    backgroundNavNote.style.display = "none";
    usingSimulatedGps = false;
    simBadge.style.display = "none";
    navState = null;
    currentState = NavLogic.NavState.IDLE;
    navRerouting = false;
    appShellEl.classList.remove("nav-fullscreen");
    const nss = document.getElementById("navSoundSheet"); if (nss) nss.hidden = true;
    pageInner0.classList.remove("nav-active");
    document.body.classList.remove("nav-away");
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
    // Ending a route early used to tear down navigation state but leave you
    // wherever the carousel happened to be scrolled, so the app looked like
    // it hadn't closed. Go back to the page navigation was started from.
    // goToPage is a hoisted function declaration in this same scope.
    if (typeof goToPage === "function") {
      goToPage(pageBeforeNavigation, false);
    }
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
    pageBeforeNavigation = currentPage;
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
  // A user-initiated Stop/Done means "this trip is over": return to a clean
  // planning screen. Previously the finished route's results card (time,
  // Start, turn-by-turn list) stayed up and covered the map, and the old
  // destination stayed in the field, so there was no obvious way to go
  // anywhere new short of closing the app. (2026-10-09) Error-triggered
  // endNavigation() calls deliberately keep the route so it can be retried.
  function finishTrip() {
    endNavigation();
    clearDestination({ refocus: false });
    if (userPoint) showUserDotAt(userPoint); // endNavigation removed the nav dot
  }
  // Kalimba mid-walk: navigation (GPS, voice) keeps running under the page.
  document.getElementById("navKalimbaBtn").addEventListener("click", () => goToPage(2, false));
  // Sounds panel during navigation: drives the same chips/slider as the Sound page.
  const navSoundSheet = document.getElementById("navSoundSheet");
  const navSoundVol = document.getElementById("navSoundVol");
  function syncNavSoundSheet() {
    const cur = prefs.get().audio;
    navSoundSheet.querySelectorAll("[data-navsound]").forEach((b) => b.classList.toggle("active", cur.enabled && b.dataset.navsound === cur.soundscape && b.dataset.navsound !== "off"));
    navSoundVol.value = String(Math.round((cur.ambientVolume != null ? cur.ambientVolume : 0.55) * 100));
  }
  document.getElementById("navSoundsBtn").addEventListener("click", () => {
    syncNavSoundSheet();
    navSoundSheet.hidden = !navSoundSheet.hidden;
  });
  document.getElementById("navSoundClose").addEventListener("click", () => { navSoundSheet.hidden = true; });
  navSoundSheet.addEventListener("click", (e) => {
    const b = e.target.closest("[data-navsound]");
    if (!b) return;
    const v = b.dataset.navsound, cur = prefs.get().audio;
    // same rule as the Sound page: tapping the sound that's playing stops it
    setSoundscape(v !== "off" && cur.enabled && cur.soundscape === v ? "off" : v);
    if (window.CalmAudioKeepAlive) window.CalmAudioKeepAlive.reviveAll();
    syncNavSoundSheet();
  });
  navSoundVol.addEventListener("input", () => {
    setVolumes({ ambientVolume: Number(navSoundVol.value) / 100 });
  });
  document.getElementById("navBackBtn").addEventListener("click", () => goToPage(0, false));
  navEndBtn.addEventListener("click", finishTrip);
  document.getElementById("arrivedDoneBtn").addEventListener("click", finishTrip);

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
  // it's unlocked as early as possible. Unlock ONLY: this used to also
  // resume last session's soundscape, so the first tap anywhere (even on the
  // map) started noise the user never asked for. Sound now only ever starts
  // from picking a soundscape or preset. (2026-10-09)
  const unlockAudioOnce = () => {
    audioManager.ensureCtx();
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
  // Tapping the sound that's already playing stops it (simplified page, 2026-10-12).
  bindChipGroup(soundChips, "sound", isKnownSoundscape, (v) => {
    const a = prefs.get().audio;
    setSoundscape(v !== "off" && a.enabled && a.soundscape === v ? "off" : v);
  });
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
    // Every launch starts silent (2026-10-09): last session's soundscape is
    // not carried over as "selected", so the UI shows Off and nothing can
    // resume it behind the user's back — e.g. the master toggle or a nav
    // start, which both play whatever ambient.soundscape holds. Volumes,
    // mode and night mode are still restored.
    if (prefs.get().audio.soundscape !== "off") prefs.set({ audio: { soundscape: "off" } });
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

  // ---- Safety: blocked authors + my own author key (2026-10-12) ----
  // Blocking is per device and permanent until the app's data is cleared:
  // a blocked person's Echoes are never shown on this phone again.
  const BLOCKED_KEY = "calmEchoes.blockedAuthors";
  function readBlocked() {
    try { return new Set(JSON.parse(localStorage.getItem(BLOCKED_KEY) || "[]")); } catch (e) { return new Set(); }
  }
  let blockedAuthors = readBlocked();
  function blockAuthor(key) {
    if (!key) return;
    blockedAuthors.add(key);
    try { localStorage.setItem(BLOCKED_KEY, JSON.stringify([...blockedAuthors])); } catch (e) { /* storage full/blocked: still hidden this session */ }
  }
  // Same derivation the server uses (sha256(token) -> authorKey), so Report/
  // Block can be hidden on your own Echoes without the server revealing who
  // left what.
  let myAuthorKey = null;
  EchoValidation.hashCreatorToken(creatorToken)
    .then((h) => EchoValidation.deriveAuthorKey(h))
    .then((k) => { myAuthorKey = k; })
    .catch(() => {});

  // One shared ephemeral toast element for every Calm Echoes message
  // ("nearby", discovery notifications, save confirmation) — see index.html's
  // own comment on #echoToast for why these don't get three separate elements.
  const echoToastEl = document.getElementById("echoToast");
  let echoToastTimer = null;
  function showEchoToast(text, ms) {
    if (echoToastTimer) clearTimeout(echoToastTimer);
    const m = /^(✨)\s*/.exec(text);
    echoToastEl.innerHTML = m ? CalmIcons.html(m[1]) + " " + CalmIcons.html(text.slice(m[0].length)) : CalmIcons.html(text);
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
      nearbyEchoes = (data.echoes || []).filter((e) => !blockedAuthors.has(e.authorKey));
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
  // POIs render as a GL circle layer, not DOM markers: at "show me every
  // shop and bar in the neighborhood" densities (hundreds of points), DOM
  // markers jank — a circle layer draws thousands without breaking a
  // sweat, and clicks come through queryRenderedFeatures instead of
  // per-element listeners.
  const EMPTY_FC = { type: "FeatureCollection", features: [] };
  let poiPopup = null;
  function ensurePoiLayer() {
    if (map.getSource("pois")) return;
    map.addSource("pois", { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: "poi-circles", type: "circle", source: "pois",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 3, 17, 5.5],
        "circle-color": ["match", ["get", "kind"], "shop", getVar("--sky"), "transit", getVar("--calm"), getVar("--accent")],
        "circle-stroke-width": 1.5,
        "circle-stroke-color": getVar("--surface"),
      },
    });
    map.on("click", "poi-circles", (e) => {
      const f = e.features && e.features[0];
      if (!f) return;
      if (poiPopup) poiPopup.remove();
      // Same photo + "what is it" card as the calm flowers (2026-10-12).
      const [lon, lat] = f.geometry.coordinates;
      const kindType = f.properties.type || ({ food: "cafe", shop: "shop", transit: "stop", calm: "garden" })[f.properties.kind] || "";
      poiPopup = buildPlaceCardPopup({ name: f.properties.name, lat, lon, type: kindType }, null).addTo(map);
    });
  }

  // Every map pin popup (POI, CalmSpot) shares this: a name, an optional
  // note, and a "Go here" button — added 2026-08-03 because a popup that
  // only shows a name with no way to act on it isn't useful ("I have to
  // click and see what it is, then I have no way to decide to go there").
  // Reuses selectDestinationSuggestion, the exact same set-destination-and-
  // search path the empty-state suggestions dropdown already uses.
  // Place card for calm flowers (2026-10-12): photo + what it is + why it's
  // calm + a short description, filled in from Wikipedia / Wikimedia Commons
  // (placeinfo.js) while the card is already open.
  function buildPlaceCardPopup(place, note) {
    const wrap = document.createElement("div");
    wrap.className = "place-card";
    const photo = document.createElement("div");
    photo.className = "place-card-photo loading";
    photo.innerHTML = flowerSvg(BLOOM_COLORS[place.name.length % BLOOM_COLORS.length], 1);
    const body = document.createElement("div");
    body.className = "place-card-body";
    const title = document.createElement("strong");
    title.textContent = place.name;
    const kind = document.createElement("div");
    kind.className = "place-card-kind";
    const why = document.createElement("div");
    why.className = "place-card-why";
    why.textContent = note || "";
    const summary = document.createElement("p");
    summary.className = "place-card-summary";
    const credit = document.createElement("div");
    credit.className = "place-card-credit";
    const goBtn = document.createElement("button");
    goBtn.type = "button";
    goBtn.className = "map-pin-popup-go-btn";
    goBtn.textContent = "Go here";
    goBtn.addEventListener("click", () => {
      selectDestinationSuggestion(place.name, place.lat, place.lon);
      if (calmSpotPopup) { calmSpotPopup.remove(); calmSpotPopup = null; }
      if (poiPopup) { poiPopup.remove(); poiPopup = null; }
    });
    body.append(title, kind, why, summary, credit, goBtn);
    wrap.append(photo, body);
    const [k] = PlaceInfo.typeText(place.type);
    kind.textContent = k;
    // Last-resort picture: a live mini-map of the exact spot (never an empty card).
    const showMiniMap = () => {
      photo.classList.remove("loading");
      photo.innerHTML = "";
      photo.classList.add("is-map");
      const box = document.createElement("div");
      box.className = "place-card-minimap";
      photo.appendChild(box);
      try {
        const mm = new maplibregl.Map({ container: box, style: map.getStyle(), center: [place.lon, place.lat], zoom: 17.5, interactive: false, attributionControl: false });
        const pin = document.createElement("div");
        pin.className = "place-card-pin";
        pin.innerHTML = flowerSvg(BLOOM_COLORS[place.name.length % BLOOM_COLORS.length], 2);
        new maplibregl.Marker({ element: pin }).setLngLat([place.lon, place.lat]).addTo(mm);
      } catch (e) { /* tiles unavailable: keep the doodle */ }
    };
    PlaceInfo.lookup(place, { apiBase: apiBaseUrl }).then((info) => {
      kind.textContent = info.kind;
      if (!note) why.textContent = info.kindNote;
      if (info.summary) summary.textContent = info.summary;
      if (info.url) { const l = document.createElement("a"); l.href = info.url; l.target = "_blank"; l.rel = "noopener"; l.textContent = "More on Wikipedia"; credit.append(l, document.createTextNode(info.credit ? " · " : "")); }
      if (info.credit) credit.append(document.createTextNode(info.credit));
      if (info.photo) {
        const img = new Image();
        img.alt = place.name;
        img.onload = () => { photo.classList.remove("loading"); photo.innerHTML = ""; photo.appendChild(img); };
        img.onerror = showMiniMap;
        img.src = info.photo;
      } else showMiniMap();
    }).catch(showMiniMap);
    const popup = new maplibregl.Popup({ closeButton: true, offset: 14, maxWidth: "290px", className: "place-card-popup", anchor: "bottom" }).setLngLat([place.lon, place.lat]).setDOMContent(wrap);
    // Slide the map so the whole card fits on screen (it was cut off near the edges).
    popup.on("open", () => {
      const h = map.getContainer().clientHeight;
      map.easeTo({ center: [place.lon, place.lat], offset: [0, Math.min(170, h * 0.3)], duration: 350 });
    });
    return popup;
  }

  function buildGoHerePopup(lngLat, name, note) {
    const wrap = document.createElement("div");
    wrap.className = "map-pin-popup";
    const title = document.createElement("strong");
    title.textContent = name;
    wrap.appendChild(title);
    if (note) {
      const noteEl = document.createElement("div");
      noteEl.className = "map-pin-popup-note";
      noteEl.textContent = note;
      wrap.appendChild(noteEl);
    }
    const goBtn = document.createElement("button");
    goBtn.type = "button";
    goBtn.className = "map-pin-popup-go-btn";
    goBtn.textContent = "Go here";
    goBtn.addEventListener("click", () => {
      selectDestinationSuggestion(name, lngLat[1], lngLat[0]);
      if (poiPopup) { poiPopup.remove(); poiPopup = null; }
      if (calmSpotPopup) { calmSpotPopup.remove(); calmSpotPopup = null; }
    });
    wrap.appendChild(goBtn);
    return new maplibregl.Popup({ closeButton: false, offset: 8, maxWidth: "220px" }).setLngLat(lngLat).setDOMContent(wrap);
  }

  // CalmSpots (2026-08-03): a small, static, hand-curated layer (see
  // calmspots.js) — separate from the dynamic Overpass-fed "pois" source
  // above on purpose (there's no OSM tag for "calm", so this can't be a live
  // query). Loaded once at map init, not re-fetched per viewport.
  let calmSpotPopup = null;
  function ensureCalmSpotsLayer() {
    if (map.getSource("calmspots") || typeof CalmSpots === "undefined") return;
    map.addSource("calmspots", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: CalmSpots.CALM_SPOTS.map((s) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [s.lon, s.lat] },
          properties: { name: s.name, note: s.note, category: s.category },
        })),
      },
    });
    map.addLayer({
      id: "calmspot-circles", type: "circle", source: "calmspots",
      // Only 10 fixed points citywide — visible a bit earlier than the
      // dynamic POI layer (zoom 14) so they don't feel buried under a wall
      // of shop/food dots once the user does zoom in that far.
      minzoom: 12,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 4, 16, 7],
        "circle-color": getVar("--calm-spot"),
        "circle-stroke-width": 1.5,
        "circle-stroke-color": getVar("--surface"),
      },
    });
    map.on("mouseenter", "calmspot-circles", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "calmspot-circles", () => { map.getCanvas().style.cursor = ""; });
    map.on("click", "calmspot-circles", (e) => {
      const f = e.features && e.features[0];
      if (!f) return;
      if (calmSpotPopup) calmSpotPopup.remove();
      calmSpotPopup = buildGoHerePopup(f.geometry.coordinates, f.properties.name, f.properties.note).addTo(map);
    });
  }

  // ---- Bloom theme: flowers that open on calm spots (2026-10-12) ----
  // Replaces the plain calm-spot dots with small hand-drawn flowers that
  // bloom open and sway gently (CSS, see .bloom-flower). Static under
  // Reduced Motion. Tapping one shows the same "Go here" popup as the dot.
  let bloomFlowerMarkers = [];
  const BLOOM_COLORS = ["#FF9EC2", "#C9A7F2", "#FFC39B", "#8FD9C0", "#FFD86B"];
  function flowerSvg(color, i) {
    const petals = [0, 72, 144, 216, 288].map((deg) =>
      `<ellipse cx="20" cy="10.5" rx="6.2" ry="9" fill="${color}" transform="rotate(${deg} 20 20)" opacity="0.95"/>`).join("");
    const center = ["#FFD86B", "#F2875A", "#FFFFFF"][i % 3];
    return `<svg viewBox="0 0 40 40" aria-hidden="true">${petals}<circle cx="20" cy="20" r="5.5" fill="${center}" stroke="rgba(0,0,0,0.08)"/></svg>`;
  }
  function refreshBloomFlowers() {
    bloomFlowerMarkers.forEach((m) => m.remove());
    bloomFlowerMarkers = [];
    const bloom = FlowTheme.isBloomActive(root.getAttribute("data-theme"));
    if (map.getLayer && map.getLayer("calmspot-circles")) {
      map.setLayoutProperty("calmspot-circles", "visibility", bloom ? "none" : "visible");
    }
    if (!bloom) return;
    CalmSpots.CALM_SPOTS.forEach((sp, i) => {
      const el = document.createElement("div");
      el.className = "bloom-flower";
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", `${sp.name} — calm spot`);
      el.innerHTML = flowerSvg(BLOOM_COLORS[i % BLOOM_COLORS.length], i);
      // Stagger the opening so they bloom one after another, not all at once.
      el.firstChild.style.animationDelay = `${i * 0.12}s, ${1.1 + i * 0.12}s`;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (calmSpotPopup) calmSpotPopup.remove();
        calmSpotPopup = buildPlaceCardPopup({ name: sp.name, lat: sp.lat, lon: sp.lon, type: sp.category === "bar" ? "bar" : "garden" }, sp.note).addTo(map);
      });
      bloomFlowerMarkers.push(new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([sp.lon, sp.lat]).addTo(map));
    });
  }
  whenStyleReady(refreshBloomFlowers);
  // Weather doodles live inside the map's canvas layer so flower markers and
  // place cards always draw ON TOP of the sun/moon/clouds.
  (function () {
    const d = document.querySelector(".map-doodles");
    if (d && map.getCanvasContainer) map.getCanvasContainer().appendChild(d);
  })();

  // ---- Automatic calm spots, anywhere in Europe (2026-10-12) ----
  // The hand-researched CalmSpots only cover Amsterdam. Everywhere, the map
  // also blooms the 10 calmest places in view — libraries, gardens, small
  // parks, bookshops, tea rooms, cafés, quiet churches — picked from the
  // map's own place data by calmrec.js (which also learns from the person's
  // "how calm was it?" ratings). Honest label: "Usually quiet", never "curated".
  let autoFlowerMarkers = [];
  let lastAutoKey = "";
  function refreshAutoCalmFlowers() {
    if (map.getZoom() < 14 || pageInner0.classList.contains("nav-active")) {
      autoFlowerMarkers.forEach((m) => m.remove()); autoFlowerMarkers = []; lastAutoKey = ""; return;
    }
    const c = map.getCenter();
    const key = c.lat.toFixed(3) + "," + c.lng.toFixed(3) + "," + Math.round(map.getZoom());
    if (key === lastAutoKey) return;
    const b = map.getBounds();
    const places = tilePois({ minLat: b.getSouth(), minLon: b.getWest(), maxLat: b.getNorth(), maxLon: b.getEast() })
      .filter((p) => p.kind === "calm" || p.kind === "food");
    if (!places.length) return; // tiles still loading; the next idle tries again
    lastAutoKey = key;
    const curated = new Set(CalmSpots.CALM_SPOTS.map((s) => s.name.toLowerCase()));
    const picks = CalmRec.recommend(places.filter((p) => !curated.has(p.name.toLowerCase())), {
      here: { lat: c.lat, lon: c.lng }, hour: new Date().getHours(), prefs: loadCalmPrefs(), calmSpotKeys,
    }, 10).filter((r) => r.calm >= 0.6);
    autoFlowerMarkers.forEach((m) => m.remove());
    autoFlowerMarkers = picks.map((r, i) => {
      const p = r.place;
      const el = document.createElement("div");
      el.className = "bloom-flower bloom-flower-auto";
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", `${p.name} — ${r.reason || "calm place"}`);
      el.innerHTML = flowerSvg(BLOOM_COLORS[(i + 3) % BLOOM_COLORS.length], i + 20);
      el.firstChild.style.animationDelay = `${i * 0.1}s, ${1.1 + i * 0.1}s`;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (calmSpotPopup) calmSpotPopup.remove();
        calmSpotPopup = buildPlaceCardPopup(p, r.reason || "").addTo(map);
      });
      const mk = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([p.lon, p.lat]).addTo(map);
      el.setAttribute("aria-label", `${p.name} — ${r.reason || "calm place"}`); // MapLibre overwrites it with "Map marker"
      return mk;
    });
  }
  let autoFlowerTimer = null;
  map.on("idle", () => { clearTimeout(autoFlowerTimer); autoFlowerTimer = setTimeout(refreshAutoCalmFlowers, 300); });

  function clearPoiMarkers() {
    if (map.getSource("pois")) map.getSource("pois").setData(EMPTY_FC);
    if (poiPopup) { poiPopup.remove(); poiPopup = null; }
  }
  const POI_MIN_ZOOM = 14;
  const POI_CACHE_MS = 10 * 60 * 1000;
  const POI_MIN_FETCH_GAP_MS = 2500;
  // How long a FAILED lookup is remembered. Added 2026-09-03: only successes
  // were cached, so while Overpass was down every pan started another
  // multi-second request that was going to fail anyway — several in flight at
  // once, forever. Shorter than the success TTL so the map recovers on its own
  // once the upstream is healthy again, without the user reloading.
  const POI_FAIL_CACHE_MS = 90 * 1000;
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
    ensurePoiLayer();
    if (poiPopup) { poiPopup.remove(); poiPopup = null; }
    map.getSource("pois").setData({
      type: "FeatureCollection",
      features: pois.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: { name: p.name, kind: p.kind, type: p.type || "" },
      })),
    });
  }

  function rememberPoiFailure(key) {
    poiCache.set(key, { at: Date.now(), pois: [], failed: true });
  }

  async function refreshPois() {
    if (pageInner0.classList.contains("nav-active")) return;
    if (map.getZoom() < POI_MIN_ZOOM) { clearPoiMarkers(); return; }
    const bbox = poiGridBbox();
    const key = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
    const fromTiles = tilePois(bbox);
    whenStyleReady(() => renderPois(fromTiles)); // instant, everywhere in Europe
    const cached = poiCache.get(key);
    const ttl = cached && cached.failed ? POI_FAIL_CACHE_MS : POI_CACHE_MS;
    if (cached && Date.now() - cached.at < ttl) { whenStyleReady(() => renderPois(mergePois(cached.pois, fromTiles))); return; }
    if (Date.now() - lastPoiFetchAt < POI_MIN_FETCH_GAP_MS) return; // grid cache misses can't stampede Overpass
    lastPoiFetchAt = Date.now();
    try {
      const resp = await fetchPoisWithRetry(`${apiBaseUrl}/api/pois?bbox=${key}`);
      if (!resp.ok) { rememberPoiFailure(key); return; }
      const data = await resp.json();
      const pois = data.pois || [];
      poiCache.set(key, { at: Date.now(), pois });
      whenStyleReady(() => renderPois(mergePois(pois, tilePois(bbox))));
    } catch (e) {
      // Best-effort decoration — the map is complete without POI markers.
      rememberPoiFailure(key);
    }
  }

  map.on("moveend", () => {
    clearTimeout(poiDebounce);
    poiDebounce = setTimeout(refreshPois, 600);
  });
  // Tiles stream in after a move; re-read their places once the map settles.
  map.on("idle", () => {
    if (map.getZoom() < POI_MIN_ZOOM || pageInner0.classList.contains("nav-active")) return;
    const bbox = poiGridBbox();
    const key = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
    const cached = poiCache.get(key);
    renderPois(mergePois(cached && !cached.failed ? cached.pois : [], tilePois(bbox)));
  });

  // ---- Kalimba (page 3): play always, record + leave an Echo once unlocked ----
  const kalimbaTineButtons = Array.from(document.querySelectorAll("#kalimbaTineButtons .kalimba-tine-btn"));

  // Key presets (2026-08-03) — only affects live play/preview, never saved
  // Echo playback (see kalimbaengine.js's KalimbaEngine.pluck forceCanonicalKey
  // and echorecorder.js's play()). Not persisted to prefs.js on purpose: this
  // is a playing preference for right now, not a setting worth remembering
  // across sessions the way audio/haptics prefs are.
  const kalimbaKeyButtons = Array.from(document.querySelectorAll("#kalimbaKeyRow .pill"));
  kalimbaKeyButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      kalimbaEngine.setKey(btn.dataset.key);
      kalimbaKeyButtons.forEach((b) => b.classList.toggle("active", b === btn));
    });
  });
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
    // Walk-to-unlock removed (2026-10-12, owner's decision): Record is always
    // available. Spam is still bounded server-side (DAILY_ECHO_LIMIT per
    // device per day) and by the content filter/report/block moderation.
    // ExplorationTracker is kept (still tested) in case a gate returns.
    const ECHO_WALK_GATE = false;
    const progress = ECHO_WALK_GATE ? ExplorationTracker.unlockProgress(explorationState, Date.now()) : { unlocked: true };
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

  // Community rules (2026-10-12, App Store guideline 1.2): shown once, and
  // the first Save only counts as agreement on a second, deliberate tap.
  const RULES_KEY = "calmEchoes.rulesAccepted.v1";
  let rulesShown = false;
  function rulesAccepted() { try { return localStorage.getItem(RULES_KEY) === "1"; } catch (e) { return rulesShown; } }

  echoSaveBtn.addEventListener("click", async () => {
    const payload = echoRecorder.buildSavePayload();
    if (!payload) return;
    if (!rulesAccepted()) {
      if (!rulesShown) {
        rulesShown = true;
        echoRecordStatus.innerHTML = '<div class="echo-rules"><strong>Before you leave your first Echo:</strong> keep it kind. No insults, hate, sexual content, links or personal details (yours or anyone else\'s). Echoes that break this are removed, and anyone can report or block them. <a href="/privacy.html" target="_blank" rel="noopener">Privacy &amp; rules</a></div>';
        echoSaveBtn.dataset.label = echoSaveBtn.textContent;
        echoSaveBtn.textContent = "I agree — leave my Echo";
        return;
      }
      try { localStorage.setItem(RULES_KEY, "1"); } catch (e) { /* agreed for this session */ }
      if (echoSaveBtn.dataset.label) echoSaveBtn.textContent = echoSaveBtn.dataset.label;
    }
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

  const echoSafety = document.getElementById("echoSafety");
  const echoReportBtn = document.getElementById("echoReportBtn");
  const echoBlockBtn = document.getElementById("echoBlockBtn");
  const echoReportReasons = document.getElementById("echoReportReasons");
  let openEcho = null;

  function removeEchoLocally(predicate) {
    nearbyEchoes = nearbyEchoes.filter((e) => !predicate(e));
    renderEchoMarkers();
  }

  echoReportBtn.addEventListener("click", () => {
    echoReportReasons.hidden = !echoReportReasons.hidden;
  });
  echoReportReasons.querySelectorAll("[data-reason]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!openEcho) return;
      const echo = openEcho;
      echoReportReasons.querySelectorAll("button").forEach((b) => { b.disabled = true; });
      try {
        const resp = await fetch(`${apiBaseUrl}/api/echoes/${echo.id}/report`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reporterToken: creatorToken, reason: btn.dataset.reason }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          showEchoToast(err.error || "Couldn't send the report — please try again.", 4500);
          return;
        }
        removeEchoLocally((e) => e.id === echo.id);
        closeEchoDetail();
        showEchoToast("Thanks for reporting. This Echo is now hidden.", 4000);
      } catch (e) {
        showEchoToast("Couldn't reach the server — please try again.", 4000);
      } finally {
        echoReportReasons.querySelectorAll("button").forEach((b) => { b.disabled = false; });
      }
    });
  });
  echoBlockBtn.addEventListener("click", () => {
    if (!openEcho || !openEcho.authorKey) return;
    const key = openEcho.authorKey;
    blockAuthor(key);
    removeEchoLocally((e) => e.authorKey === key);
    closeEchoDetail();
    showEchoToast("Blocked. You won't see Echoes from this person again.", 4000);
  });

  function openEchoDetail(echo) {
    openEcho = echo;
    echoReportReasons.hidden = true;
    // Your own Echo: nothing to report or block (you can delete it instead).
    echoSafety.style.display = echo.authorKey && echo.authorKey === myAuthorKey ? "none" : "";
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
    openEcho = null;
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
  const TAGLINES = ["calm routing", "calm sounds", "studio", "community", "sketchbook", "fidget"];
  let currentPage = 0;
  let scrollRAF = null;

  function goToPage(i, smooth) {
    i = Math.max(0, Math.min(pages.length - 1, i));
    if (appShellEl.classList.contains("nav-fullscreen")) {
      // In full-screen navigation the pager is overflow:hidden, and
      // mandatory scroll-snap pulls a scripted jump straight back to the map
      // (found 2026-10-10 adding Kalimba-while-walking). Jump with snapping
      // off. Snapping must STAY off for the rest of the trip (turning it back
      // on re-snaps to the map); it is restored by the normal path below,
      // which endNavigation() always goes through.
      pagesWrap.style.scrollSnapType = "none";
      pagesWrap.style.scrollBehavior = "auto";
      pagesWrap.scrollLeft = pages[i].offsetLeft;
      requestAnimationFrame(syncActivePageToScroll);
      return;
    }
    pagesWrap.style.scrollSnapType = "";
    pagesWrap.style.scrollBehavior = "";
    pagesWrap.scrollTo({ left: pages[i].offsetLeft, behavior: smooth === false ? "auto" : "smooth" });
  }

  // The two off-screen pages stay in the DOM (scroll-snap needs them there),
  // so without this they keep every control tabbable and keep announcing
  // themselves to a screen reader: 22 of 50 focusable elements sat off-screen
  // but reachable, and Tab from the routing form landed on the kalimba tines
  // with the focus ring somewhere the user could not see. `inert` removes
  // them from focus order, hit-testing and the a11y tree in one attribute;
  // aria-hidden is belt-and-braces for older engines. (2026-09-09)
  function applyPageIsolation(i) {
    // Clamp first. A non-finite or out-of-range index would make `idx !== i`
    // true for every page and mark ALL of them inert — which freezes the
    // whole app, not just one page. Before pages were inert-gated this was
    // merely cosmetic (blank dots), so the old code could afford to trust
    // the caller. It can't any more. (2026-09-09)
    if (!Number.isFinite(i)) i = currentPageOr0();
    i = Math.max(0, Math.min(pages.length - 1, i));
    pages.forEach((p, idx) => {
      const inactive = idx !== i;
      p.toggleAttribute("inert", inactive);
      p.setAttribute("aria-hidden", inactive ? "true" : "false");
    });
  }

  function currentPageOr0() {
    return Number.isFinite(currentPage) ? currentPage : 0;
  }

  function setActivePage(i) {
    // A NaN index must never reach the isolation logic, and must never be
    // stored: `NaN === NaN` is false, so a stored NaN would also defeat the
    // early-return below and re-run this on every scroll frame.
    if (!Number.isFinite(i)) return;
    i = Math.max(0, Math.min(pages.length - 1, i));
    if (i === currentPage) return;
    // Leaving the Kalimba page mid-recording cancels it — recording is tied
    // to being on that page, same guarantee closing the old kalimba modal
    // used to give for free.
    if (currentPage === 2) cancelKalimbaRecording();
    currentPage = i;
    applyPageIsolation(i);
    // While navigating, any page other than the map gets a way back.
    document.body.classList.toggle("nav-away", appShellEl.classList.contains("nav-fullscreen") && i !== 0);
    dots.forEach((d, idx) => {
      d.classList.toggle("active", idx === i);
      d.setAttribute("aria-selected", idx === i ? "true" : "false");
    });
    pageTagline.textContent = TAGLINES[i] || "";
    if (dots[i] && dots[i].scrollIntoView) dots[i].scrollIntoView({ inline: "nearest", block: "nearest" });
    if (i === 0) requestAnimationFrame(() => map.resize());
    if (i === 2) refreshEchoRecordGate();
  }

  applyPageIsolation(currentPage);

  dots.forEach((dot) => {
    dot.addEventListener("click", () => goToPage(parseInt(dot.dataset.page, 10)));
  });

  function syncActivePageToScroll() {
    // clientWidth is 0 whenever the pager is display:none or mid-layout —
    // a backgrounded PWA tab does this on resume. Dividing by it yields
    // NaN (0/0) or Infinity, which is where the freeze above came from.
    const width = pagesWrap.clientWidth;
    if (!width) return;
    setActivePage(Math.round(pagesWrap.scrollLeft / width));
  }
  pagesWrap.addEventListener("scroll", () => {
    if (scrollRAF) cancelAnimationFrame(scrollRAF);
    scrollRAF = requestAnimationFrame(syncActivePageToScroll);
  });
  // Belt-and-braces for the page you land on after a swipe: every page but
  // the active one is `inert` (untappable), so if the last scroll frame of a
  // momentum swipe is ever missed, the page you can SEE would ignore taps.
  // scrollend fires once the snap has actually settled. (2026-10-09)
  pagesWrap.addEventListener("scrollend", syncActivePageToScroll);

  // Basic swipe support is native via scroll-snap; keyboard left/right as a
  // non-touch fallback for accessibility.
  pagesWrap.addEventListener("keydown", (e) => {
    // Arrow keys belong to whatever has focus first (2026-10-10). The map
    // pans with arrows and those keydowns bubble up here — so on desktop,
    // nudging the map during navigation flipped to the Sound page with the
    // tabs hidden and no way back. Same for moving the caret in a text field.
    // And while navigating, nothing may change page at all.
    if (appShellEl.classList.contains("nav-fullscreen")) return;
    const t = e.target;
    if (t && t.closest && (t.closest("#map") || t.closest("input, textarea, select, [contenteditable='true']"))) return;
    if (e.key === "ArrowRight") { goToPage(currentPage + 1); e.preventDefault(); }
    if (e.key === "ArrowLeft") { goToPage(currentPage - 1); e.preventDefault(); }
  });

  // ---------------------------------------------------------------------
  // Initial render
  // ---------------------------------------------------------------------
  // First-time hint for the weather doodles (2026-10-13); dismissed for good.
  (function () {
    const tip = document.getElementById("weatherTip");
    if (!tip) return;
    let seen = false;
    try { seen = localStorage.getItem("calmHint.weatherDoodles.v1") === "1"; } catch (e) { /* storage blocked: show once per visit */ }
    if (!seen) setTimeout(() => { tip.hidden = false; }, 2500);
    document.getElementById("weatherTipClose").addEventListener("click", () => {
      tip.hidden = true;
      try { localStorage.setItem("calmHint.weatherDoodles.v1", "1"); } catch (e) { /* ok */ }
    });
  })();
  window.addEventListener("load", () => {
    map.resize();
    goToPage(0, false);
    // Zero-decision first run: destination is the one field someone's
    // actually likely to want to change (start already defaults sensibly),
    // focused and pre-selected so the very first keystroke replaces the
    // demo placeholder instead of requiring a manual clear first. Placed
    // last in the load handler, not its own earlier rAF — goToPage's
    // scrollTo above was winning that race and blurring it.
    // Touch devices: never focus on load — iOS would raise the keyboard (and
    // the page with it) before the user has done anything.
    if (!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches)) {
      endInput.focus();
      endInput.select();
    }
  });

  // Applies the persisted (or system-default) appearance now that every
  // dependency setTheme()/refreshMapTheme()/setNightMode() can reach —
  // map, tileLayer, prefs, audioManager, the ambient engines — has been
  // declared above. Must stay the last statement in this file; see
  // initTheme()'s own definition for why calling it any earlier throws.
  initTheme();

  // Narrow bridge for community.js (profiles + timeline), which lives in its
  // own file but needs the map, the current route and the device key.
  window.CalmApp = {
    map,
    apiBaseUrl,
    deviceToken: () => creatorToken,
    currentRoute: () => (lastResult ? (selected === "fast" ? lastResult.fastest : lastResult.calm) : null),
    lastFix: () => lastFixLatLng,
    navigateTo: (label, lat, lon) => selectDestinationSuggestion(label, lat, lon),
    userPoint: () => userPoint || (lastFixLatLng ? { lat: lastFixLatLng[0], lon: lastFixLatLng[1] } : null),
    setKalimbaVolume: (v) => audioManager.setBusVolume("instrument", v),
    isBlocked: (key) => blockedAuthors.has(key),
    blockAuthor,
    goToPage: (i) => goToPage(i),
    toast: (text) => showEchoToast(text),
  };
  window.dispatchEvent(new Event("calmapp:ready"));
})();
