// ---------------------------------------------------------------------------
// Calm-place recommender (2026-10-12) — pure functions, no DOM/network, so it
// runs under `node --test` like routing.js and searchranking.js.
//
// Privacy by design: everything the recommender learns lives on the device
// (see app.js, localStorage key "calmRec.prefs.v1"). Nothing is sent to a
// server, and there is no profile anywhere else.
//
// How a place is scored (0..1, higher = recommend first):
//   1. A prior "how calm is this kind of place" from its OSM type — a
//      library or park is calmer than a café, which is calmer than a bar,
//      which is calmer than a nightclub. These are educated guesses: no map
//      has real noise levels for venues, which is exactly why step 4 exists.
//   2. Time of day: bars/pubs get louder in the evening; nightclubs are
//      excluded at night entirely rather than "lightly penalised".
//   3. Curated CalmSpots (calmspots.js) get a boost.
//   4. What THIS person told us: after arriving somewhere they rate it
//      calm / okay / too busy. Ratings shift that place directly and nudge
//      every place of the same type (so liking three cafés lifts cafés).
//   5. Distance: a calm place 2 km away is less useful than one around the
//      corner — blended in, not dominant.
// Each result carries a short human-readable reason, because a
// recommendation people can't understand is one they don't trust.
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CalmRec = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TYPE_CALM = {
    library: 0.92, park: 0.88, garden: 0.88,
    cafe: 0.7, tea: 0.72, books: 0.7, ice_cream: 0.55, bakery: 0.55,
    restaurant: 0.5, biergarten: 0.45, pub: 0.35, bar: 0.3,
    fast_food: 0.25, food_court: 0.2, nightclub: 0.05,
  };
  const KIND_DEFAULT = { calm: 0.85, food: 0.45, shop: 0.4, transit: 0.1 };
  const TYPE_LABEL = {
    library: "Library", park: "Park", garden: "Garden", cafe: "Café", tea: "Tea shop", books: "Bookshop",
    ice_cream: "Ice cream", bakery: "Bakery", restaurant: "Restaurant", biergarten: "Beer garden",
    pub: "Pub", bar: "Bar", fast_food: "Fast food", food_court: "Food court", nightclub: "Club",
  };
  const RATING = { calm: 1, ok: 0, busy: -1 };
  const MAX_DISTANCE_M = 2500;

  function emptyPrefs() {
    return { v: 1, types: {}, places: {} }; // types: {type: {sum, n}}, places: {key: rating}
  }

  function sanitizePrefs(p) {
    if (!p || typeof p !== "object" || p.v !== 1) return emptyPrefs();
    return { v: 1, types: p.types && typeof p.types === "object" ? p.types : {}, places: p.places && typeof p.places === "object" ? p.places : {} };
  }

  /** Stable key for a place across sessions: name + ~10 m rounded position. */
  function placeKey(place) {
    return `${String(place.name || "").toLowerCase()}@${Number(place.lat).toFixed(4)},${Number(place.lon).toFixed(4)}`;
  }

  function isNight(hour) { return hour >= 21 || hour < 6; }

  function baseCalm(place) {
    if (place.type && TYPE_CALM[place.type] != null) return TYPE_CALM[place.type];
    return KIND_DEFAULT[place.kind] != null ? KIND_DEFAULT[place.kind] : 0.4;
  }

  /**
   * Scores one place. context: { here:{lat,lon}, hour (0-23), prefs, calmSpotKeys:Set }.
   * Returns null for places that should never be recommended (transit, too
   * far, a nightclub at night, a place this person rated "too busy").
   */
  function scorePlace(place, context) {
    if (!place || place.kind === "transit") return null;
    const prefs = context.prefs || emptyPrefs();
    const key = placeKey(place);
    const own = prefs.places[key];
    if (own === RATING.busy) return null;
    const d = haversineM(context.here.lat, context.here.lon, place.lat, place.lon);
    if (d > MAX_DISTANCE_M) return null;
    const hour = context.hour != null ? context.hour : 12;
    if (place.type === "nightclub" && isNight(hour)) return null;

    let calm = baseCalm(place);
    const reasons = [];
    if (isNight(hour) && (place.type === "bar" || place.type === "pub" || place.type === "biergarten")) calm -= 0.15;

    const isCalmSpot = context.calmSpotKeys && context.calmSpotKeys.has(key);
    if (isCalmSpot) { calm += 0.25; reasons.push("Curated calm spot"); }

    if (own === RATING.calm) { calm += 0.3; reasons.push("You found it calm"); }
    const t = place.type && prefs.types[place.type];
    if (t && t.n > 0) {
      const avg = t.sum / t.n; // -1..1
      calm += Math.max(-0.25, Math.min(0.25, avg * 0.2 * Math.min(1, t.n / 3)));
      if (avg > 0.3 && !own) reasons.push(`You like ${(TYPE_LABEL[place.type] || place.type).toLowerCase()}s`);
    }

    calm = Math.max(0, Math.min(1.2, calm));
    const proximity = Math.max(0, 1 - d / MAX_DISTANCE_M);
    const score = calm * 0.75 + proximity * 0.25;

    if (!reasons.length) {
      if (calm >= 0.85) reasons.push("Usually quiet");
      else if (calm >= 0.65) reasons.push("Often calm");
    }
    return { place, key, score, calm, distanceM: Math.round(d), reason: reasons[0] || null, label: TYPE_LABEL[place.type] || null };
  }

  /** Ranks places, best first; one entry per place key. */
  function recommend(places, context, limit) {
    const seen = new Set();
    const out = [];
    for (const p of places || []) {
      const r = scorePlace(p, context);
      if (!r || seen.has(r.key)) continue;
      seen.add(r.key);
      out.push(r);
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit || 5);
  }

  /** Returns NEW prefs with one rating applied ("calm" | "ok" | "busy"). */
  function learn(prefs, place, ratingName) {
    const value = RATING[ratingName];
    if (value == null || !place) return sanitizePrefs(prefs);
    const next = sanitizePrefs(JSON.parse(JSON.stringify(sanitizePrefs(prefs))));
    const key = placeKey(place);
    const previous = next.places[key];
    next.places[key] = value;
    if (place.type) {
      const t = next.types[place.type] || { sum: 0, n: 0 };
      if (previous != null) { t.sum -= previous; t.n -= 1; } // re-rating replaces, never double-counts
      t.sum += value; t.n += 1;
      next.types[place.type] = t;
    }
    return next;
  }

  function haversineM(lat1, lon1, lat2, lon2) {
    const R = 6371000, toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  return { TYPE_CALM, TYPE_LABEL, RATING, emptyPrefs, sanitizePrefs, placeKey, scorePlace, recommend, learn, isNight };
});
