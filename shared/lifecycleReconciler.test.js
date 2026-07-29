const test = require("node:test");
const assert = require("node:assert/strict");
const { reconcileForegroundState } = require("./lifecycleReconciler.js");

test("no native session ever ran: web stays the source of truth, nothing is restored", () => {
  const result = reconcileForegroundState({ nativeSnapshot: null, webSnapshot: { hasLocalWatcher: true, stepIdx: 2, state: "navigating" } });
  assert.equal(result.source, "web");
  assert.equal(result.stopWebWatcher, false);
  assert.equal(result.restoreRoute, null);
});

test("native snapshot exists but isn't active: also treated as 'web is truth', not restored", () => {
  const result = reconcileForegroundState({ nativeSnapshot: { active: false }, webSnapshot: { hasLocalWatcher: false } });
  assert.equal(result.source, "web");
});

test("native was active: becomes the source of truth, and any running web watcher is told to stop", () => {
  const nativeSnapshot = {
    active: true, route: { id: "r1" }, stepIdx: 3, state: "navigating",
    distToNextManeuver: 120, distToDestination: 900, lastAnnouncedStepIdx: 3,
  };
  const result = reconcileForegroundState({ nativeSnapshot, webSnapshot: { hasLocalWatcher: true, stepIdx: 0, state: null } });
  assert.equal(result.source, "native");
  assert.equal(result.stopWebWatcher, true, "the invariant: never two simultaneous engines processing the same GPS updates");
  assert.equal(result.restoreRoute, nativeSnapshot.route);
  assert.equal(result.restoreStepIdx, 3);
});

test("native was active but no web watcher was running: stopWebWatcher is false (nothing to stop)", () => {
  const nativeSnapshot = { active: true, route: {}, stepIdx: 1, state: "navigating", lastAnnouncedStepIdx: 1 };
  const result = reconcileForegroundState({ nativeSnapshot, webSnapshot: { hasLocalWatcher: false } });
  assert.equal(result.stopWebWatcher, false);
});

test("suppressAnnouncementForStepIdx carries the native side's last-announced step, preventing a duplicate voice line on resume", () => {
  const nativeSnapshot = { active: true, route: {}, stepIdx: 5, state: "navigating", lastAnnouncedStepIdx: 5 };
  const result = reconcileForegroundState({ nativeSnapshot, webSnapshot: {} });
  assert.equal(result.suppressAnnouncementForStepIdx, 5);
});

test("missing webSnapshot entirely defaults safely instead of throwing", () => {
  const result = reconcileForegroundState({ nativeSnapshot: null });
  assert.equal(result.source, "web");
  assert.equal(result.stopWebWatcher, false);
});
