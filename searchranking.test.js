const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("./searchranking.js");

function hit(overrides) {
  return Object.assign({
    name: "Vondelpark", osm_key: "leisure", osm_value: "park",
    point: { lat: 52.3579, lng: 4.8686 }, city: "Amsterdam", country: "Netherlands", countrycode: "nl",
  }, overrides);
}

test("normalizeHit: returns null for a hit with no usable coordinates or label", () => {
  assert.equal(S.normalizeHit(null), null);
  assert.equal(S.normalizeHit({ point: { lat: NaN, lng: 4 } }), null);
  assert.equal(S.normalizeHit({ point: { lat: 52, lng: 4 } }), null, "no name/street at all");
});

test("normalizeHit: classifies a park correctly and builds a sensible primary/secondary", () => {
  const n = S.normalizeHit(hit());
  assert.equal(n.type, "park");
  assert.equal(n.primary, "Vondelpark");
  assert.equal(n.city, "Amsterdam");
});

test("classifyType: an address (has housenumber) beats every other classification", () => {
  const n = S.normalizeHit(hit({ housenumber: "12", street: "Damstraat", osm_key: "highway", osm_value: "residential" }));
  assert.equal(n.type, "address");
  assert.equal(n.primary, "Damstraat 12");
});

test("classifyType: recognizes stations, streets, and landmarks", () => {
  assert.equal(S.classifyType({ osm_key: "railway", osm_value: "station" }), "station");
  assert.equal(S.classifyType({ osm_key: "highway", osm_value: "residential" }), "street");
  assert.equal(S.classifyType({ osm_key: "tourism", osm_value: "museum" }), "landmark");
  assert.equal(S.classifyType({ osm_key: "shop", osm_value: "bakery" }), "place");
});

test("dedupeHits: collapses the same label+type within ~40m, keeps the first occurrence", () => {
  const a = S.normalizeHit(hit());
  const bNear = S.normalizeHit(hit({ point: { lat: 52.35792, lng: 4.86862 } })); // a couple meters away
  const result = S.dedupeHits([a, bNear]);
  assert.equal(result.length, 1);
  assert.equal(result[0], a);
});

test("dedupeHits: does NOT merge the same label+type far apart, or different types at the same spot", () => {
  const a = S.normalizeHit(hit());
  const farAway = S.normalizeHit(hit({ point: { lat: 52.40, lng: 4.90 } }));
  assert.equal(S.dedupeHits([a, farAway]).length, 2);

  const differentType = S.normalizeHit(hit({ osm_key: "highway", osm_value: "residential", street: "Vondelpark" }));
  assert.equal(S.dedupeHits([a, differentType]).length, 2);
});

test("textMatchScore: exact > prefix > contains > secondary-only > no match, strictly ordered", () => {
  const h = S.normalizeHit(hit());
  const exact = S.textMatchScore("vondelpark", h);
  const prefix = S.textMatchScore("vondel", h);
  const contains = S.textMatchScore("delpark", h); // TODO: primary contains, not prefix
  const none = S.textMatchScore("nonexistent", h);
  assert.equal(exact, S.WEIGHTS.EXACT_TEXT_MATCH);
  assert.equal(prefix, S.WEIGHTS.PREFIX_TEXT_MATCH);
  assert.ok(exact > prefix);
  assert.ok(prefix > contains);
  assert.equal(none, 0);
});

test("scoreHit: a strong text match near the user always beats a bare city match with a weak/no text match", () => {
  const strongMatch = S.normalizeHit(hit({ name: "Dam Square" }));
  const weakCityMatch = S.normalizeHit(hit({ name: "Unrelated Place", city: "Amsterdam" }));
  const ctx = { queryText: "Dam Square", userCity: "Amsterdam", userPoint: { lat: 52.3676, lon: 4.9041 } };
  const strongScore = S.scoreHit(strongMatch, ctx);
  const weakScore = S.scoreHit(weakCityMatch, { ...ctx, queryText: "Dam Square" });
  assert.ok(strongScore > weakScore, "an exact/strong text match must dominate over a mere city-match bonus");
});

test("scoreHit: closer results score higher than farther ones, all else equal", () => {
  const near = S.normalizeHit(hit({ point: { lat: 52.368, lng: 4.905 } }));
  const far = S.normalizeHit(hit({ point: { lat: 52.5, lng: 5.2 } }));
  const ctx = { queryText: "vondelpark", userPoint: { lat: 52.3676, lon: 4.9041 } };
  assert.ok(S.scoreHit(near, ctx) > S.scoreHit(far, ctx));
});

test("scoreHit: an address-looking query prefers address results; a place-looking query prefers non-address results", () => {
  const address = S.normalizeHit(hit({ housenumber: "1", street: "Damstraat", osm_key: "highway", osm_value: "residential", name: undefined }));
  const place = S.normalizeHit(hit({ name: "Damstraat area" }));
  const addressQueryCtx = { queryText: "damstraat 1" };
  const placeQueryCtx = { queryText: "damstraat" };
  assert.ok(S.scoreHit(address, addressQueryCtx) - S.textMatchScore("damstraat 1", address) === S.WEIGHTS.ADDRESS_TYPE_BOOST + S.WEIGHTS.HOUSENUMBER_EXACT);
  assert.ok(S.scoreHit(place, placeQueryCtx) - S.textMatchScore("damstraat", place) === S.WEIGHTS.PLACE_TYPE_BOOST);
});

test("rankHits: full pipeline — normalizes, dedupes, scores, and sorts descending", () => {
  const rawHits = [
    hit({ name: "Vondelpark", point: { lat: 52.3579, lng: 4.8686 } }),
    hit({ name: "Something Else", point: { lat: 52.9, lng: 5.9 } }),
  ];
  const ranked = S.rankHits(rawHits, { queryText: "vondelpark", userPoint: { lat: 52.36, lon: 4.87 } });
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].primary, "Vondelpark");
  assert.ok(ranked[0].score >= ranked[1].score);
});

test("rankHits: silently drops invalid raw hits instead of throwing", () => {
  const ranked = S.rankHits([null, {}, hit()], { queryText: "vondelpark" });
  assert.equal(ranked.length, 1);
});

test("scoreHit: same street name — the one within 15 km beats an identical one in another city (Amsterdam case)", () => {
  const amsterdamUser = { lat: 52.3676, lon: 4.9041 };
  const near = { primary: "Vondelstraat", secondary: "Amsterdam", type: "street", city: "Amsterdam", countrycode: "NL", lat: 52.3615, lon: 4.8728 };
  const far = { primary: "Vondelstraat", secondary: "Utrecht", type: "street", city: "Utrecht", countrycode: "NL", lat: 52.0907, lon: 5.1214 };
  const ctx = { queryText: "Vondelstraat", userPoint: amsterdamUser, userCountryCode: "NL" };
  assert.ok(S.scoreHit(near, ctx) > S.scoreHit(far, ctx) + 50);
});

test("scoreHit: the nearby boost never lets a weaker text match beat a stronger one", () => {
  const user = { lat: 52.3676, lon: 4.9041 };
  const nearWeak = { primary: "Grote Vondelstraat", secondary: "Amsterdam", type: "street", city: "Amsterdam", lat: 52.3676, lon: 4.9041 };
  const farExact = { primary: "Vondel", secondary: "Elsewhere", type: "street", city: "Elsewhere", lat: 40, lon: 0 };
  const ctx = { queryText: "Vondel", userPoint: user, userCity: "Amsterdam" };
  assert.ok(S.scoreHit(farExact, ctx) > S.scoreHit(nearWeak, ctx));
});

test("address queries: street / number / city are understood", () => {
  const { parseAddressQuery, numberMatches } = require("./searchranking.js");
  assert.deepEqual(parseAddressQuery("Via Toledo 256, Napoli"), { street: "via toledo", number: "256", city: "napoli" });
  assert.equal(parseAddressQuery("Damrak 1").number, "1");
  assert.equal(numberMatches("3", "1-5"), true);
  assert.equal(numberMatches("12a", "12A"), true);
  assert.equal(numberMatches("1", "46-1"), false);
});

test("the exact house number beats the canal with the same name", () => {
  const { rankHits } = require("./searchranking.js");
  const hits = [
    { name: "Damrak", city: "Amsterdam", osm_key: "waterway", osm_value: "canal", point: { lat: 52.3765, lng: 4.8970 } },
    { name: "Damrak", street: "Damrak", housenumber: "46-1", city: "Amsterdam", osm_key: "place", osm_value: "house", point: { lat: 52.3740, lng: 4.8960 } },
    { name: "Damrak", street: "Damrak", housenumber: "1", city: "Amsterdam", osm_key: "place", osm_value: "house", point: { lat: 52.3770, lng: 4.8980 } },
  ];
  const top = rankHits(hits, { queryText: "Damrak 1, Amsterdam" })[0];
  assert.equal(top.housenumber, "1");
});

test("the city you typed wins over the same street elsewhere", () => {
  const { rankHits } = require("./searchranking.js");
  const hits = [
    { name: "Kerkstraat", street: "Kerkstraat", housenumber: "12", city: "Wehe-den Hoorn", osm_key: "place", osm_value: "house", point: { lat: 53.36, lng: 6.39 } },
    { name: "Lange Kerkstraat", street: "Lange Kerkstraat", housenumber: "12", city: "Hoorn", osm_key: "place", osm_value: "house", point: { lat: 52.64, lng: 5.06 } },
  ];
  assert.equal(rankHits(hits, { queryText: "Kerkstraat 12, Hoorn" })[0].city, "Hoorn");
});
