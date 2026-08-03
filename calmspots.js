// ---------------------------------------------------------------------------
// CalmSpots — a small, hand-curated list of genuinely calm bars and quiet
// public spots in Amsterdam, requested directly (2026-08-03): "is there any
// list of calm bars and spots in Amsterdam, if not find it in your own way".
// There's no OSM tag for "calm" (unlike shop/amenity/leisure, which pois.js
// already queries live from Overpass), so this is deliberately NOT another
// Overpass query — it's a small, real, sourced list, kept separate from the
// dynamic food/shop/transit POI layer on purpose.
//
// Sourced from real published "quiet bars"/"hidden gems"/"secret gardens"
// coverage of Amsterdam (travel guides, local blogs) during this session —
// every entry is a real, named, findable place, not invented. Deliberately
// skips places already well-covered by the app's own green-space layer
// (large parks) in favor of small hidden courtyards (hofjes) and quietly-
// regarded bars that no polygon-based data source would surface.
//
// Coordinates are hand-placed to each venue's known street/block from that
// research, NOT run through a geocoder (no live GRAPHHOPPER_API_KEY in this
// environment to verify against) — accurate to roughly a building's width,
// not survey-precise. If exact placement ever matters (e.g. tight walking-
// route proximity scoring), re-geocode each `query` field via /api/geocode
// and replace lat/lon with the verified result.
// ---------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CalmSpots = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const CALM_SPOTS = [
    {
      name: "Begijnhof",
      category: "spot",
      note: "A 14th-century almshouse courtyard just off Spui — one of the most reliably quiet green pockets in the old center.",
      query: "Begijnhof, Amsterdam",
      lat: 52.3676, lon: 4.8904,
    },
    {
      name: "Hortus Botanicus Amsterdam",
      category: "spot",
      note: "One of the world's oldest botanical gardens — a genuine retreat from the city, even mid-afternoon.",
      query: "Hortus Botanicus, Plantage Middenlaan 2A, Amsterdam",
      lat: 52.3679, lon: 4.9096,
    },
    {
      name: "Karthuizerhof",
      category: "spot",
      note: "A hidden Jordaan courtyard behind an unremarkable street door — brick facades, a small garden, almost never crowded.",
      query: "Karthuizerhof, Karthuizersstraat, Amsterdam",
      lat: 52.3745, lon: 4.8825,
    },
    {
      name: "Suyckerhoffje",
      category: "spot",
      note: "Another Jordaan hofje, on Lindengracht — steps from a busy market street but a world away once you're through the passage.",
      query: "Suyckerhoffje, Lindengracht, Amsterdam",
      lat: 52.3803, lon: 4.8823,
    },
    {
      name: "Café 't Hooischip",
      category: "bar",
      note: "Near Waterlooplein — known specifically for its quiet atmosphere and friendly, unhurried service.",
      query: "Café 't Hooischip, Grimburgwal, Amsterdam",
      lat: 52.3696, lon: 4.8983,
    },
    {
      name: "Gollem",
      category: "bar",
      note: "A classic brown bar off Spui — a relaxed drink away from the crowds, without the noise of the main squares.",
      query: "Gollem, Raamsteeg, Amsterdam",
      lat: 52.3672, lon: 4.8886,
    },
    {
      name: "De Pilsener Club",
      category: "bar",
      note: "Vintage, old-time-charm pub a few steps off busy Kalverstraat — peaceful despite the location.",
      query: "De Pilsener Club, Begijnensteeg, Amsterdam",
      lat: 52.3710, lon: 4.8925,
    },
    {
      name: "Proeflokaal Arendsnest",
      category: "bar",
      note: "A calm, canal-side tasting room on Herengracht — scenic water views, unrushed pace.",
      query: "Proeflokaal Arendsnest, Herengracht 90, Amsterdam",
      lat: 52.3762, lon: 4.8886,
    },
    {
      name: "Bar Feijoa",
      category: "bar",
      note: "An intimate cocktail bar near Amstelveld — cozy, craftsmanship-focused, built for a quiet evening rather than a loud one.",
      query: "Bar Feijoa, Amsterdam",
      lat: 52.3609, lon: 4.8975,
    },
    {
      name: "Café de Dokter",
      category: "bar",
      note: "Amsterdam's tiniest bar, tucked on Rozenboomsteeg near Spui — antique decor, live jazz some evenings, never rowdy.",
      query: "Café de Dokter, Rozenboomsteeg, Amsterdam",
      lat: 52.3701, lon: 4.8918,
    },
  ];

  return { CALM_SPOTS };
});
