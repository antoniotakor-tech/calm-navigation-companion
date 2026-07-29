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
