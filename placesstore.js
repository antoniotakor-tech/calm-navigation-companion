// ---------------------------------------------------------------------------
// PlacesStore — recent routes (last 5) + pinned places (Home/Work/custom),
// localStorage-backed, same pattern as prefs.js (sanitize-on-load,
// degrade-to-defaults on corruption, no account/server involved).
//
// This reverses a previously-DELIBERATE scope cut: PROJECT_STATUS.md's
// "Known issues" section explicitly named "no recent-searches quick-pick"
// as a privacy decision, not an oversight, because it "conflicts with the
// 'no location history persisted' privacy stance taken elsewhere". Added
// 2026-08-03 on direct request, confirmed with the reversal named out loud.
// Kept consistent with that stance in every other respect: everything here
// lives ONLY in this browser's localStorage — nothing in this file ever
// sends a network request, and nothing server-side (the D1 database backing
// Calm Echoes, or any Function) ever sees this data. See
// PRIVACY_LOCATION_DISCLOSURE.md for the fuller privacy writeup.
// ---------------------------------------------------------------------------
(function () {
  "use strict";

  const STORAGE_KEY = "calmcompanion.places.v1";
  const MAX_RECENT_ROUTES = 5;
  // Not requested with a specific number — capped so a novelty feature can't
  // grow into unbounded storage over months of use. High enough that no
  // realistic "home/work/gym/a few favorites" use ever hits it.
  const MAX_PINS = 20;

  const DEFAULTS = { recentRoutes: [], pinned: [] };

  function newId() {
    return (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function isFiniteLat(v) { return typeof v === "number" && Number.isFinite(v) && v >= -90 && v <= 90; }
  function isFiniteLon(v) { return typeof v === "number" && Number.isFinite(v) && v >= -180 && v <= 180; }

  // Degrades a single malformed entry to null (dropped) rather than letting
  // one corrupted record wedge the whole list — same philosophy as prefs.js's
  // field-by-field sanitizeAudio, applied per-record instead of per-field.
  function sanitizeRoute(r) {
    if (!r || typeof r !== "object") return null;
    if (!isFiniteLat(r.startLat) || !isFiniteLon(r.startLon)) return null;
    if (!isFiniteLat(r.endLat) || !isFiniteLon(r.endLon)) return null;
    return {
      id: typeof r.id === "string" ? r.id : newId(),
      startLabel: typeof r.startLabel === "string" ? r.startLabel.slice(0, 120) : "Start",
      startLat: r.startLat, startLon: r.startLon,
      endLabel: typeof r.endLabel === "string" ? r.endLabel.slice(0, 120) : "Destination",
      endLat: r.endLat, endLon: r.endLon,
      travelMode: typeof r.travelMode === "string" ? r.travelMode : "walk",
      at: typeof r.at === "number" && Number.isFinite(r.at) ? r.at : Date.now(),
    };
  }

  const VALID_ICONS = ["home", "work", "star"];
  function sanitizePin(p) {
    if (!p || typeof p !== "object") return null;
    if (!isFiniteLat(p.lat) || !isFiniteLon(p.lon)) return null;
    const label = typeof p.label === "string" ? p.label.trim().slice(0, 60) : "";
    if (!label) return null;
    return {
      id: typeof p.id === "string" ? p.id : newId(),
      label,
      icon: VALID_ICONS.indexOf(p.icon) !== -1 ? p.icon : "star",
      lat: p.lat, lon: p.lon,
      createdAt: typeof p.createdAt === "number" && Number.isFinite(p.createdAt) ? p.createdAt : Date.now(),
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { recentRoutes: [], pinned: [] };
      const parsed = JSON.parse(raw);
      return {
        recentRoutes: Array.isArray(parsed.recentRoutes)
          ? parsed.recentRoutes.map(sanitizeRoute).filter(Boolean).slice(0, MAX_RECENT_ROUTES)
          : [],
        pinned: Array.isArray(parsed.pinned)
          ? parsed.pinned.map(sanitizePin).filter(Boolean).slice(0, MAX_PINS)
          : [],
      };
    } catch (e) {
      console.warn("PlacesStore: saved places were unreadable, starting empty.", e);
      return { recentRoutes: [], pinned: [] };
    }
  }

  function save(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* private mode / quota — degrade silently */ }
  }

  // ~40m — close enough to call it "the same start/end" for dedup purposes
  // without needing an exact float match, which real GPS/geocode jitter
  // would almost never produce twice in a row.
  const DEDUP_METERS = 40;
  function approxSameLatLon(aLat, aLon, bLat, bLon) {
    const dLat = (aLat - bLat) * 111320;
    const dLon = (aLon - bLon) * 111320 * Math.cos((aLat * Math.PI) / 180);
    return Math.sqrt(dLat * dLat + dLon * dLon) < DEDUP_METERS;
  }

  function PlacesStore() {
    this.state = load();
  }
  PlacesStore.prototype.getRecentRoutes = function () { return this.state.recentRoutes; };
  PlacesStore.prototype.getPinned = function () { return this.state.pinned; };

  // Most-recent-first, capped at MAX_RECENT_ROUTES, and re-searching the
  // same start/end pair moves it to the top instead of duplicating it.
  PlacesStore.prototype.addRoute = function (route) {
    const clean = sanitizeRoute(Object.assign({ id: newId(), at: Date.now() }, route));
    if (!clean) return this.state.recentRoutes;
    const withoutDup = this.state.recentRoutes.filter((r) => !(
      approxSameLatLon(r.startLat, r.startLon, clean.startLat, clean.startLon)
      && approxSameLatLon(r.endLat, r.endLon, clean.endLat, clean.endLon)
    ));
    this.state.recentRoutes = [clean, ...withoutDup].slice(0, MAX_RECENT_ROUTES);
    save(this.state);
    return this.state.recentRoutes;
  };
  PlacesStore.prototype.clearRoutes = function () {
    this.state.recentRoutes = [];
    save(this.state);
  };

  // Newest-last is fine for pins (no strong ordering need like "recent"
  // routes have) — sorted by label in the UI instead, see app.js.
  PlacesStore.prototype.addPin = function (pin) {
    const clean = sanitizePin(Object.assign({ id: newId(), createdAt: Date.now() }, pin));
    if (!clean) return this.state.pinned;
    if (this.state.pinned.length >= MAX_PINS) return this.state.pinned;
    this.state.pinned = [...this.state.pinned, clean];
    save(this.state);
    return this.state.pinned;
  };
  PlacesStore.prototype.removePin = function (id) {
    this.state.pinned = this.state.pinned.filter((p) => p.id !== id);
    save(this.state);
    return this.state.pinned;
  };

  PlacesStore.STORAGE_KEY = STORAGE_KEY;
  PlacesStore.MAX_RECENT_ROUTES = MAX_RECENT_ROUTES;
  PlacesStore.MAX_PINS = MAX_PINS;
  PlacesStore.VALID_ICONS = VALID_ICONS;
  PlacesStore.sanitizeRoute = sanitizeRoute;
  PlacesStore.sanitizePin = sanitizePin;
  PlacesStore.approxSameLatLon = approxSameLatLon;

  if (typeof window !== "undefined") window.PlacesStore = PlacesStore;
  if (typeof module === "object" && module.exports) module.exports = PlacesStore;
})();
