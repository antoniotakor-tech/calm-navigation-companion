// ---------------------------------------------------------------------------
// Community (profiles + timeline) rules, 2026-10-12. Shared by the browser
// (app.js) and the /api/social/* Functions, exactly like echovalidation.js:
// the server re-runs every check and never trusts the client.
//
// Identity: no passwords. The device's private Calm Echoes creatorToken is
// the key; the server only ever stores its SHA-256 hash, and the public
// profile id is EchoValidation.deriveAuthorKey(hash) — so blocking someone's
// Echoes and blocking their posts are the same thing.
//
// Moderation is the Echoes model (App Store guideline 1.2): text filter
// before publishing, one report hides a post for everyone, block per person,
// daily posting limits, and deleting the account deletes everything.
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./echovalidation.js"));
  else root.SocialValidation = factory(root.EchoValidation);
})(typeof self !== "undefined" ? self : this, function (EchoValidation) {
  "use strict";

  const POST_KINDS = ["spot", "route", "event"];
  const AVATARS = ["rose", "lilac", "mint", "sun", "sky", "peach"];
  const LIMITS = {
    nickname: 24, bio: 140, title: 60, body: 400,
    routePoints: 300, photoChars: 450000, postsPerDay: 10,
    eventMaxAheadMs: 366 * 24 * 3600 * 1000,
  };

  function cleanText(v) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : ""; }

  function textProblem(text, label) {
    const p = EchoValidation.contentProblem(text);
    return p ? `${label}: ${p}` : null;
  }

  function validateProfile(body) {
    if (!body || typeof body !== "object") return { valid: false, error: "Invalid profile." };
    const nickname = cleanText(body.nickname);
    const bio = cleanText(body.bio);
    const avatar = AVATARS.includes(body.avatar) ? body.avatar : AVATARS[0];
    if (nickname.length < 2) return { valid: false, error: "Pick a name of at least 2 characters." };
    if (nickname.length > LIMITS.nickname) return { valid: false, error: `Name can be at most ${LIMITS.nickname} characters.` };
    if (bio.length > LIMITS.bio) return { valid: false, error: `Bio can be at most ${LIMITS.bio} characters.` };
    const problem = textProblem(nickname, "Name") || (bio && textProblem(bio, "Bio"));
    if (problem) return { valid: false, error: problem };
    return { valid: true, value: { nickname, bio, avatar } };
  }

  /** Keeps a route light: at most LIMITS.routePoints [lon,lat] pairs, evenly sampled, ends kept. */
  function simplifyRoute(coords) {
    if (!Array.isArray(coords)) return null;
    const pts = coords.filter((c) => Array.isArray(c) && c.length >= 2 && EchoValidation.isValidLatLon(Number(c[1]), Number(c[0])))
      .map((c) => [Math.round(Number(c[0]) * 1e5) / 1e5, Math.round(Number(c[1]) * 1e5) / 1e5]);
    if (pts.length < 2) return null;
    if (pts.length <= LIMITS.routePoints) return pts;
    const out = [];
    const step = (pts.length - 1) / (LIMITS.routePoints - 1);
    for (let i = 0; i < LIMITS.routePoints; i++) out.push(pts[Math.round(i * step)]);
    return out;
  }

  function isPhotoDataUrl(v) {
    return typeof v === "string" && /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= LIMITS.photoChars;
  }

  function validatePost(body, now) {
    if (!body || typeof body !== "object") return { valid: false, error: "Invalid post." };
    now = now || Date.now();
    const kind = body.kind;
    if (!POST_KINDS.includes(kind)) return { valid: false, error: "Choose spot, route or event." };
    const title = cleanText(body.title);
    const text = cleanText(body.body);
    if (title.length < 2) return { valid: false, error: "Give it a short title." };
    if (title.length > LIMITS.title) return { valid: false, error: `Title can be at most ${LIMITS.title} characters.` };
    if (text.length > LIMITS.body) return { valid: false, error: `Text can be at most ${LIMITS.body} characters.` };
    const problem = textProblem(title, "Title") || (text && textProblem(text, "Text"));
    if (problem) return { valid: false, error: problem };
    const lat = Number(body.lat), lon = Number(body.lon);
    if (!EchoValidation.isValidLatLon(lat, lon)) return { valid: false, error: "This post needs a place on the map." };
    let route = null;
    if (kind === "route") {
      route = simplifyRoute(body.route);
      if (!route) return { valid: false, error: "Plan or walk a route first, then share it." };
    }
    let eventAt = null;
    if (kind === "event") {
      eventAt = Number(body.eventAt);
      if (!Number.isFinite(eventAt) || eventAt < now - 3600 * 1000 || eventAt > now + LIMITS.eventMaxAheadMs) {
        return { valid: false, error: "Pick when the event happens (from now up to a year ahead)." };
      }
    }
    let photo = null;
    if (body.photo != null && body.photo !== "") {
      if (!isPhotoDataUrl(body.photo)) return { valid: false, error: "That photo is too large or not an image." };
      photo = body.photo;
    }
    return { valid: true, value: { kind, title, body: text, lat, lon, route, eventAt, photo } };
  }

  return { POST_KINDS, AVATARS, LIMITS, validateProfile, validatePost, simplifyRoute, isPhotoDataUrl, cleanText };
});
