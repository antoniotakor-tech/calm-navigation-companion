const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("./calmrec.js");

const here = { lat: 52.3676, lon: 4.9041 };
const near = (dLat, extra) => ({ lat: here.lat + dLat, lon: here.lon, ...extra });
const ctx = (over) => ({ here, hour: 14, prefs: R.emptyPrefs(), calmSpotKeys: new Set(), ...over });

test("a library or park ranks above a café, which ranks above a bar, at equal distance", () => {
  const places = [
    near(0.002, { name: "Bar X", kind: "food", type: "bar" }),
    near(0.002, { name: "Cafe Y", kind: "food", type: "cafe" }),
    near(0.002, { name: "Library Z", kind: "calm", type: "library" }),
  ];
  const order = R.recommend(places, ctx()).map((r) => r.place.name);
  assert.deepEqual(order, ["Library Z", "Cafe Y", "Bar X"]);
});

test("nightclubs are never recommended at night; bars drop in the evening", () => {
  const club = near(0.001, { name: "Club", kind: "food", type: "nightclub" });
  assert.equal(R.scorePlace(club, ctx({ hour: 23 })), null);
  const bar = near(0.001, { name: "Bar", kind: "food", type: "bar" });
  assert.ok(R.scorePlace(bar, ctx({ hour: 23 })).score < R.scorePlace(bar, ctx({ hour: 15 })).score);
});

test("transit stops and far-away places are excluded", () => {
  assert.equal(R.scorePlace(near(0.001, { name: "Stop", kind: "transit" }), ctx()), null);
  assert.equal(R.scorePlace(near(0.05, { name: "Far cafe", kind: "food", type: "cafe" }), ctx()), null);
});

test("rating a place 'too busy' removes it; 'calm' lifts it and explains why", () => {
  const cafe = near(0.002, { name: "Cafe Y", kind: "food", type: "cafe" });
  const busy = R.learn(R.emptyPrefs(), cafe, "busy");
  assert.equal(R.scorePlace(cafe, ctx({ prefs: busy })), null);
  const calm = R.learn(R.emptyPrefs(), cafe, "calm");
  const r = R.scorePlace(cafe, ctx({ prefs: calm }));
  assert.ok(r.score > R.scorePlace(cafe, ctx()).score);
  assert.equal(r.reason, "You found it calm");
});

test("liking several cafés lifts OTHER cafés too (learning by type)", () => {
  let prefs = R.emptyPrefs();
  for (let i = 0; i < 3; i++) prefs = R.learn(prefs, near(0.003 + i * 0.001, { name: `Cafe ${i}`, kind: "food", type: "cafe" }), "calm");
  const other = near(0.002, { name: "New cafe", kind: "food", type: "cafe" });
  const r = R.scorePlace(other, ctx({ prefs }));
  assert.ok(r.score > R.scorePlace(other, ctx()).score);
  assert.equal(r.reason, "You like cafés");
});

test("re-rating the same place replaces the old rating instead of double-counting", () => {
  const cafe = near(0.002, { name: "Cafe Y", kind: "food", type: "cafe" });
  let prefs = R.learn(R.emptyPrefs(), cafe, "calm");
  prefs = R.learn(prefs, cafe, "busy");
  assert.deepEqual(prefs.types.cafe, { sum: -1, n: 1 });
});

test("curated calm spots get a boost and a reason; corrupted prefs are reset safely", () => {
  const spot = near(0.002, { name: "Hidden garden", kind: "food", type: "cafe" });
  const r = R.scorePlace(spot, ctx({ calmSpotKeys: new Set([R.placeKey(spot)]) }));
  assert.equal(r.reason, "Curated calm spot");
  assert.deepEqual(R.sanitizePrefs({ junk: true }), R.emptyPrefs());
});
