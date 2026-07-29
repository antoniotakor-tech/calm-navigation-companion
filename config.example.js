// Calm Navigation Companion — client configuration
//
// This app uses GraphHopper's free-tier Directions + Geocoding API for routing.
// The API key is NOT configured here — it never ships to the browser. It's a
// Cloudflare Pages secret consumed server-side by functions/api/route.js and
// functions/api/geocode.js, which proxy requests to GraphHopper on the
// client's behalf. To set it (2 minutes):
//   1. Go to https://www.graphhopper.com/dashboard/ and sign up (email only)
//   2. Create an API key in the dashboard
//   3. Locally: `wrangler pages dev .` picks up a .dev.vars file
//      (GRAPHHOPPER_API_KEY=...) automatically — see .dev.vars.example.
//   4. Deployed: `wrangler pages secret put GRAPHHOPPER_API_KEY`
//
// Without a key configured, /api/route and /api/geocode return a 501 and the
// app runs in DEMO MODE: a simulated calm route with realistic road-class
// data, so the full app (routing UI, auditory regulation, haptic fidgeting)
// is testable with zero setup.

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
};
