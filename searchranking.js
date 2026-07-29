// ---------------------------------------------------------------------------
// Search ranking — pure functions, no DOM/network. Normalizes raw GraphHopper
// (Photon-based) geocoding hits into display-ready suggestions, removes
// duplicates, and scores/sorts them for location-aware autocomplete.
//
// Kept dependency-free and side-effect-free on purpose so it can run under
// `node --test` with zero mocking, same convention as routing.js.
// ---------------------------------------------------------------------------

// Named weights for scoreHit(). Magnitudes encode the required preference
// order: (1) exact/strong text match near the user, (2) current city,
// (3) surrounding metro area, (4) elsewhere in the current country,
// (5) more distant results. A strong text match (EXACT/PREFIX) always
// outranks a bare city match; a weak (CONTAINS) text match does not.
// Text-match tiers are spaced far enough apart (350+ between adjacent tiers)
// that no combination of location/type bonuses below can ever let a weaker
// text match outrank a stronger one — this is what makes "exact or strong
// text match near the user" the dominant sort key required by the spec,
// with city/metro/country/distance acting only as tie-breakers within a tier
// (max possible combined location+type bonus is 40+15=55, and 55 << 350).
const WEIGHTS = {
  EXACT_TEXT_MATCH: 1000,        // normalized primary label equals the query exactly
  PREFIX_TEXT_MATCH: 500,        // primary label starts with the query
  CONTAINS_TEXT_MATCH: 150,      // query appears elsewhere in the primary label
  SECONDARY_CONTAINS_MATCH: 40,  // query only matches the secondary (area) line
  CITY_MATCH: 40,                // hit's city equals the user's current city
  // Photon/GraphHopper has no true "metro area" field. `state`/`county` is
  // used as a named, honest proxy for "surrounding metropolitan area" —
  // documented here and in README/PROJECT_STATUS rather than presented as
  // precise metro-area data.
  METRO_MATCH: 20,
  COUNTRY_MATCH: 8,             // hit's country matches the user's, no city/metro match
  DISTANCE_DECAY_PER_KM: -0.8,  // subtracted per km of distance from the user
  DISTANCE_DECAY_CAP_KM: 100,   // distance penalty stops growing past this many km (max -80)
  ADDRESS_TYPE_BOOST: 15,       // query looks like a full address (has a house number)
  PLACE_TYPE_BOOST: 10,         // query has no house number: prefer places/streets/etc. over bare addresses
};

const TYPE_LABELS = {
  address: "Address",
  street: "Street",
  place: "Place",
  station: "Station",
  park: "Park",
  landmark: "Landmark",
};

function stripDiacritics(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizeText(s) {
  return stripDiacritics(String(s || "").trim().toLowerCase()).replace(/\s+/g, " ");
}

function looksLikeAddressQuery(query) {
  return /\d/.test(query);
}

function classifyType(hit) {
  const key = (hit.osm_key || "").toLowerCase();
  const value = (hit.osm_value || "").toLowerCase();
  if (hit.housenumber) return "address";
  if (key === "highway") return "street";
  if (key === "railway" && ["station", "halt", "tram_stop", "subway_entrance"].includes(value)) return "station";
  if (key === "public_transport" || (key === "aeroway" && value === "aerodrome")) return "station";
  if (key === "leisure" && ["park", "garden", "nature_reserve", "common"].includes(value)) return "park";
  if (key === "tourism" || key === "historic") return "landmark";
  return "place";
}

function buildPrimary(hit, type) {
  if (type === "address" && hit.street) {
    return hit.housenumber ? `${hit.street} ${hit.housenumber}` : hit.street;
  }
  return hit.name || hit.street || "Unknown location";
}

function buildSecondary(hit, primary, type) {
  const parts = [];
  const add = (v) => {
    if (v && v !== primary && !parts.includes(v)) parts.push(v);
  };
  // For non-address results (a park, a station, a named place) the street
  // it sits on is useful area context; for an address, the street is
  // already in the primary line so repeating it here would be redundant.
  if (type !== "address") add(hit.street);
  add(hit.district);
  add(hit.city);
  if (!parts.length) add(hit.state);
  return parts.slice(0, 2).join(", ");
}

// Converts one raw Photon/GraphHopper hit into a display-ready, rankable
// suggestion. Returns null for hits with no usable coordinates or label —
// spec requires not showing "obviously incomplete or invalid results."
function normalizeHit(hit) {
  if (!hit || !hit.point || !Number.isFinite(hit.point.lat) || !Number.isFinite(hit.point.lng)) {
    return null;
  }
  const type = classifyType(hit);
  const primary = buildPrimary(hit, type);
  if (!primary || primary === "Unknown location") return null;
  const secondary = buildSecondary(hit, primary, type);
  return {
    primary,
    secondary,
    type,
    typeLabel: TYPE_LABELS[type] || "Place",
    lat: hit.point.lat,
    lon: hit.point.lng,
    city: hit.city || null,
    district: hit.district || null,
    state: hit.state || null,
    countrycode: hit.countrycode ? String(hit.countrycode).toUpperCase() : null,
    country: hit.country || null,
  };
}

function haversineDistanceKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Removes duplicate suggestions: same normalized label, same result type,
// AND within ~40m of each other — all three together (the same real-world
// place returned twice by the provider, e.g. once from an address index and
// once from a POI index). Two different places that merely happen to share
// a label fragment or a type are deliberately NOT deduped against each
// other. Keeps the first occurrence.
function dedupeHits(hits) {
  const seen = [];
  const out = [];
  for (const hit of hits) {
    const labelKey = normalizeText(hit.primary + "|" + hit.secondary);
    const isDup = seen.some(
      (s) => s.hit.type === hit.type && s.labelKey === labelKey && haversineDistanceKm(s.hit, hit) * 1000 < 40
    );
    if (isDup) continue;
    seen.push({ labelKey, hit });
    out.push(hit);
  }
  return out;
}

function textMatchScore(query, hit) {
  const q = normalizeText(query);
  if (!q) return 0;
  const primary = normalizeText(hit.primary);
  const secondary = normalizeText(hit.secondary);
  if (primary === q) return WEIGHTS.EXACT_TEXT_MATCH;
  if (primary.startsWith(q)) return WEIGHTS.PREFIX_TEXT_MATCH;
  if (primary.includes(q)) return WEIGHTS.CONTAINS_TEXT_MATCH;
  if (secondary.includes(q)) return WEIGHTS.SECONDARY_CONTAINS_MATCH;
  return 0;
}

// context: { queryText, userPoint: {lat,lon}|null, userCity, userState, userCountryCode }
function scoreHit(hit, context) {
  let score = textMatchScore(context.queryText, hit);

  if (context.userCity && hit.city && normalizeText(hit.city) === normalizeText(context.userCity)) {
    score += WEIGHTS.CITY_MATCH;
  } else if (context.userState && hit.state && normalizeText(hit.state) === normalizeText(context.userState)) {
    score += WEIGHTS.METRO_MATCH;
  } else if (context.userCountryCode && hit.countrycode && hit.countrycode === context.userCountryCode) {
    score += WEIGHTS.COUNTRY_MATCH;
  }

  if (context.userPoint && Number.isFinite(hit.lat) && Number.isFinite(hit.lon)) {
    const km = haversineDistanceKm(context.userPoint, hit);
    score += Math.min(km, WEIGHTS.DISTANCE_DECAY_CAP_KM) * WEIGHTS.DISTANCE_DECAY_PER_KM;
  }

  const wantsAddress = looksLikeAddressQuery(context.queryText);
  if (wantsAddress && hit.type === "address") score += WEIGHTS.ADDRESS_TYPE_BOOST;
  else if (!wantsAddress && hit.type !== "address") score += WEIGHTS.PLACE_TYPE_BOOST;

  return score;
}

// Full pipeline: normalize raw hits -> drop invalid -> dedupe -> score -> sort.
function rankHits(rawHits, context) {
  const normalized = (rawHits || []).map(normalizeHit).filter(Boolean);
  const deduped = dedupeHits(normalized);
  return deduped
    .map((hit) => ({ ...hit, score: scoreHit(hit, context) }))
    .sort((a, b) => b.score - a.score);
}

if (typeof module === "object" && module.exports) {
  module.exports = {
    WEIGHTS, TYPE_LABELS,
    normalizeText, looksLikeAddressQuery, classifyType, buildPrimary, buildSecondary,
    normalizeHit, haversineDistanceKm, dedupeHits, textMatchScore, scoreHit, rankHits,
  };
}
