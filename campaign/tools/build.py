"""Builds the campaign assets: tracking links, QR codes, /go/ redirect pages and sticker sheets.
Run from the campaign folder:  python3 tools/build.py
"""
import csv, os, sys, base64, io, math
from urllib.parse import urlencode
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
from qr import QR
from PIL import Image, ImageDraw, ImageFont

BASE = "https://calm-navigation-companion.pages.dev"
CAMPAIGN = "calm-launch-2026"
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))          # campaign/
APP = os.path.dirname(HERE)                                                  # app root
VARIANTS = [("route", "Calmer route"), ("weather", "Weather doodles"), ("spots", "Calm spots")]
PLACEMENTS = [("instagram", "feed"), ("instagram", "stories"), ("instagram", "reels"), ("tiktok", "feed")]
LANGS = ["en", "nl"]
CITIES = [("ams", "Amsterdam"), ("utr", "Utrecht"), ("rtm", "Rotterdam")]
SPOTS = [("canal", "Canals"), ("park", "Parks"), ("cafe", "Cafés"), ("uni", "Uni bike racks")]
SLOGANS = {
    "canal": "Feeling overwhelmed? Scan for a calmer way home.",
    "park": "Slow down. Scan here.",
    "cafe": "Found a calm spot? There's an app for that.",
    "uni": "The city, minus the chaos.",
}


def utm(dest, source, medium, content, anchor=""):
    return f"{BASE}{dest}?" + urlencode({"utm_source": source, "utm_medium": medium, "utm_campaign": CAMPAIGN, "utm_content": content}) + anchor


def tracking_links():
    rows = []
    for v, vname in VARIANTS:
        for src, plc in PLACEMENTS:
            for lang in LANGS:
                content = f"{v}-{plc}-{lang}"
                # message match: each ad lands on the part of the page it talks about
                anchor = {"route": "#how", "weather": "", "spots": "#community"}[v]
                rows.append(["paid", vname, f"{src} {plc}", lang, "", utm("/welcome/", src, "paid-social", content, anchor), "", content])
    for c, cname in CITIES:
        for s, sname in SPOTS:
            slug = f"{c}-{s}"
            rows.append(["sticker", SLOGANS[s], f"{cname} – {sname}", "en", slug,
                         utm("/", "sticker", "qr", slug), f"{BASE}/go/{slug}", slug])
    with open(os.path.join(HERE, "tracking-links.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["type", "variant_or_slogan", "placement", "language", "sticker_id", "utm_url", "qr_short_url", "utm_content"])
        w.writerows(rows)
    return rows


GO_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Calm Companion</title>
<style>
  body {{ margin:0; min-height:100vh; display:grid; place-items:center; background:#fffaf1; color:#2d2a3e;
         font: 18px/1.5 "Atkinson Hyperlegible", system-ui, -apple-system, sans-serif; text-align:center; }}
  img {{ width:120px; height:120px; border-radius:50%; border:3px solid #2d2a3e; }}
  a {{ color:#2d2a3e; font-weight:700; }}
</style></head>
<body><main><img src="/welcome/img/flower.png" alt=""><p>Opening Calm Companion…</p>
<p><a href="{target}">Tap here if nothing happens</a></p></main>
<script>setTimeout(function () {{ location.replace({target_js}); }}, 600);</script>
</body></html>
"""


def go_pages_and_qr():
    os.makedirs(os.path.join(HERE, "qr"), exist_ok=True)
    codes = {}
    for c, _ in CITIES:
        for s, _ in SPOTS:
            slug = f"{c}-{s}"
            target = utm("/", "sticker", "qr", slug)
            d = os.path.join(APP, "go", slug)
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, "index.html"), "w") as f:
                f.write(GO_PAGE.format(target=target.replace("&", "&amp;"), target_js='"' + target + '"'))
            q = QR(f"{BASE}/go/{slug}")
            with open(os.path.join(HERE, "qr", f"{slug}.svg"), "w") as f:
                f.write(q.svg())
            q.image(scale=20).save(os.path.join(HERE, "qr", f"{slug}.png"))
            codes[slug] = q
    return codes


# ---------------- sticker sheets ----------------
MM = 300 / 25.4          # px per mm at 300 dpi
STICKER_W, STICKER_H, BLEED, SAFE = 90, 55, 3, 4     # mm
INK = (45, 42, 62); PAPER = (255, 250, 241); LINE = (220, 230, 242); MARGIN = (242, 184, 198)
DISP = "/System/Library/Fonts/Supplemental/ChalkboardSE.ttc"
AMANDA = os.path.join(APP, "..", "social", "amanda", "amanda.png")


def px(mm):
    return int(round(mm * MM))


def wrap(draw, text, font, max_w):
    words, lines, line = text.split(), [], ""
    for w in words:
        t = (line + " " + w).strip()
        if draw.textlength(t, font=font) > max_w and line:
            lines.append(line); line = w
        else:
            line = t
    lines.append(line)
    return lines


TEXT_H_MM = STICKER_H - 2 * SAFE - 16      # room above Amanda


def fit(draw, slogan, max_w_px):
    """Largest font size (mm) whose wrapped slogan fits above Amanda."""
    for size in (5.6, 5.2, 4.8, 4.4, 4.0):
        f = ImageFont.truetype(DISP, px(size), index=2)
        lines = wrap(draw, slogan, f, max_w_px)
        if len(lines) * size * 1.25 <= TEXT_H_MM:
            return size, lines
    return size, lines


def sticker_png(slug, slogan, q):
    """One sticker incl. 3 mm bleed on every side, 300 dpi."""
    W, H = px(STICKER_W + 2 * BLEED), px(STICKER_H + 2 * BLEED)
    im = Image.new("RGB", (W, H), PAPER); d = ImageDraw.Draw(im)
    for y in range(px(BLEED + 8), H, px(6)):
        d.line([(0, y), (W, y)], fill=LINE, width=3)
    d.line([(px(BLEED + 9), 0), (px(BLEED + 9), H)], fill=MARGIN, width=5)
    x0, y0 = px(BLEED + SAFE), px(BLEED + SAFE)
    qr_mm = 34
    qr_img = q.image(scale=24, border=2).resize((px(qr_mm), px(qr_mm)), Image.NEAREST)
    qx, qy = px(BLEED + STICKER_W - SAFE - qr_mm), px(BLEED + (STICKER_H - qr_mm) / 2)
    d.rounded_rectangle([qx - 10, qy - 10, qx + px(qr_mm) + 10, qy + px(qr_mm) + 10], radius=28, fill=(255, 255, 255), outline=INK, width=7)
    im.paste(qr_img, (qx, qy))
    text_w = qx - x0 - px(5) - px(6)
    size, lines = fit(d, slogan, text_w)
    font = ImageFont.truetype(DISP, px(size), index=2)
    y = y0 + px(1)
    for line in lines:
        d.text((x0 + px(6), y), line, font=font, fill=INK); y += px(size * 1.25)
    small = ImageFont.truetype(DISP, px(3.4), index=1)
    if os.path.exists(AMANDA):
        a = Image.open(AMANDA).convert("RGBA").crop((180, 110, 820, 940)).resize((px(11), int(px(11) * 830 / 640)), Image.LANCZOS)
        im.paste(a, (x0 + px(5), px(BLEED + STICKER_H - SAFE) - a.height), a)
    d.text((x0 + px(18), px(BLEED + STICKER_H - SAFE - 5)), "Calm Companion", font=small, fill=INK)
    return im


def sticker_sheets(codes):
    os.makedirs(os.path.join(HERE, "stickers"), exist_ok=True)
    A4W, A4H = px(210), px(297)
    cell_w, cell_h = STICKER_W + 2 * BLEED, STICKER_H + 2 * BLEED
    cols, rows = 2, 4
    gx = (210 - cols * cell_w) / (cols + 1); gy = (297 - rows * cell_h) / (rows + 1)
    for c, cname in CITIES:
        sheet = Image.new("RGB", (A4W, A4H), (255, 255, 255)); d = ImageDraw.Draw(sheet)
        order = [s for s, _ in SPOTS] * 2
        for i, s in enumerate(order):
            slug = f"{c}-{s}"
            st = sticker_png(slug, SLOGANS[s], codes[slug])
            col, row = i % cols, i // cols
            x = px(gx + col * (cell_w + gx)); y = px(gy + row * (cell_h + gy))
            sheet.paste(st, (x, y))
            # cut line (magenta, dashed) on the 90x55 mm trim, 3 mm inside the bleed
            cx0, cy0 = x + px(BLEED), y + px(BLEED); cx1, cy1 = cx0 + px(STICKER_W), cy0 + px(STICKER_H)
            for (a, b) in [((cx0, cy0), (cx1, cy0)), ((cx1, cy0), (cx1, cy1)), ((cx1, cy1), (cx0, cy1)), ((cx0, cy1), (cx0, cy0))]:
                n = int(max(abs(b[0] - a[0]), abs(b[1] - a[1])) / 30)
                for k in range(0, n, 2):
                    p0 = (a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n)
                    p1 = (a[0] + (b[0] - a[0]) * (k + 1) / n, a[1] + (b[1] - a[1]) * (k + 1) / n)
                    d.line([p0, p1], fill=(236, 0, 140), width=3)
            st.save(os.path.join(HERE, "stickers", f"sticker-{slug}.png"), dpi=(300, 300))
        sheet.save(os.path.join(HERE, "stickers", f"sheet-{c}.pdf"), resolution=300)
        sheet.resize((A4W // 4, A4H // 4), Image.LANCZOS).save(os.path.join(HERE, "stickers", f"sheet-{c}-preview.png"))
        sticker_svg(c, cname, codes)


def sticker_svg(c, cname, codes):
    """Vector version of one city's stickers (one row per placement), with bleed and cut path."""
    parts, y = [], 0
    for s, sname in SPOTS:
        slug = f"{c}-{s}"; q = codes[slug]
        W, H = STICKER_W + 2 * BLEED, STICKER_H + 2 * BLEED
        n = q.size + 4; qs = 34 / n
        qx, qy = BLEED + STICKER_W - SAFE - 34, BLEED + (STICKER_H - 34) / 2
        lines = []
        tmp = Image.new("RGB", (10, 10)); dd = ImageDraw.Draw(tmp)
        size, wrapped = fit(dd, SLOGANS[s], px(qx - BLEED - SAFE - 11))
        for i, ln in enumerate(wrapped):
            lines.append(f'<text x="{BLEED + SAFE + 6}" y="{BLEED + SAFE + 1 + size + i * size * 1.25:.2f}" font-family="Gaegu, Chalkboard SE, cursive" font-weight="700" font-size="{size}" fill="#2D2A3E">{ln.replace("&", "&amp;")}</text>')
        parts.append(f'''<g id="{slug}" transform="translate(0 {y})">
  <rect width="{W}" height="{H}" fill="#FFFAF1"/>
  <line x1="{BLEED + 9}" y1="0" x2="{BLEED + 9}" y2="{H}" stroke="#F2B8C6" stroke-width="0.4"/>
  <rect x="{qx - 1}" y="{qy - 1}" width="36" height="36" rx="2.4" fill="#fff" stroke="#2D2A3E" stroke-width="0.6"/>
  <g transform="translate({qx} {qy}) scale({qs})"><path d="{q.svg_paths()}" fill="#2D2A3E"/></g>
  {"".join(lines)}
  <text x="{BLEED + SAFE + 6}" y="{BLEED + STICKER_H - SAFE - 1}" font-family="Gaegu, Chalkboard SE, cursive" font-size="3.4" fill="#2D2A3E">Calm Companion · {cname}</text>
  <rect id="cut-{slug}" x="{BLEED}" y="{BLEED}" width="{STICKER_W}" height="{STICKER_H}" rx="4" fill="none" stroke="#EC008C" stroke-width="0.25" stroke-dasharray="1.5 1"/>
</g>''')
        y += H + 6
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{STICKER_W + 2 * BLEED}mm" height="{y}mm" viewBox="0 0 {STICKER_W + 2 * BLEED} {y}">\n'
           f'<!-- Calm Companion stickers, {cname}. Units: mm. Trim 90x55 mm (magenta dashed = cut line, do not print), 3 mm bleed, 4 mm safe zone. Convert text to outlines before sending to print. -->\n'
           + "\n".join(parts) + "\n</svg>\n")
    with open(os.path.join(HERE, "stickers", f"stickers-{c}.svg"), "w") as f:
        f.write(svg)


if __name__ == "__main__":
    rows = tracking_links()
    codes = go_pages_and_qr()
    sticker_sheets(codes)
    print(f"{len(rows)} tracking links, {len(codes)} QR codes + go pages, {len(CITIES)} sticker sheets")
