// ---------------------------------------------------------------------------
// placeinfo.js (2026-10-12) — "what does this place look like, what is it?"
// for the calm flowers. Finds the place's Wikipedia article (photo + short
// description) by looking for articles near the place and matching names;
// otherwise a real nearby photo from Wikimedia Commons; otherwise a plain
// description of the kind of place. Only the place's position is sent —
// never the user's. Matching logic is pure and tested (placeinfo.test.js).
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PlaceInfo = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TYPE_TEXT = {
    library: ["Public library", "Usually quiet — good for reading, resting or working."],
    books: ["Bookshop", "A calm place to browse; few people, soft sounds."],
    garden: ["Garden", "Green and sheltered — a good place to slow down."],
    park: ["Park", "Open space and trees; quieter away from the paths."],
    place_of_worship: ["Church or place of worship", "Usually very quiet inside. Please be respectful during services."],
    christian: ["Church", "Usually very quiet inside. Please be respectful during services."],
    museum: ["Museum", "Calm rooms and slow pace; quieter on weekday mornings."],
    cafe: ["Café", "Can be calm outside busy hours; pick a corner seat."],
    tea: ["Tea room", "Often quiet, with soft music and few people."],
    bar: ["Bar", "Calmer early in the evening."],
    pub: ["Pub", "Calmer early in the evening."],
    restaurant: ["Restaurant", "Quieter outside lunch and dinner peaks."],
  };
  function typeText(type) { return TYPE_TEXT[type] || ["Calm place", "Picked because places like this are usually quiet."]; }

  const STOP = new Set(["the", "of", "di", "de", "del", "della", "la", "le", "il", "lo", "der", "die", "das", "het", "van", "and", "e", "et", "und", "church", "chiesa", "kerk", "kirche", "eglise", "iglesia", "san", "santa", "santo", "st", "saint", "museum", "museo"]);
  function tokens(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/\(.*?\)/g, " ").split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t));
  }
  /** 0..1 how well an article title matches a place name (shared distinctive words). */
  function nameScore(placeName, title) {
    const a = new Set(tokens(placeName)), b = new Set(tokens(String(title).split(",")[0]));
    if (!a.size || !b.size) return 0;
    let shared = 0;
    a.forEach((t) => { if (b.has(t)) shared++; });
    return shared / Math.min(a.size, b.size);
  }
  function distM(a, b) {
    const R = 6371000, r = (x) => (x * Math.PI) / 180;
    const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  /**
   * Picks the article that is this place: a strong name match within 300 m,
   * or (no name match) the single article sitting right on the spot (< 35 m).
   * pages: [{ title, lat, lon, ... }]
   */
  function bestArticle(place, pages) {
    let best = null, bestScore = 0;
    (pages || []).forEach((p) => {
      if (p.lat == null) return;
      const d = distM(place, p);
      const s = nameScore(place.name, p.title);
      const score = s >= 0.5 && d < 300 ? s + (1 - d / 300) * 0.2 : (d < 35 ? 0.4 : 0);
      if (score > bestScore) { bestScore = score; best = p; }
    });
    return best;
  }

  // ---- network (browser only) ----
  const cache = new Map();
  async function wiki(lang, place) {
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&generator=geosearch&ggscoord=${place.lat.toFixed(5)}%7C${place.lon.toFixed(5)}&ggsradius=300&ggslimit=15&prop=pageimages%7Cextracts%7Ccoordinates%7Cinfo&inprop=url&exintro=1&explaintext=1&exsentences=2&exlimit=15&pithumbsize=640&format=json&origin=*`;
    const d = await (await fetch(url)).json();
    const pages = Object.values((d.query && d.query.pages) || {}).map((p) => ({
      title: p.title, lat: p.coordinates && p.coordinates[0].lat, lon: p.coordinates && p.coordinates[0].lon,
      photo: p.thumbnail && p.thumbnail.source, summary: p.extract, url: p.fullurl,
    }));
    return bestArticle(place, pages);
  }
  async function commonsPhoto(place) {
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=geosearch&ggsnamespace=6&ggscoord=${place.lat.toFixed(5)}%7C${place.lon.toFixed(5)}&ggsradius=50&ggslimit=5&prop=imageinfo&iiprop=url%7Cextmetadata&iiurlwidth=640&format=json&origin=*`;
    const d = await (await fetch(url)).json();
    const pages = Object.values((d.query && d.query.pages) || {});
    const img = pages.map((p) => p.imageinfo && p.imageinfo[0]).find((i) => i && i.thumburl && /\.(jpe?g|png|webp)$/i.test(i.url));
    if (!img) return null;
    const artist = ((img.extmetadata && img.extmetadata.Artist && img.extmetadata.Artist.value) || "").replace(/<[^>]+>/g, "").trim();
    return { photo: img.thumburl, credit: artist ? `Photo: ${artist.slice(0, 40)} · Wikimedia Commons` : "Photo: Wikimedia Commons", link: img.descriptionurl };
  }
  /** -> { kind, kindNote, photo?, credit?, summary?, url? } */
  async function lookup(place) {
    const key = place.name + "|" + place.lat.toFixed(4) + "," + place.lon.toFixed(4);
    if (cache.has(key)) return cache.get(key);
    const [kind, kindNote] = typeText(place.type);
    const out = { kind, kindNote };
    const langs = ["en"];
    const ui = (typeof navigator !== "undefined" && navigator.language || "en").slice(0, 2);
    if (ui !== "en") langs.unshift(ui);
    for (const lang of langs) {
      try {
        const a = await wiki(lang, place);
        if (a) { Object.assign(out, { photo: a.photo, summary: a.summary, url: a.url, credit: a.photo ? "Photo: Wikipedia" : null }); break; }
      } catch (e) { /* try next */ }
    }
    if (!out.photo) { try { Object.assign(out, await commonsPhoto(place) || {}); } catch (e) { /* no photo */ } }
    cache.set(key, out);
    return out;
  }

  return { lookup, bestArticle, nameScore, typeText };
});
