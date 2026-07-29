// ---------------------------------------------------------------------------
// Reroute backoff — prevents a reroute loop (repeatedly hammering the
// Cloudflare /api/route proxy while genuinely off-route with no connection,
// or while the new route still doesn't match where the user actually is).
// Pure state machine, no timers/network of its own — the caller (web
// engine or native plugin) calls nextDelayMs()/recordAttempt() and does its
// own waiting/fetching.
// ---------------------------------------------------------------------------

function createRerouteBackoff(options) {
  const opts = options || {};
  const baseDelayMs = opts.baseDelayMs || 3000;
  const maxDelayMs = opts.maxDelayMs || 60000;
  const maxAttempts = opts.maxAttempts || 5;

  let attempts = 0;

  return {
    get attempts() { return attempts; },
    get maxAttempts() { return maxAttempts; },
    // Whether another reroute attempt is allowed at all.
    shouldAttempt() { return attempts < maxAttempts; },
    // Exponential backoff, capped — attempt 0 -> baseDelayMs, doubling each
    // time, never exceeding maxDelayMs.
    nextDelayMs() { return Math.min(baseDelayMs * Math.pow(2, attempts), maxDelayMs); },
    recordAttempt() { attempts += 1; },
    // A route request that actually succeeded (regardless of whether the
    // user then immediately went off it again) resets the counter — repeated
    // failures are what this guards against, not repeated legitimate reroutes.
    recordSuccess() { attempts = 0; },
    isExhausted() { return attempts >= maxAttempts; },
    reset() { attempts = 0; },
  };
}

if (typeof module === "object" && module.exports) {
  module.exports = { createRerouteBackoff };
}
