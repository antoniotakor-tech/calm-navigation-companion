// ---------------------------------------------------------------------------
// echovalidation.js — the single shared source of truth for every Calm
// Echoes validation rule, location-fuzzing calculation, and creator-token
// hashing routine. "Shared" in the literal sense: echorecorder.js (browser,
// pre-save validation) and the functions/api/echoes/* Cloudflare Functions
// (server, authoritative validation — a client must never be trusted to
// have applied its own rules) both import this exact file. There is
// deliberately no separate "server copy" of these constants/rules to drift
// out of sync with the client's.
//
// Pure, dependency-free, dual-environment (CommonJS for Node tests and the
// Cloudflare Functions runtime; window global for the browser) — same
// convention as navlogic.js/searchranking.js.
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EchoValidation = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MIN_DURATION_MS = 2000;
  const MAX_DURATION_MS = 20000;
  const MAX_MESSAGE_CHARS = 100;
  const MAX_NICKNAME_CHARS = 24;
  // Generous headroom over any plausible real performance (even a very fast,
  // sustained ~5 notes/sec for the full 20s is only 100 events) while still
  // bounding the size of a single request body against abuse.
  const MAX_MELODY_EVENTS = 500;
  const MAX_TINE_INDEX = 10; // kalimbaengine.js's KALIMBA_PITCHES has 11 tines, 0-10

  // "Nearby" search radius the /api/echoes/nearby endpoint accepts — bounded
  // server-side regardless of what a client requests, so a malicious/buggy
  // client can't force an unbounded full-table scan.
  const MAX_NEARBY_RADIUS_M = 2000;
  const DEFAULT_NEARBY_RADIUS_M = 500;

  const DAILY_ECHO_LIMIT = 5;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  const FUZZ_MIN_M = 10;
  const FUZZ_MAX_M = 20;
  const EARTH_RADIUS_M = 6371000; // matches navlogic.js's haversineM constant

  function toRad(d) { return (d * Math.PI) / 180; }
  function toDeg(r) { return (r * 180) / Math.PI; }

  // ---- Field-level validators -----------------------------------------------

  function isDurationValid(durationMs) {
    return typeof durationMs === "number" && durationMs >= MIN_DURATION_MS && durationMs <= MAX_DURATION_MS;
  }

  function isValidLatLon(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }

  /** Empty/whitespace-only input is valid and normalizes to null — an Echo with "no message" is a supported, intentional choice, not an error. */
  function validateMessage(text) {
    if (text == null) return { valid: true, value: null };
    const trimmed = String(text).trim();
    if (trimmed.length === 0) return { valid: true, value: null };
    if (trimmed.length > MAX_MESSAGE_CHARS) {
      return { valid: false, value: null, error: `Message must be ${MAX_MESSAGE_CHARS} characters or fewer.` };
    }
    return { valid: true, value: trimmed };
  }

  function validateNickname(text) {
    if (text == null) return { valid: true, value: null };
    const trimmed = String(text).trim();
    if (trimmed.length === 0) return { valid: true, value: null };
    if (trimmed.length > MAX_NICKNAME_CHARS) {
      return { valid: false, value: null, error: `Nickname must be ${MAX_NICKNAME_CHARS} characters or fewer.` };
    }
    return { valid: true, value: trimmed };
  }

  /**
   * Validates the melody note-event array itself — shape, bounds, and count.
   * This is what actually enforces "Kalimba performances only" server-side:
   * every event must reference a real tine and fall within the claimed
   * duration, so a crafted request can't smuggle in arbitrary data or an
   * absurdly long/large payload disguised as a melody.
   */
  function validateMelody(melody, durationMs) {
    if (!Array.isArray(melody) || melody.length === 0) {
      return { valid: false, error: "melody must be a non-empty array of note events." };
    }
    if (melody.length > MAX_MELODY_EVENTS) {
      return { valid: false, error: `melody must contain ${MAX_MELODY_EVENTS} note events or fewer.` };
    }
    for (const event of melody) {
      if (!event || typeof event !== "object") return { valid: false, error: "each melody event must be an object." };
      const { t, tine, v } = event;
      if (!Number.isFinite(t) || t < 0 || t > durationMs) {
        return { valid: false, error: "each melody event's t must be within [0, durationMs]." };
      }
      if (!Number.isInteger(tine) || tine < 0 || tine > MAX_TINE_INDEX) {
        return { valid: false, error: `each melody event's tine must be an integer 0-${MAX_TINE_INDEX}.` };
      }
      if (!Number.isFinite(v) || v < 0 || v > 1) {
        return { valid: false, error: "each melody event's v must be a number between 0 and 1." };
      }
    }
    return { valid: true };
  }

  /**
   * Full validation for a Create Echo request body. Returns a normalized,
   * trusted `value` on success — callers should store/use `value`, never the
   * raw input, so a field that merely "looked fine" at a glance (e.g.
   * un-trimmed whitespace) never leaks through.
   */
  function validateEchoCreatePayload(body) {
    if (!body || typeof body !== "object") return { valid: false, error: "Request body must be a JSON object." };

    if (!isValidLatLon(body.lat, body.lon)) {
      return { valid: false, error: "lat/lon must be valid coordinates." };
    }
    if (!isDurationValid(body.durationMs)) {
      return { valid: false, error: `durationMs must be between ${MIN_DURATION_MS} and ${MAX_DURATION_MS}.` };
    }
    const melodyCheck = validateMelody(body.melody, body.durationMs);
    if (!melodyCheck.valid) return { valid: false, error: melodyCheck.error };

    const messageCheck = validateMessage(body.message);
    if (!messageCheck.valid) return { valid: false, error: messageCheck.error };
    const nicknameCheck = validateNickname(body.nickname);
    if (!nicknameCheck.valid) return { valid: false, error: nicknameCheck.error };

    if (typeof body.creatorToken !== "string" || body.creatorToken.length < 8 || body.creatorToken.length > 200) {
      return { valid: false, error: "creatorToken must be a non-empty client-generated identifier." };
    }

    return {
      valid: true,
      value: {
        lat: body.lat,
        lon: body.lon,
        durationMs: body.durationMs,
        melody: body.melody,
        message: messageCheck.value,
        nickname: nicknameCheck.value,
        creatorToken: body.creatorToken,
      },
    };
  }

  function clampNearbyRadius(radiusM) {
    const n = Number(radiusM);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_NEARBY_RADIUS_M;
    return Math.min(n, MAX_NEARBY_RADIUS_M);
  }

  // ---- Location fuzzing -------------------------------------------------------

  /**
   * Offsets (lat, lon) by a random distance in [FUZZ_MIN_M, FUZZ_MAX_M) at a
   * random bearing. `rng` is injected (must return a value in [0,1)) so this
   * stays deterministic and testable — production code passes Math.random.
   *
   * Uses a flat-earth (equirectangular) approximation rather than a full
   * spherical destination-point formula: at a 10-20m displacement the error
   * versus true geodesic math is a matter of centimeters, far below the
   * fuzzing amount itself, so the added complexity of an exact formula would
   * buy nothing here.
   */
  function fuzzLocation(lat, lon, rng) {
    const random = rng || Math.random;
    const distanceM = FUZZ_MIN_M + random() * (FUZZ_MAX_M - FUZZ_MIN_M);
    const bearingRad = random() * 2 * Math.PI;
    const north = distanceM * Math.cos(bearingRad);
    const east = distanceM * Math.sin(bearingRad);
    const latOffsetDeg = toDeg(north / EARTH_RADIUS_M);
    const lonOffsetDeg = toDeg(east / (EARTH_RADIUS_M * Math.cos(toRad(lat))));
    return { lat: lat + latOffsetDeg, lon: lon + lonOffsetDeg };
  }

  /** A simple lat/lon bounding box for `radiusM`, used as an indexed prefilter before an exact haversine check (SQLite has no native great-circle function). Longitude degrees-per-metre widens near the poles, hence the cos(lat) term. */
  function boundingBox(lat, lon, radiusM) {
    const latDelta = toDeg(radiusM / EARTH_RADIUS_M);
    const lonDelta = toDeg(radiusM / (EARTH_RADIUS_M * Math.max(0.01, Math.cos(toRad(lat)))));
    return { minLat: lat - latDelta, maxLat: lat + latDelta, minLon: lon - lonDelta, maxLon: lon + lonDelta };
  }

  // ---- Creator-token hashing ---------------------------------------------------

  function toHex(buffer) {
    return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * SHA-256 hex digest of a client-supplied creatorToken. This is the ONLY
   * place the raw token is ever touched server-side — every caller (create,
   * rate-limit check, delete-ownership check) must hash-then-compare, never
   * store or log the raw value itself. Uses Web Crypto (available in both
   * the Cloudflare Workers runtime and modern Node), so no extra dependency.
   */
  async function hashCreatorToken(rawToken) {
    const data = new TextEncoder().encode(rawToken);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return toHex(digest);
  }

  function isRateLimited(echoCountLast24h) {
    return echoCountLast24h >= DAILY_ECHO_LIMIT;
  }

  const api = {
    MIN_DURATION_MS, MAX_DURATION_MS, MAX_MESSAGE_CHARS, MAX_NICKNAME_CHARS,
    MAX_MELODY_EVENTS, MAX_TINE_INDEX, MAX_NEARBY_RADIUS_M, DEFAULT_NEARBY_RADIUS_M,
    DAILY_ECHO_LIMIT, MS_PER_DAY, FUZZ_MIN_M, FUZZ_MAX_M,
    isDurationValid, isValidLatLon, validateMessage, validateNickname,
    validateMelody, validateEchoCreatePayload, clampNearbyRadius,
    fuzzLocation, boundingBox, hashCreatorToken, isRateLimited,
  };
  return api;
});
