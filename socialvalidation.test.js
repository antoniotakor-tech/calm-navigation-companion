const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("./socialvalidation.js");

const base = { kind: "spot", title: "Quiet bench", body: "Shady and calm", lat: 52.37, lon: 4.9 };

test("a valid spot post passes and text is trimmed", () => {
  const r = S.validatePost({ ...base, title: "  Quiet   bench " });
  assert.equal(r.valid, true);
  assert.equal(r.value.title, "Quiet bench");
});

test("posts need a known kind, a title and a place", () => {
  assert.equal(S.validatePost({ ...base, kind: "rant" }).valid, false);
  assert.equal(S.validatePost({ ...base, title: "" }).valid, false);
  assert.equal(S.validatePost({ ...base, lat: 999 }).valid, false);
});

test("links and contact details are refused like in Calm Echoes", () => {
  assert.equal(S.validatePost({ ...base, body: "visit www.spam.com" }).valid, false);
  assert.equal(S.validateProfile({ nickname: "Ann", bio: "call 0612345678" }).valid, false);
});

test("route posts need a route and are simplified to the point limit", () => {
  assert.equal(S.validatePost({ ...base, kind: "route" }).valid, false);
  const long = Array.from({ length: 1000 }, (_, i) => [4.9 + i * 1e-5, 52.37]);
  const r = S.validatePost({ ...base, kind: "route", route: long });
  assert.equal(r.valid, true);
  assert.equal(r.value.route.length, S.LIMITS.routePoints);
  assert.deepEqual(r.value.route[0], [4.9, 52.37]);
});

test("events must be in the coming year", () => {
  const now = Date.UTC(2026, 9, 12);
  assert.equal(S.validatePost({ ...base, kind: "event" }, now).valid, false);
  assert.equal(S.validatePost({ ...base, kind: "event", eventAt: now - 86400000 }, now).valid, false);
  assert.equal(S.validatePost({ ...base, kind: "event", eventAt: now + 86400000 }, now).valid, true);
});

test("up to 4 photos are accepted, a 5th is refused", () => {
  const p = "data:image/jpeg;base64,AAAA";
  assert.equal(S.validatePost({ ...base, photos: [p, p, p, p] }).value.photos.length, 4);
  assert.equal(S.validatePost({ ...base, photos: [p, p, p, p, p] }).valid, false);
});

test("photos must be small image data URLs", () => {
  assert.equal(S.validatePost({ ...base, photo: "data:image/jpeg;base64,AAAA" }).valid, true);
  assert.equal(S.validatePost({ ...base, photo: "https://x.com/a.jpg" }).valid, false);
  assert.equal(S.validatePost({ ...base, photo: "data:image/jpeg;base64," + "A".repeat(S.LIMITS.photoChars) }).valid, false);
});

test("profiles get a safe default avatar and need a name", () => {
  assert.equal(S.validateProfile({ nickname: "A" }).valid, false);
  const r = S.validateProfile({ nickname: "Antonio", avatar: "hacker" });
  assert.equal(r.valid, true);
  assert.equal(r.value.avatar, S.AVATARS[0]);
});

test("songs: need a name, real audio and a sensible length", () => {
  const ok = { title: "Morning walk", audio: "data:audio/mp4;base64,AAAA", ms: 30000, fx: "choir" };
  assert.equal(S.validateTrack(ok).valid, true);
  assert.equal(S.validateTrack({ ...ok, title: "" }).valid, false);
  assert.equal(S.validateTrack({ ...ok, audio: "https://x.com/a.mp3" }).valid, false);
  assert.equal(S.validateTrack({ ...ok, ms: 10 * 60 * 1000 }).valid, false);
  assert.equal(S.validateTrack({ ...ok, fx: "weird" }).value.fx, "studio");
});
