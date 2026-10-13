# Campaign plan — Calm Companion launch (7-day test)

## Goal

Find out which message makes people in Amsterdam open Calm Companion, at the lowest cost per visit, so the next euro goes to the winner.

- **Main goal:** visits to the app from ads and stickers.
- **Success after 7 days:** one clear winning message, a cost per click you can live with, and people opening the app (not just the landing page).

## Audience

| | |
|---|---|
| Age | 20–28 |
| Where | Amsterdam (+5 km). Optional, only after day 3: Utrecht and Rotterdam |
| Who | People who find the city busy and loud and want calmer ways to move through it |
| Language | English and Dutch (one ad per language in every ad set) |
| How we talk | About the feeling ("the city feels like too much"), never about a condition. Plain words. Confident. |
| Interests (optional) | Leave broad. If you add any: walking, cycling, parks, journaling, drawing, lo-fi music. **Never** health or medical interests. |

## Budget: €120 (inside the €100–150 range)

| Where | Variant | Per day | 7 days |
|---|---|---|---|
| Instagram (Meta) | A · Calmer route | €5 | €35 |
| Instagram (Meta) | B · Weather doodles | €5 | €35 |
| Instagram (Meta) | C · Calm spots | €5 | €35 |
| Reserve | Move to the winner from day 4 | | €15 |
| **Total paid** | | | **€120** |

**TikTok:** TikTok Ads has a minimum daily budget per ad group (about €20 a day at the time of writing; check the number in TikTok Ads Manager). Three ad groups would use the whole budget in two days. So: post the three videos on TikTok **organically** (no budget) during the same week. If one takes off there, boost it later with the €30 left over after the test (up to the €150 ceiling).

**Stickers:** printing is separate from the ad budget. A sheet of 8 stickers costs a few euros at a local print shop. Start with the Amsterdam sheet.

## The 3 variants

| | Message | Video | Lands on |
|---|---|---|---|
| A | The calmer route | Same trip, calm route vs fast route | `/welcome/#how` |
| B | The map that feels the weather | Doodle clouds, sun, wind on the live map | `/welcome/` |
| C | Calm spots, shared | Flowers on the map → a place card | `/welcome/#community` |

Copy: `ad-copy.md`. Video scripts: `video-scripts.md`. Links: `tracking-links.csv`.

## 7-day schedule

| Day | What to do |
|---|---|
| 0 (before) | Record the 3 videos. Make the ads in Meta. Print the Amsterdam sticker sheet. Turn on Cloudflare Web Analytics (after the privacy text update, see README). |
| 1 | Start all 3 ad sets at €5/day. Post video A on TikTok. Put up 4 stickers (canal, park, café, uni bike rack). |
| 2 | Don't touch the ads (Meta is still learning). Post video B on TikTok. |
| 3 | First check (see rule below). Post video C on TikTok. Put up the other 4 stickers. |
| 4 | Apply the stop-or-continue rule. Move the €15 reserve to the best variant. |
| 5–6 | Let it run. Note which sticker spots show visits in Cloudflare. |
| 7 | Stop everything. Fill in the results table below. Decide the next step. |

## Stop or continue

- **When:** once the whole campaign has spent **€30** (around day 2–3).
- **Rule:** pause any variant whose **cost per click is 2× (or more) the best variant's**. Its remaining budget goes to the best one.
- **Also pause** any ad with a click-through rate under 0.5% after 1,000 impressions. The message isn't landing.
- **Never** change an ad's text or video mid-test. Make a new ad instead, or the comparison breaks.

## What we measure

| Metric | Where to find it | Why |
|---|---|---|
| Cost per click (CPC) | Meta Ads Manager → "CPC (cost per link click)" | Which message is cheapest to get a visit |
| Click-through rate (CTR) | Meta Ads Manager | Is the message interesting at all |
| Visits to `/welcome/` | Cloudflare Web Analytics → Paths | Real people arriving (not just clicks) |
| Visits to the app (`/`) | Cloudflare Web Analytics → Paths | People who went from the landing page into the app |
| Sticker visits | Cloudflare Web Analytics → Paths `/go/ams-canal`, `/go/ams-park`… | Which spot works |
| Return visits | See note | |

**About return visits.** Cloudflare Web Analytics is cookie-free, so it cannot tell a new visitor from a returning one. That is the privacy promise working as intended. Honest proxies:
- Visits to the app root (`/`) in week 2, compared with week 0, after the ads have stopped.
- New community profiles and posts per day (counts only, from your own database).

**About UTM tags.** Every link has UTM tags, so Meta, TikTok and any tool you add later can read them. Cloudflare Web Analytics does **not** show query strings, so it won't show UTM values. That is why each sticker gets its own short path (`/go/…`) that Cloudflare *can* count.

## Results table (fill in on day 7)

| Variant | Spent | Clicks | CPC | CTR | /welcome visits | App visits |
|---|---|---|---|---|---|---|
| A · Calmer route | | | | | | |
| B · Weather doodles | | | | | | |
| C · Calm spots | | | | | | |

| Sticker | Visits (Cloudflare path) |
|---|---|
| ams-canal | |
| ams-park | |
| ams-cafe | |
| ams-uni | |
