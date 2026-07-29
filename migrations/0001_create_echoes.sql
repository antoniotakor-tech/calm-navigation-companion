-- Calm Echoes — initial schema.
--
-- Deliberately minimal, per the feature's own privacy stance: "nothing more"
-- is stored than melody, approximate location, creation time, optional
-- message, and an anonymous/nickname label. There is no users table because
-- there are no accounts — `creator_token_hash` is a per-device pseudonymous
-- identifier (a random UUID generated client-side, hashed before it ever
-- reaches this database), used only for the 5-per-day rate limit and to let
-- someone delete their own Echo. It cannot be reversed to recover the
-- original device token, and it is never returned by any read endpoint.
--
-- Only the already-fuzzed display location is stored — the exact
-- coordinates a client submits are used once, server-side, to compute a
-- randomized offset (10-20m) and are never written to disk. See
-- CALM_ECHOES.md's privacy analysis.

CREATE TABLE IF NOT EXISTS echoes (
  id TEXT PRIMARY KEY,                 -- uuid, generated server-side
  lat REAL NOT NULL,                   -- fuzzed display latitude
  lon REAL NOT NULL,                   -- fuzzed display longitude
  created_at INTEGER NOT NULL,         -- unix ms
  message TEXT,                        -- <=100 chars, nullable
  nickname TEXT,                       -- <=24 chars, nullable ("Anonymous" applied client-side)
  melody_json TEXT NOT NULL,           -- compact note-event array: [{t,tine,v}, ...]
  duration_ms INTEGER NOT NULL,        -- 2000-20000, redundant with melody_json but indexable/cheap to validate
  creator_token_hash TEXT NOT NULL,    -- sha-256 hex of the client's device token
  moderation_status TEXT NOT NULL DEFAULT 'visible', -- visible | hidden
  play_count INTEGER NOT NULL DEFAULT 0 -- internal only; never exposed by any API response
);

-- Nearby-lookup is a bounding-box prefilter (indexed) followed by an exact
-- haversine filter in the Function itself — SQLite has no native great-
-- circle distance function, and a bounding box on indexed lat/lon columns is
-- the standard, cheap way to avoid a full table scan before that exact check.
CREATE INDEX IF NOT EXISTS idx_echoes_lat ON echoes (lat);
CREATE INDEX IF NOT EXISTS idx_echoes_lon ON echoes (lon);

-- Rate-limit and ownership checks both filter on this pair.
CREATE INDEX IF NOT EXISTS idx_echoes_creator_time ON echoes (creator_token_hash, created_at);

-- "Someone discovered your Calm Echo" — the only notification this feature
-- sends. One row per discovery-by-someone-else (never for the creator
-- replaying their own Echo). Polled by the creator's own client; not a push
-- notification system.
CREATE TABLE IF NOT EXISTS echo_notifications (
  id TEXT PRIMARY KEY,
  echo_id TEXT NOT NULL REFERENCES echoes(id) ON DELETE CASCADE,
  creator_token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notifications_creator ON echo_notifications (creator_token_hash, seen);
