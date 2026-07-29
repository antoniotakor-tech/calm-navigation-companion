// ---------------------------------------------------------------------------
// Haptic Fidgeting pillar — platform capability detection.
// iOS Safari does not implement navigator.vibrate() at all — this is a real
// platform gap, not a bug — so every tool has a visual-only fallback that
// still "does something" satisfying without buzzing.
//
// The actual pattern playback lives in hapticmanager.js (HapticManager),
// which wraps this capability flag with intensity scaling, an explicit
// user on/off preference, and battery-aware throttling.
// ---------------------------------------------------------------------------

const HapticSupport = {
  available: typeof navigator !== "undefined" && typeof navigator.vibrate === "function",
};
