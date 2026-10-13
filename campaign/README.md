# Campaign folder — Calm Companion launch

Everything for the first paid test. **This folder is not deployed** (the deploy command excludes it). Only the small `/go/` pages at the app root go live.

| File | What it is |
|---|---|
| `campaign-plan.md` | Goal, audience, €120 budget, 7-day schedule, stop-or-continue rule, metrics |
| `ad-copy.md` | 3 angles × EN/NL: headlines (≤40), primary texts (≤125), call to action |
| `video-scripts.md` | 3 × 15 s vertical scripts: exact screens to record, on-screen text, audio, safe zones |
| `launch-checklist.md` | Click-by-click setup for Meta Ads Manager and TikTok, plus stickers |
| `tracking-links.csv` | 36 UTM links: 24 paid (3 variants × 4 placements × 2 languages) + 12 stickers |
| `qr/` | 12 QR codes (SVG + PNG), one per sticker spot. All checked with a QR scanner |
| `stickers/` | Print-ready sheets per city (`sheet-ams.pdf` etc., A4, 300 dpi), single stickers (PNG) and vector files (SVG) |
| `tools/` | `build.py` rebuilds links, QR codes, `/go/` pages and stickers; `qr.py` is the QR encoder |

To rebuild after changing a slogan or a spot: `python3 campaign/tools/build.py`

## Videos (`video/`)

| File | What it is |
|---|---|
| `video-1-calm-way.mp4` | The first Reel (published on Instagram, silent) |
| `video-4-satisfying.mp4` | Fidget: bubble wrap, spinner, clicky, squish → "Also finds you a calmer way home." → end card |
| `video-5-fastest-vs-calmest.mp4` | Real routes Dam → Vondelpark: fastest (36 min, calm 6.9/10) draws first, then calmest (39 min, calm 7.5/10) → "You choose." → end card |
| `*.en.srt`, `*.nl.srt` | Captions, English and Dutch |
| `contact-sheet.png` | 4 frames per video (1, 4, 5) |
| `src/` | The real app captures the videos are built from, plus the exact route points (`routes-dam-vondelpark.json`) |

All: 1080 × 1920, 30 fps, H.264 + AAC, 15 s, ~9–12 MB. Text stays between 150 px from the top and 250 px from the bottom.

**How they are made:** there is no Playwright or ffmpeg on this machine, so the pipeline is:
1. Capture the live app at iPhone size (390 × 844, 2×) in the preview browser: real taps on bubbles, a real flick of the spinner, real switches and squish, and a real route search.
2. `video/render.html` builds each 15 s video from those captures. Only the spinner disc turns between captures, the way it does in the app. The route lines are drawn from the app's own route points, so they are not edited or exaggerated.
3. Audio is rendered offline: video 4 uses the app's own fidget sound recipes (pop, tick, clack, squish from `fidget.js`) over a soft kalimba bed; video 5 is a short piece played on the app's own `KalimbaEngine`. No outside music.
4. The browser encodes H.264 video and AAC audio and saves the MP4 through a local-only helper (`tools/sink.py`).

**To regenerate video 4 or 5:**
1. In Claude Code's preview, start the **ad-render** server (it serves the app folder on port 8744 and saves into `campaign/video/`).
2. Open `http://localhost:8744/campaign/video/render.html`.
3. In the browser console run `await __render('v4')` or `await __render('v5')`. Run `await __frames()` to redo the frame strips.

**New route or new captures:** search a route in the live app at 390 × 844, hide the route layers on screen only, take a screenshot as `src/route-base.jpg`, and export the projected points of `CalmApp.currentRoute()` (calm) and the `route-fast` source (fast) into the JSON. Pick start and end points where the two routes really differ.

## How sticker tracking works

Each QR code opens a short link like `calm-navigation-companion.pages.dev/go/ams-canal`. That page shows "Opening Calm Companion…" for half a second, then opens the app with UTM tags. Cloudflare Web Analytics counts visits **per path**, so you'll see how many people scanned at the canal, the park, the café or the bike racks, without cookies.

## Sticker print specs

- Size: **90 × 55 mm** (trim), landscape, rounded corners 4 mm.
- **Bleed: 3 mm** on every side (artwork is 96 × 61 mm). The magenta dashed line is the cut line. Tell the printer it's a cut guide, not to be printed.
- Safe zone: keep text 4 mm inside the trim (already done).
- Resolution: 300 dpi. Colour: RGB files; ask the printer to convert to CMYK, or accept small colour shifts.
- QR code: 34 mm wide. Scans reliably from about 30 cm away. Don't print smaller than 20 mm.
- The SVG files use the Gaegu font. Convert text to outlines (Illustrator/Inkscape → Object to path) before sending an SVG to a printer, or just send the PDF.
- Material: matte vinyl or matte paper stickers, so there's no glare when scanning.

## Measuring visits (privacy-friendly)

**Cloudflare Web Analytics** works for this site and is cookie-free: no cookies, no local storage, no fingerprinting, and it doesn't record query strings. Steps:

1. Log in to **dash.cloudflare.com**.
2. Go to **Workers & Pages** → click **calm-navigation-companion**.
3. Open the **Metrics** tab → under **Web Analytics** click **Enable**.
4. It's added automatically **on the next deploy**. Ask me to redeploy, or push any change.
5. Results: Cloudflare dashboard → **Analytics & Logs** → **Web Analytics** → your site. Look at **Paths** (`/welcome/`, `/`, `/go/…`) and **Referrers** (instagram.com, tiktok.com).

**⚠️ Do this first: your privacy page currently says "no analytics".** Enabling it without updating the text would break that promise. Proposed wording (not applied, waiting for your OK):

- Line 32, replace
  > There are **no ads**, **no analytics** and **no trackers** in this app.

  with
  > There are **no ads** and **no trackers** in this app. We count page visits with Cloudflare Web Analytics, which uses no cookies and doesn't identify you.

- Line 76, replace
  > We don't add analytics or log your coordinates.

  with
  > We use Cloudflare Web Analytics to count visits (no cookies, no personal data) and we never log your coordinates.

## Landing page check (what an ad click sees)

Checked on an iPhone-sized screen (390 × 844) with a real ad link.

**Works well:** headline, short pitch and the **Open Calm Companion** button are all visible on the first screen without scrolling. The hand-drawn font loads, nothing scrolls sideways, and UTM tags in the link don't break anything.

**Fixed (small, safe):**
- Hero screenshot was 676 KB, now 102 KB (all 5 screenshots now JPEG, ~70 KB each). Much faster on mobile data.
- Shorter hero text (one sentence instead of three), so the button sits higher.
- Ads now land on the part of the page they talk about: "calm spots" ads → Community section, "calmer route" ads → How it works.

**Friction to know about (not changed):**
- People who tap an ad open the page **inside Instagram's or TikTok's own browser**. "Add to Home Screen" only works in Safari, so the page's install tip doesn't work there. The app itself works fine in the in-app browser. Possible fix later: a small "Open in Safari to install" hint shown only inside those browsers.
- The "weather doodles" ad has no matching section on the landing page yet. It lands at the top. A short section with a doodle-weather screenshot would make that ad convert better.
- The phone frame image is below the button on small phones. Fine as it is, but a short looping video of the map there would be stronger than a still.
