# Calm Companion — App Store submission pack

Everything to paste into **App Store Connect**, plus the build steps. Prepared 13 Oct 2026.

---

## 1. Build & upload (needs Xcode + Apple Developer account)

1. `npm install` (once), then `npm run build:web && npx cap sync ios`
2. Open `ios/App/App.xcodeproj` in Xcode.
3. **Signing & Capabilities** (App target): pick your Team; add capability **In-App Purchase**.
4. Run on your iPhone; test: route + navigation with screen locked, sounds, kalimba, drums, chords, voice recording, sketch, fidget haptics, Community post with photo, Calm+ purchase in **Sandbox**, Restore purchases, tips.
5. **Product → Archive → Distribute App → App Store Connect → Upload.**
6. (Optional, later) the widget: see `ios/App/CalmWidget/README.md`.

---

## 2. App information

| Field | Value |
|---|---|
| Name (≤30) | **Calm Companion** |
| Subtitle (≤30) | **Calm routes & sensory tools** |
| Bundle ID | `com.calmnav.companion` |
| Primary category | **Navigation** |
| Secondary category | **Lifestyle** |
| Content rights | Uses third-party content (OpenStreetMap, Wikimedia, Transitous) under their open licences — answer **Yes, I have the rights**. |
| Privacy Policy URL | https://calm-navigation-companion.pages.dev/privacy |
| Support URL | https://calm-navigation-companion.pages.dev/terms (contact email inside) |
| Copyright | © 2026 Antonio Frungillo |
| Price | **Free** (with in-app purchases) |

### Promotional text (≤170)
Quieter streets, calming sounds, a little music studio and fidget tools — a hand-drawn companion for days when the city feels too loud.

### Description
Calm Companion is a navigation app made for neurodivergent people and anyone who finds the city overwhelming.

CALM ROUTES — Get walking and cycling routes that prefer parks, quiet streets and greenery, with gentle turn-by-turn guidance. Public transport with live departures and delays across Europe.

CALM PLACES — The map blooms with flowers on quiet spots near you: libraries, gardens, small parks, bookshops, tea rooms. Tap any place to see a photo and what it is. Rate how calm it was, and the app learns what you like.

CALM SOUNDS — Rain, flowing water, soft noise and a city mask to soften traffic and voices.

STUDIO — Make a beat, play the kalimba or chord pads over it, and record your voice with friendly effects. Share songs on your profile.

SKETCHBOOK & FIDGET — Draw on lined paper or on photos; spin a fidget spinner, pop bubble wrap, flick switches — with haptics.

COMMUNITY (16+) — Share calm spots, calm routes and events with photos, see them on the map, and leave Calm Echoes: tiny melodies for others to find.

Hand-drawn look in Light and Dark, with weather and day-night doodles on the map. No ads, no tracking.

Calm+ (one-time purchase) adds extra sketch brushes and papers, spinner designs, unlimited saved sketches and a badge. Everything else is free.

Calm Companion is a wellbeing tool, not a medical device.

### Keywords (≤100, comma-separated, no spaces after commas)
calm,quiet,route,adhd,autism,sensory,neurodivergent,walking,noise,fidget,relax,anxiety,map,mindful

### What's New
First release.

---

## 3. In-App Purchases (create before submitting; attach to the version)

| Product ID | Type | Price | Display name | Description |
|---|---|---|---|---|
| `com.calmnav.companion.calmplus` | Non-Consumable | €2.99 (tier) | Calm+ | Extra brushes, papers, spinner designs, unlimited sketches and a badge. |
| `com.calmnav.companion.tip1` | Consumable | €0.99 | Small thank-you | A small tip to the maker. Unlocks nothing. |
| `com.calmnav.companion.tip3` | Consumable | €2.99 | Thank-you | A tip to the maker. Unlocks nothing. |
| `com.calmnav.companion.tip5` | Consumable | €4.99 | Big thank-you | A bigger tip to the maker. Unlocks nothing. |

Each needs a review screenshot (Settings → Support the maker / Community → Calm+ card).
Sign the **Paid Apps agreement** and add bank + tax info in App Store Connect → Business first.

---

## 4. Age rating questionnaire (answer honestly)

- User-generated content / social: **Yes** (moderated: filter, report, block).
- Unrestricted web access: **No**.
- Medical/treatment info: **No** (wellbeing tool, no medical claims).
- Violence, sexual content, profanity, gambling, alcohol: **None** (users may name bars as places — "Infrequent/Mild" alcohol reference is acceptable if asked).
- Location sharing with other users: posts show a place (user chooses it; can be moved on the map).
- Expected rating: **16+** — matches the in-app 16+ Community gate.

---

## 5. App Privacy ("nutrition label") — matches PrivacyInfo.xcprivacy

Tracking: **No** (no ads, no third-party tracking SDKs).

| Data type | Collected | Linked to user | Used for |
|---|---|---|---|
| Precise Location | Yes (routing, weather ~1 km rounded, posts the user places) | Yes (posts) | App functionality |
| Photos | Yes (only photos the user posts) | Yes | App functionality |
| Audio Data | Yes (only songs the user publishes) | Yes | App functionality |
| Other User Content (posts, Echoes, profile bio) | Yes | Yes | App functionality |
| Name (chosen nickname) | Yes | Yes | App functionality |
| User ID (random device key / account id) | Yes | Yes | App functionality |
| Purchase History | Yes | Yes | App functionality |
| Customer Support (problem reports) | Yes | No | App functionality |
| Other Diagnostic Data (app version/screen/device in reports) | Yes | No | App functionality |

Not collected: contacts, health data, browsing history, advertising data, email (only if the user volunteers it in a problem report).

---

## 6. Notes for App Review (paste into "Review Notes")

> Calm Companion is a calm-navigation and sensory-regulation app for neurodivergent people. No login is required — every feature works immediately.
>
> How to test:
> 1. **Route** tab: type any address (e.g. "Damrak 1, Amsterdam") → Find calm route → Start. "Show map" tucks the cards away. "Live departures near me" shows live public transport.
> 2. Tap a **flower** on the map → place card with photo/description.
> 3. **Sound**: tap Rain / Stream (check the silent switch).
> 4. **Studio**: Drums → Play; Chords → hold a pad; Voice → Record (microphone, only on tap).
> 5. **Draw** and **Fidget** tabs: draw; flick the spinner (haptics).
> 6. **Community**: tick "I'm 16 or older…", create a profile (no password), Share a calm spot with a photo. Every post/profile has **Report** and **Block**; one report hides content immediately; text is filtered for links, contact details and slurs; users can delete posts and their whole profile. Rules: /terms.
> 7. **Calm+** (Community tab card) and **tips** (Settings → Support the maker) use **In-App Purchase**; **Restore purchases** is on the Calm+ card.
>
> Background modes: **location** (turn-by-turn guidance continues with the screen locked during active navigation only) and **audio** (calming soundscapes and spoken directions keep playing during navigation).
> The app does not make medical claims. Contact: antoniotakor@icloud.com

---

## 7. EU — Digital Services Act trader status

Selling in the EU (IAP) makes you a **trader**: App Store Connect → Business → **Trader status** → provide name, address, phone, email (shown publicly on the EU App Store). Use your **KvK-registered** address/phone.

---

## 8. Screenshots (6.9" iPhone, at least 3; up to 10)

1. Map with flowers + weather doodles (Route tab)
2. Calm route card on the map
3. A place card with photo
4. Live departures board
5. Studio — drums + chords
6. Sketchbook drawing
7. Fidget spinner
8. Community map with photo posts
Use real screens (Apple 2.3.3). Mark Calm+ items as in-app purchases in the description (done).
