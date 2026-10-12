-- Reports for Calm Echoes (App Store guideline 1.2). Also created lazily by
-- functions/api/echoes/[id]/report.js, so applying this file is optional;
-- it exists as the documented schema and for manual setup.
-- Review open reports:  wrangler d1 execute calm-echoes --remote --command
--   "SELECT r.*, e.message FROM echo_reports r JOIN echoes e ON e.id = r.echo_id ORDER BY r.created_at DESC"
CREATE TABLE IF NOT EXISTS echo_reports (
  echo_id TEXT NOT NULL,
  reporter_hash TEXT NOT NULL,   -- sha-256 hex of the reporter's device token
  reason TEXT NOT NULL,          -- offensive | personal-info | spam | other
  created_at INTEGER NOT NULL,   -- unix ms
  PRIMARY KEY (echo_id, reporter_hash)
);
