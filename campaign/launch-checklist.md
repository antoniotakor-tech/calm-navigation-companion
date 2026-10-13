# Launch checklist — step by step (for a first-time advertiser)

Do these in order. It takes about an hour the first time.

## Before you start

- [ ] Videos A, B and C exported (see `video-scripts.md`), each in English and Dutch text = 6 files.
- [ ] Privacy text updated and Cloudflare Web Analytics switched on (see `README.md` → "Measuring visits").
- [ ] The Instagram account `calm_companion.app` is switched to a **Professional** account: in the app, Settings → Account type and tools → Switch to professional account → **Creator** or **Business**. Category: "App page".
- [ ] A payment card. Meta charges as you spend.

## Meta Ads Manager (Instagram)

1. Go to **business.facebook.com** → log in → open **Ads Manager**. If asked, create an ad account in **EUR** with time zone **Amsterdam**.
2. Click **+ Create**.
3. **Campaign objective:** choose **Traffic**. Click Continue.
4. **Campaign name:** `calm-launch-2026`. Special ad categories: **none**. Leave "Advantage campaign budget" **off**, because each ad set gets its own budget so the 3 messages stay comparable.
5. **Ad set 1** (name it `A · Calmer route`):
   - Conversion location: **Website**.
   - Performance goal: **Maximise number of link clicks**. ("Landing page views" needs a Meta Pixel, which we don't use.)
   - Budget: **Daily €5.00**. Schedule: start tomorrow, end after 7 days.
   - Audience: Location **Amsterdam +5 km** (people living in or recently in this location). Age **20–28**. Languages: leave empty. Detailed targeting: leave empty.
   - Placements: choose **Manual placements** → tick only **Instagram Feed**, **Instagram Stories** and **Instagram Reels**. Untick everything else.
6. **Ads in this ad set** (make 2, one per language):
   - Identity: Instagram account **calm_companion.app**.
   - Format: **Single image or video** → upload video A (English).
   - Primary text, Headline: copy from `ad-copy.md` → Angle 1 → English.
   - Call to action: **Learn more**.
   - Website URL: from `tracking-links.csv`, the row `route-reels-en` (one URL is fine for all three placements).
   - Duplicate the ad → swap in the Dutch video, Dutch text and the `route-reels-nl` URL.
7. Duplicate the whole ad set twice → rename to `B · Weather doodles` and `C · Calm spots` → swap in the matching videos, copy and URLs.
8. Click **Publish**. Ads go into review (usually a few hours).

**Checking results:** Ads Manager → Columns → **Performance and clicks**. Watch "CPC (cost per link click)" and "CTR (link click-through rate)". Apply the stop-or-continue rule from `campaign-plan.md` once €30 has been spent.

## TikTok

**Organic (recommended for this budget):**
1. Create a TikTok account with the same name `calm_companion.app` and the Amanda profile picture.
2. Bio: "The calm navigation app" + the landing page link (TikTok allows a link once the account qualifies; until then, say "link on Instagram").
3. Post video A on day 1, B on day 3, C on day 5. Caption from `ad-copy.md`, 3–5 hashtags (#amsterdam #citywalks #calm #quietplaces).

**Paid (only if one video does well organically):**
1. Go to **ads.tiktok.com** → create an account in EUR.
2. Campaign → objective **Traffic** → budget at the minimum TikTok allows.
3. Ad group: placement **TikTok only**, location **Netherlands → Amsterdam**, age **18–24 and 25–34** (TikTok uses fixed ranges), schedule 3–4 days.
4. Ad: use the **Spark Ad** option to boost the organic post that did best. Destination URL: the `tiktok` row for that variant in `tracking-links.csv`.

## Stickers

1. Print `stickers/sheet-ams.pdf` on sticker paper or at a print shop. Ask for "kiss-cut stickers, 90 × 55 mm, cut along the magenta line, 3 mm bleed included".
2. Before putting them up, scan one with your phone to check it opens Calm Companion.
3. Only stick them where it is allowed: your own bike, café noticeboards (ask staff), uni noticeboards. Don't stick them on public property or other people's things. That's illegal in Dutch cities and gets fined.
4. Write down where each one went.

## After 7 days

- [ ] Pause all ads.
- [ ] Fill in the results table in `campaign-plan.md`.
- [ ] Keep the winner running at €5/day if the CPC is good. Rewrite the losers into new versions of the winning message.
