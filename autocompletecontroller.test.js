const test = require("node:test");
const assert = require("node:assert/strict");
const {
  debounce, createSequencer, shouldTriggerSearch, computeNextActiveIndex,
  stillMatchesSelection, labelForItem,
} = require("./autocompletecontroller.js");

test("debounce: only the last call within the window actually fires", (t, done) => {
  const calls = [];
  const fn = debounce((v) => calls.push(v), 20);
  fn("a"); fn("b"); fn("c");
  setTimeout(() => {
    assert.deepEqual(calls, ["c"]);
    done();
  }, 40);
});

test("debounce: cancel() prevents a pending call from ever firing", (t, done) => {
  const calls = [];
  const fn = debounce((v) => calls.push(v), 20);
  fn("a");
  fn.cancel();
  setTimeout(() => {
    assert.deepEqual(calls, []);
    done();
  }, 40);
});

test("createSequencer: only the most recently issued token is considered current", () => {
  const seq = createSequencer();
  const t1 = seq.next();
  const t2 = seq.next();
  assert.equal(seq.isCurrent(t1), false, "an older token must be superseded by a newer one");
  assert.equal(seq.isCurrent(t2), true);
});

test("shouldTriggerSearch: respects the minimum character count and trims whitespace", () => {
  assert.equal(shouldTriggerSearch("a", 2), false);
  assert.equal(shouldTriggerSearch("ab", 2), true);
  assert.equal(shouldTriggerSearch("  a  ", 2), false, "whitespace should not count toward the minimum");
  assert.equal(shouldTriggerSearch(null, 2), false);
});

test("computeNextActiveIndex: ArrowDown/ArrowUp wrap in both directions", () => {
  assert.equal(computeNextActiveIndex(-1, "ArrowDown", 3), 0);
  assert.equal(computeNextActiveIndex(2, "ArrowDown", 3), 0, "should wrap from the last item back to the first");
  assert.equal(computeNextActiveIndex(-1, "ArrowUp", 3), 2, "should start from the last item going up with nothing highlighted");
  assert.equal(computeNextActiveIndex(0, "ArrowUp", 3), 2, "should wrap from the first item back to the last");
});

test("computeNextActiveIndex: an empty list always returns -1, regardless of key", () => {
  assert.equal(computeNextActiveIndex(0, "ArrowDown", 0), -1);
});

test("computeNextActiveIndex: an unrecognized key leaves the index unchanged", () => {
  assert.equal(computeNextActiveIndex(1, "Enter", 5), 1);
});

test("stillMatchesSelection: true only when the input text exactly equals a real (non-null) prior selection", () => {
  assert.equal(stillMatchesSelection("Vondelpark", "Vondelpark"), true);
  assert.equal(stillMatchesSelection("Vondelpar", "Vondelpark"), false, "retyping after a selection should break the match");
  assert.equal(stillMatchesSelection("Vondelpark", null), false);
});

test("labelForItem: joins primary+secondary when secondary exists, otherwise just primary", () => {
  assert.equal(labelForItem({ primary: "Vondelpark", secondary: "Amsterdam" }), "Vondelpark, Amsterdam");
  assert.equal(labelForItem({ primary: "Vondelpark", secondary: "" }), "Vondelpark");
});

// ---- 2026-11-24: "mangia" in Amsterdam also searches "mangia Amsterdam" ----
const ACC = require("./autocompletecontroller.js").AutocompleteController;
const h = (name, city, lat, lng, extra) => Object.assign({ name, city, osm_key: "amenity", osm_value: "restaurant", point: { lat, lng } }, extra);

function fakeController(responses) {
  const asked = [];
  const self = {
    limit: 6,
    endpointBase: "",
    geocodingService: {
      forwardGeocode: async ({ query, limit }) => {
        asked.push({ query, limit });
        if (responses[query] instanceof Error) throw responses[query];
        return { hits: responses[query] || [] };
      },
    },
  };
  return { self, asked, run: (q, ctx) => ACC.prototype.fetchHits.call(self, q, ctx, undefined) };
}
const ctxAms = { point: { lat: 52.3676, lon: 4.9041 }, city: "Amsterdam" };

test("fetchHits: adds 'query + city' results that are close and contain every typed word", async () => {
  const { run, asked } = fakeController({
    mangia: [h("Mangia", "Austin", 30.4, -97.7)],
    "mangia Amsterdam": [
      h("Mangia Pizza Centrum", "Amsterdam", 52.361, 4.892),
      h("Mangia Pizza", "Amsterdam", 52.354, 4.856),
      h("Mangia", "Rotterdam far away", 40.0, -70.0),   // too far
      h("Amsterdam Street", "Bloemfontein", -29.1, 26.2), // far and no "mangia"
    ],
  });
  const { hits } = await run("mangia", ctxAms);
  assert.deepEqual(asked.map((a) => a.query).sort(), ["mangia", "mangia Amsterdam"]);
  assert.ok(asked.find((a) => a.query === "mangia").limit >= 10, "asks for a wider pool than it shows");
  assert.deepEqual(hits.map((x) => x.name), ["Mangia", "Mangia Pizza Centrum", "Mangia Pizza"]);
});

test("fetchHits: drops nearby hits that do not contain the typed words ('rome' must not bring Roemer Visscherstraat)", async () => {
  const { run } = fakeController({
    rome: [h("Rome", null, 41.9, 12.5, { osm_key: "place", osm_value: "city" })],
    "rome Amsterdam": [h("Roemer Visscherstraat", "Amsterdam", 52.36, 4.88, { osm_key: "highway", osm_value: "residential" })],
  });
  const { hits } = await run("rome", ctxAms);
  assert.deepEqual(hits.map((x) => x.name), ["Rome"]);
});

test("fetchHits: no second lookup without a city, for short text, addresses or when the city is already typed", async () => {
  for (const [q, ctx] of [["mangia", { point: ctxAms.point }], ["ma", ctxAms], ["damstraat 12", ctxAms], ["mangia, Amsterdam", ctxAms], ["pizza amsterdam", ctxAms]]) {
    const { run, asked } = fakeController({});
    await run(q, ctx);
    assert.equal(asked.length, 1, `only the plain lookup for "${q}"`);
  }
});

test("fetchHits: if the extra lookup fails, the normal results still come back", async () => {
  const { run } = fakeController({ mangia: [h("Mangia", "Austin", 30.4, -97.7)], "mangia Amsterdam": new Error("boom") });
  const { hits } = await run("mangia", ctxAms);
  assert.deepEqual(hits.map((x) => x.name), ["Mangia"]);
});
