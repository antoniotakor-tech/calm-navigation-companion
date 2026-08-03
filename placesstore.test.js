const test = require("node:test");
const assert = require("node:assert/strict");
const PlacesStore = require("./placesstore.js");

// Node has no localStorage — a minimal in-memory stand-in, fresh per test.
function installFakeLocalStorage() {
  const store = new Map();
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

const ROUTE_A = { startLabel: "Home", startLat: 52.37, startLon: 4.89, endLabel: "Vondelpark", endLat: 52.358, endLon: 4.868, travelMode: "walk" };
const ROUTE_B = { startLabel: "Home", startLat: 52.37, startLon: 4.89, endLabel: "Centraal", endLat: 52.379, endLon: 4.9, travelMode: "bike" };

test("sanitizeRoute: rejects out-of-range or missing coordinates", () => {
  assert.equal(PlacesStore.sanitizeRoute(null), null);
  assert.equal(PlacesStore.sanitizeRoute({ startLat: 999, startLon: 4, endLat: 52, endLon: 4 }), null);
  assert.equal(PlacesStore.sanitizeRoute({ startLat: 52, startLon: 4, endLat: 52, endLon: 4 }).startLat, 52);
});

test("sanitizePin: requires a non-empty label and valid coordinates, defaults icon to 'star'", () => {
  assert.equal(PlacesStore.sanitizePin({ lat: 52, lon: 4, label: "" }), null, "empty label rejected");
  assert.equal(PlacesStore.sanitizePin({ lat: 999, lon: 4, label: "Home" }), null, "bad coords rejected");
  const p = PlacesStore.sanitizePin({ lat: 52.37, lon: 4.89, label: "Home" });
  assert.equal(p.icon, "star");
  const home = PlacesStore.sanitizePin({ lat: 52.37, lon: 4.89, label: "Home", icon: "home" });
  assert.equal(home.icon, "home");
});

test("approxSameLatLon: true within ~40m, false further away", () => {
  assert.equal(PlacesStore.approxSameLatLon(52.37, 4.89, 52.37001, 4.89001), true);
  assert.equal(PlacesStore.approxSameLatLon(52.37, 4.89, 52.38, 4.99), false);
});

test("new PlacesStore(): empty defaults when localStorage is empty", () => {
  installFakeLocalStorage();
  const store = new PlacesStore();
  assert.deepEqual(store.getRecentRoutes(), []);
  assert.deepEqual(store.getPinned(), []);
});

test("addRoute: most-recent-first, capped at MAX_RECENT_ROUTES", () => {
  installFakeLocalStorage();
  const store = new PlacesStore();
  for (let i = 0; i < PlacesStore.MAX_RECENT_ROUTES + 3; i++) {
    store.addRoute({ startLabel: "Home", startLat: 52.37, startLon: 4.89, endLabel: `Dest ${i}`, endLat: 52.3 + i * 0.01, endLon: 4.9 + i * 0.01 });
  }
  const routes = store.getRecentRoutes();
  assert.equal(routes.length, PlacesStore.MAX_RECENT_ROUTES);
  assert.equal(routes[0].endLabel, `Dest ${PlacesStore.MAX_RECENT_ROUTES + 2}`, "newest first");
});

test("addRoute: re-searching the same start/end moves it to the top instead of duplicating", () => {
  installFakeLocalStorage();
  const store = new PlacesStore();
  store.addRoute(ROUTE_A);
  store.addRoute(ROUTE_B);
  store.addRoute(ROUTE_A);
  const routes = store.getRecentRoutes();
  assert.equal(routes.length, 2, "no duplicate entry for the repeated route");
  assert.equal(routes[0].endLabel, "Vondelpark", "the re-searched route moved to the top");
});

test("addRoute/clearRoutes: persisted across a fresh PlacesStore instance, cleared on demand", () => {
  installFakeLocalStorage();
  const store1 = new PlacesStore();
  store1.addRoute(ROUTE_A);
  const store2 = new PlacesStore();
  assert.equal(store2.getRecentRoutes().length, 1, "persisted via localStorage, not just in-memory");
  store2.clearRoutes();
  const store3 = new PlacesStore();
  assert.equal(store3.getRecentRoutes().length, 0);
});

test("addPin/removePin: add persists, remove by id works, invalid pin is a no-op", () => {
  installFakeLocalStorage();
  const store = new PlacesStore();
  store.addPin({ label: "Home", icon: "home", lat: 52.37, lon: 4.89 });
  store.addPin({ label: "  " }); // invalid — no coords, blank label
  assert.equal(store.getPinned().length, 1, "the invalid pin was silently dropped, not stored as garbage");
  const id = store.getPinned()[0].id;
  store.removePin(id);
  assert.equal(store.getPinned().length, 0);
});

test("addPin: capped at MAX_PINS", () => {
  installFakeLocalStorage();
  const store = new PlacesStore();
  for (let i = 0; i < PlacesStore.MAX_PINS + 5; i++) {
    store.addPin({ label: `Spot ${i}`, lat: 52.3 + i * 0.001, lon: 4.9 });
  }
  assert.equal(store.getPinned().length, PlacesStore.MAX_PINS);
});

test("load(): a corrupted localStorage value degrades to empty state instead of throwing", () => {
  installFakeLocalStorage();
  localStorage.setItem(PlacesStore.STORAGE_KEY, "{not valid json");
  const store = new PlacesStore();
  assert.deepEqual(store.getRecentRoutes(), []);
  assert.deepEqual(store.getPinned(), []);
});

test("load(): one corrupted route/pin record is dropped, not the whole list", () => {
  installFakeLocalStorage();
  localStorage.setItem(PlacesStore.STORAGE_KEY, JSON.stringify({
    recentRoutes: [{ startLat: 999, startLon: 4, endLat: 52, endLon: 4 }, { startLat: 52, startLon: 4, endLat: 52.1, endLon: 4.1 }],
    pinned: [{ label: "", lat: 52, lon: 4 }, { label: "Work", lat: 52.3, lon: 4.9 }],
  }));
  const store = new PlacesStore();
  assert.equal(store.getRecentRoutes().length, 1, "only the valid route survives");
  assert.equal(store.getPinned().length, 1, "only the valid pin survives");
});
