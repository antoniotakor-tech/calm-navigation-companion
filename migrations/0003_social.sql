-- Community profiles + timeline (2026-10-12). Created lazily by
-- functions/api/social/_db.js; kept here as documentation / for manual setup.
CREATE TABLE IF NOT EXISTS profiles (owner_hash TEXT PRIMARY KEY, author_key TEXT NOT NULL UNIQUE, nickname TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, author_key TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', lat REAL NOT NULL, lon REAL NOT NULL, route_json TEXT, event_at INTEGER, photo TEXT, created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'visible');
CREATE INDEX IF NOT EXISTS posts_geo ON posts (lat, lon);
CREATE INDEX IF NOT EXISTS posts_author ON posts (author_key, created_at);
CREATE TABLE IF NOT EXISTS post_reports (post_id TEXT NOT NULL, reporter_hash TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (post_id, reporter_hash));
