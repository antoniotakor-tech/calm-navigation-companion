// ---------------------------------------------------------------------------
// Calm icon set (2026-10-12) — replaces stock emoji with the app's own icons.
// One visual language: 24px grid, 1.8 rounded strokes in currentColor, plus a
// soft accent-tinted fill (var(--accent)) so icons follow every theme
// (Light/Dark/Flow/Bloom/High contrast) instead of looking pasted in.
// Usage: CalmIcons.html("cafe") or CalmIcons.html("☕") → inline <svg>.
// ---------------------------------------------------------------------------
(function (root) {
  "use strict";
  const T = 'class="ci-tint"'; // soft accent fill
  const P = {
    home: `<path ${T} d="M5 11l7-6 7 6v8a1 1 0 0 1-1 1h-4v-5h-4v5H6a1 1 0 0 1-1-1z"/><path d="M3.5 12L12 4.5l8.5 7.5M6 10.5V19a1 1 0 0 0 1 1h3.5v-5h3v5H17a1 1 0 0 0 1-1v-8.5"/>`,
    work: `<rect ${T} x="3.5" y="7.5" width="17" height="12" rx="3"/><rect x="3.5" y="7.5" width="17" height="12" rx="3"/><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3.5 13h17"/>`,
    pin: `<path ${T} d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>`,
    pushpin: `<path ${T} d="M9 4h6l-1 5 3 3H7l3-3z"/><path d="M9 4h6M10 4.2 9.3 9 7 12h10l-2.3-3L14 4.2M12 12v8"/>`,
    clock: `<circle ${T} cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`,
    library: `<path ${T} d="M4 5.5c3-1 5.5-.5 8 1.5 2.5-2 5-2.5 8-1.5v13c-3-1-5.5-.5-8 1.5-2.5-2-5-2.5-8-1.5z"/><path d="M4 5.5c3-1 5.5-.5 8 1.5 2.5-2 5-2.5 8-1.5v13c-3-1-5.5-.5-8 1.5-2.5-2-5-2.5-8-1.5zM12 7v13"/>`,
    park: `<path ${T} d="M12 3.5c3.5 0 6 2.6 6 5.8 0 3-2.4 5.2-6 5.2s-6-2.2-6-5.2c0-3.2 2.5-5.8 6-5.8z"/><path d="M12 3.5c3.5 0 6 2.6 6 5.8 0 3-2.4 5.2-6 5.2s-6-2.2-6-5.2c0-3.2 2.5-5.8 6-5.8zM12 20.5v-9M12 15l-2.5-2.5M12 13.5l2-2M7.5 20.5h9"/>`,
    leaf: `<path ${T} d="M5 19C5 10 10 5 19.5 4.5 19 14 14 19 5 19z"/><path d="M5 19C5 10 10 5 19.5 4.5 19 14 14 19 5 19zM5 19l8.5-8.5"/>`,
    cafe: `<path ${T} d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8.5 3.5c-.6.8.6 1.7 0 2.5M12 3.5c-.6.8.6 1.7 0 2.5"/>`,
    tea: `<path ${T} d="M4.5 10h12l-1 6.5a3 3 0 0 1-3 2.5h-4a3 3 0 0 1-3-2.5z"/><path d="M4.5 10h12l-1 6.5a3 3 0 0 1-3 2.5h-4a3 3 0 0 1-3-2.5zM16.3 11.5h1.7a2 2 0 0 1 0 4h-2.4M10.5 10V7.5c0-1.6 1.2-3 3-3.5"/>`,
    book: `<path ${T} d="M5.5 4.5h11a2 2 0 0 1 2 2v13h-11a2 2 0 0 1-2-2z"/><path d="M5.5 17.5v-13h11a2 2 0 0 1 2 2v13h-11a2 2 0 0 1-2-2 2 2 0 0 1 2-2h11M9 8.5h6"/>`,
    bakery: `<path ${T} d="M4 15c0-4.5 3.6-8 8-8s8 3.5 8 8c0 1.4-1.1 2.5-2.5 2.5h-11A2.5 2.5 0 0 1 4 15z"/><path d="M4 15c0-4.5 3.6-8 8-8s8 3.5 8 8c0 1.4-1.1 2.5-2.5 2.5h-11A2.5 2.5 0 0 1 4 15zM9 8l1.5 9.5M15 8l-1.5 9.5"/>`,
    food: `<circle ${T} cx="12" cy="13" r="6"/><circle cx="12" cy="13" r="6"/><path d="M3.5 4v5a1.5 1.5 0 0 0 3 0V4M5 9v11M20.5 4c-1.5 1-2 3-2 6h2v10"/>`,
    cocktail: `<path ${T} d="M5 5h14l-7 8z"/><path d="M5 5h14l-7 8zM12 13v7M8.5 20h7M15.5 2.5l-1.5 3.5"/>`,
    beer: `<path ${T} d="M6 8h9v10.5a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 6 18.5z"/><path d="M6 8h9v10.5a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 6 18.5zM15 10h1.5a2 2 0 0 1 2 2v2.5a2 2 0 0 1-2 2H15M6 8a2.5 2.5 0 0 1 2.5-3.5A3 3 0 0 1 13.5 5 2 2 0 0 1 15 8M9.5 11v6M12 11v6"/>`,
    flag: `<path ${T} d="M5.5 4.5h12l-2.5 4 2.5 4h-12z"/><path d="M5.5 21V4.5h12l-2.5 4 2.5 4h-12"/>`,
    walk: `<circle cx="13" cy="4.5" r="1.8"/><path d="M10.5 21l2-6 2.5 2.5V21M8 12l1.5-4 3.5-1 2.5 3.5 2.5 1M12.5 15l.8-4.5"/>`,
    tram: `<rect ${T} x="6" y="6" width="12" height="12" rx="3"/><rect x="6" y="6" width="12" height="12" rx="3"/><path d="M8 3h8M12 3v3M6 12h12M9 15h.01M15 15h.01M8.5 18l-2 3M15.5 18l2 3"/>`,
    bus: `<rect ${T} x="5" y="4" width="14" height="14" rx="3"/><rect x="5" y="4" width="14" height="14" rx="3"/><path d="M5 11h14M8.5 14.5h.01M15.5 14.5h.01M7.5 18v2.5M16.5 18v2.5"/>`,
    train: `<rect ${T} x="5.5" y="3.5" width="13" height="14" rx="4"/><rect x="5.5" y="3.5" width="13" height="14" rx="4"/><path d="M5.5 10.5h13M9 14h.01M15 14h.01M8.5 17.5 6.5 21M15.5 17.5l2 3.5"/>`,
    metro: `<circle ${T} cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="8.5"/><path d="M8 16V8.5l4 5 4-5V16"/>`,
    ferry: `<path ${T} d="M4 14h16l-2 4H6z"/><path d="M4 14h16l-2 4H6zM7 14v-4h10v4M10 10V7h4v3M3 21c1.5 0 1.5-1 3-1s1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1"/>`,
    sparkle: `<path ${T} d="M12 3.5l1.9 5.2 5.1 1.8-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.8z"/><path d="M12 3.5l1.9 5.2 5.1 1.8-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.8zM18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>`,
    sun: `<circle ${T} cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>`,
    moon: `<path ${T} d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/><path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>`,
    flower: `<g ${T}><circle cx="12" cy="6.5" r="3.2"/><circle cx="17.2" cy="10.3" r="3.2"/><circle cx="15.2" cy="16.4" r="3.2"/><circle cx="8.8" cy="16.4" r="3.2"/><circle cx="6.8" cy="10.3" r="3.2"/></g><circle cx="12" cy="6.5" r="3.2"/><circle cx="17.2" cy="10.3" r="3.2"/><circle cx="15.2" cy="16.4" r="3.2"/><circle cx="8.8" cy="16.4" r="3.2"/><circle cx="6.8" cy="10.3" r="3.2"/><circle cx="12" cy="12" r="2" fill="currentColor"/>`,
    camera: `<path ${T} d="M4 8.5h3l1.5-2.5h7L17 8.5h3v10H4z"/><path d="M4 8.5h3l1.5-2.5h7L17 8.5h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.3"/>`,
    image: `<rect ${T} x="3.5" y="5" width="17" height="14" rx="3"/><rect x="3.5" y="5" width="17" height="14" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3 2.5-2 5 4"/>`,
    paper: `<path ${T} d="M6 3.5h9l3.5 3.5v13.5H6z"/><path d="M6 3.5h9l3.5 3.5v13.5H6z"/><path d="M15 3.5V7h3.5M8.5 11h7M8.5 14h7M8.5 17h4.5"/>`,
    calm: `<circle ${T} cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="8.5"/><path d="M8.5 10.5c.6-.6 1.4-.6 2 0M13.5 10.5c.6-.6 1.4-.6 2 0M9 14.5c1.6 1.6 4.4 1.6 6 0"/>`,
    okay: `<circle ${T} cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="8.5"/><path d="M9 10h.01M15 10h.01M9 15h6"/>`,
    busy: `<circle ${T} cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="8.5"/><path d="M8.5 9.5l2 1-2 1M15.5 9.5l-2 1 2 1M9 16c1.6-1.4 4.4-1.4 6 0"/>`,
  };
  const ALIAS = {
    "🏠": "home", "💼": "work", "📍": "pin", "📌": "pushpin", "🕒": "clock",
    "📚": "library", "🌳": "park", "🌿": "leaf", "🍃": "leaf", "☕": "cafe", "🍵": "tea", "📖": "book",
    "🥐": "bakery", "🍽️": "food", "🍽": "food", "🍸": "cocktail", "🍺": "beer", "🏁": "flag",
    "🚶": "walk", "🚊": "tram", "🚌": "bus", "🚆": "train", "🚇": "metro", "⛴": "ferry",
    "✨": "sparkle", "☀": "sun", "🌙": "moon", "🌸": "flower", "😌": "calm", "😐": "okay", "😣": "busy",
  };
  function name(x) { return P[x] ? x : ALIAS[x] || null; }
  /** Inline SVG for a name or legacy emoji; plain text (escaped) otherwise, e.g. turn arrows. */
  function html(x, cls) {
    const n = name(x);
    if (!n) return String(x == null ? "" : x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    return `<svg class="ci ci-${n}${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[n]}</svg>`;
  }
  /** Replaces <i data-ci="name"></i> placeholders in static markup. */
  function hydrate(scope) {
    (scope || document).querySelectorAll("[data-ci]").forEach((el) => { el.outerHTML = html(el.getAttribute("data-ci")); });
  }
  const api = { html, hydrate, names: Object.keys(P), ALIAS };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CalmIcons = api;
})(typeof self !== "undefined" ? self : this);
