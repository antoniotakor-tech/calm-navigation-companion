# Privacy: Location Data Disclosure

This document describes exactly what location data Calm Navigation Companion collects, where it goes, how long it's kept, and how a user stops it — for both the web app and the native (iOS/Android) app added in this pass. It supersedes nothing in the existing app; it extends the same "nothing is tracked outside an active search/navigation" posture the web app already had to the new background-capable native feature.

## What location data exists, and why

| Purpose | When it runs | What's collected | Where it goes |
|---|---|---|---|
| Address autocomplete ranking / "nearby city" bias | Once, on first focus of an address field | One low-accuracy fix, reverse-geocoded to a city/state/country | Sent to `/api/geocode` (this app's own Cloudflare Function → GraphHopper) to bias search ranking. Cached in memory for the session only — see below. |
| "Use my current location" (start field) | Only if the user taps it | One higher-accuracy fix, reverse-geocoded for a label | Same as above |
| Active navigation (foreground) | While a route is being followed with the app open | Continuous fixes | Sent to `/api/route` only when a reroute is needed (off-route). Fixes themselves never leave the device except as part of a reroute request's start point. |
| Active navigation (background, native app only, opt-in) | Only while a navigation session is active AND the user explicitly checked "keep navigating when locked" AND granted background/"Always" permission | Continuous fixes, processed natively (off-route/maneuver/arrival math) | Same as foreground: fixes stay on-device; only a reroute request (if needed) sends a single current point to `/api/route` |

**Location history written to disk (2026-08-03, a deliberate reversal of this document's earlier "none, ever" stance, made on direct request):** `placesstore.js` persists two things to the browser's `localStorage`, under the key `calmcompanion.places.v1` — never sent over the network, never readable by this app's own servers or Functions, never synced anywhere:
- Your last 5 searched routes (start/end label + coordinates + travel mode + timestamp), most-recent-first, oldest dropped automatically past 5.
- Any places you explicitly pinned (label, icon, coordinates) via the destination field's "📌" button — kept until you delete them yourself in Settings → Saved places.

Clearing this app's site data (or its own future "clear history" control, not yet built) removes it entirely; it is purely a same-device convenience feature, not a server-side record. Everything else location-related remains exactly as strict as before:
- An in-memory "current city" cache (city/state/country code + the one coordinate it was resolved from), cleared on page reload / app restart — used only to bias search ranking.
- Whatever `getNavigationSnapshot()` holds *while a navigation session is actively running* (current step index, distance to next maneuver, the route itself) — used only to restore the UI correctly if the app is backgrounded and reopened during that same session. This is cleared entirely when navigation ends (`stopNavigationSession()`), not persisted across app launches.

## Who receives location data

- **GraphHopper** (via this app's own Cloudflare Pages Function proxy, which injects the API key server-side — the key never touches the client, native or web): receives coordinates only as part of a geocode/reverse-geocode/route request, exactly the data needed to answer that specific request. GraphHopper's own privacy policy governs what they do with it; this app does not control that.
- **No other third party.** No analytics SDK, no crash reporter, no advertising SDK is integrated in this project. There is no user account and no server of this app's own that stores anything.
- **Cloudflare** (the hosting/proxy provider) sees requests in transit the way any HTTPS host does (standard access-log-level visibility), but this app does not configure any additional logging, analytics, or storage of request contents on Cloudflare's side beyond what the Function code itself does (which is: proxy the request, don't log coordinates — see `functions/api/*.js`, whose only `console.warn` calls log HTTP status codes, never coordinates or the API key).

## How background location is indicated to the user

- **iOS**: the OS's own blue status-bar/pill background-location indicator (`showsBackgroundLocationIndicator = true`), plus this app's own Now Playing/Control Center info showing the current instruction whenever navigation is active — both visible without unlocking the phone.
- **Android**: a persistent, non-dismissable notification (required by Android for any foreground service) showing the current instruction and a direct "Stop navigation" action — visible without unlocking the phone.
- **In both cases**, the app never shows an in-app "background navigation active" state unless the native side's `startNavigationSession()` actually returned `backgrounded: true` — see IOS_/ANDROID_BACKGROUND_NAVIGATION.md's "single-engine invariant" section and `shared/interfaces.js`'s `BackgroundNavigationService.isBackgroundActive()` contract. This is enforced in code, not just policy.

## How a user stops it

- Tap **"Stop navigation"** in the app (nav banner), or
- Tap **"Stop navigation" directly from the Android notification** or the **iOS lock-screen/Control Center stop control**, or
- Simply **deny or revoke** location permission at any time (Settings, both platforms) — the app detects this mid-session (see the two background-navigation docs' "handled failure modes") and stops claiming background capability, rather than silently continuing to assume it has permission it no longer has.

Stopping navigation clears all in-memory navigation state (route, step index, distances) immediately — there is nothing left to delete, because nothing was written to disk in the first place.

## What this document does NOT cover

This is a technical disclosure of what the code does, not a legal privacy policy. If this app is ever distributed publicly (App Store / Play Store submission), a real privacy policy page is required by both platforms' developer agreements, and should be written by/reviewed with someone qualified to do so — this document can serve as the accurate factual basis for that policy's location-data section, but is not a substitute for it.
