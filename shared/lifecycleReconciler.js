// ---------------------------------------------------------------------------
// Lifecycle reconciler — pure decision logic for what happens when the app
// returns to the foreground after being backgrounded during navigation.
// Enforces two invariants required by the spec:
//   - never two simultaneous engines processing the same GPS updates
//   - never a duplicate voice announcement for a maneuver already spoken
//     natively while the screen was locked
// No DOM/native calls here — shared/navigationBridge.js calls this with a
// snapshot from each side and acts on the returned descriptor.
// ---------------------------------------------------------------------------

// nativeSnapshot: null if no native background session ever ran (web
//   platform, or the user never actually started background nav), otherwise
//   { active, route, stepIdx, state, distToNextManeuver, distToDestination,
//     lastEventAtMs, lastAnnouncedStepIdx }
// webSnapshot: { hasLocalWatcher, stepIdx, state } — what the in-page
//   navlogic.js engine currently believes, which may be stale if native was
//   the one actually driving navigation while backgrounded.
function reconcileForegroundState({ nativeSnapshot, webSnapshot }) {
  const web = webSnapshot || { hasLocalWatcher: false, stepIdx: 0, state: null };

  if (!nativeSnapshot || !nativeSnapshot.active) {
    // No native session took over — the existing web engine (if any) is the
    // single source of truth already; nothing to reconcile.
    return {
      source: "web",
      stopWebWatcher: false,
      restoreRoute: null,
      restoreStepIdx: null,
      restoreState: null,
      suppressAnnouncementForStepIdx: null,
    };
  }

  // Native was the active engine. It must become the single source of truth
  // on resume — any web watcher still running (there shouldn't be one, since
  // navigationBridge stops it before handing off, but this is the one place
  // that invariant is actually enforced, not just assumed) gets told to stop.
  return {
    source: "native",
    stopWebWatcher: web.hasLocalWatcher,
    restoreRoute: nativeSnapshot.route,
    restoreStepIdx: nativeSnapshot.stepIdx,
    restoreState: nativeSnapshot.state,
    restoreDistToNextManeuver: nativeSnapshot.distToNextManeuver,
    restoreDistToDestination: nativeSnapshot.distToDestination,
    // The native engine already spoke this step while backgrounded (or it's
    // the step the user was already on when they locked the phone) — don't
    // re-announce it just because the step index matches on resume.
    suppressAnnouncementForStepIdx: nativeSnapshot.lastAnnouncedStepIdx,
  };
}

if (typeof module === "object" && module.exports) {
  module.exports = { reconcileForegroundState };
}
