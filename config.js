// Calm Navigation Companion — client configuration
//
// The GraphHopper API key is NOT here — it never ships to the browser. It's
// a Cloudflare Pages secret consumed server-side by functions/api/route.js
// and functions/api/geocode.js. See config.example.js for full setup notes.

const CONFIG = {
  DEFAULT_START: { label: "Amsterdam Centraal", lat: 52.3791, lon: 4.9003 },
  DEFAULT_END: { label: "Vondelpark", lat: 52.3579, lon: 4.8686 },

  // Time-of-day windows (24h) where we assume commercial/arterial routes are busier,
  // since live crowd/noise data isn't available on the free tier. This is a stated
  // heuristic, not measured data.
  PEAK_WINDOWS: [
    { startHour: 7, endHour: 9.5 },   // morning commute
    { startHour: 12, endHour: 14 },   // lunch
    { startHour: 17, endHour: 19.5 }, // evening commute
  ],

  // Named annual events where the normal calm/peak-hour heuristics stop applying
  // entirely — a quiet residential street on King's Day is a street party, not
  // a calm route. This list is honestly partial (manually maintained, no live
  // event-calendar data on the free tier) — add more if a specific city/date
  // matters for your testing.
  SPECIAL_EVENTS: [
    { month: 4, day: 27, name: "King's Day (Koningsdag)", note: "Nationwide street parties, including in residential areas. Calm/safety scoring doesn't apply — expect crowds and closures everywhere." },
    { month: 12, day: 31, name: "New Year's Eve", note: "Widespread fireworks and street gatherings. Calm/safety scoring doesn't apply tonight." },
  ],

  // Shows a "DEV: Simulate GPS" button that walks a fake position along the
  // found route, for testing navigation without physically walking. Keep
  // false for anything resembling a real deployment — it's also always
  // reachable via the URL flag ?simulate=1 regardless of this setting, since
  // that's meant to stay available for one-off demoing/QA.
  DEV_SIMULATION: false,

  // Only relevant inside the native Capacitor app. A WebView running natively
  // has no meaningful "same origin" to call /api/geocode and /api/route
  // against (its origin is a local capacitor:// scheme, not the deployed
  // site) — so on native, every routing.js/geocodingservice.js call is given
  // this as its endpointBase instead of "". On the web build this constant
  // is simply never read (endpointBase stays "", i.e. same-origin, exactly
  // as before this file gained native support). Update this if the
  // Cloudflare Pages deployment ever moves to a different URL.
  NATIVE_API_BASE_URL: "https://calm-navigation-companion.pages.dev",
};
