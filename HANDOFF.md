# Developer Handoff — Calm Navigation Companion

Short version: this is a static site with two small serverless functions. No build step, no framework, no database. If you've used `git` and a terminal, you can run this in under a minute.

## How to run it

```bash
cd calm-navigation-companion
npm run dev      # wrangler pages dev . — real GraphHopper routing, needs .dev.vars (copy .dev.vars.example, add a key)
npm run serve    # python3 -m http.server — no live routing, always demo mode, zero setup
npm test         # 39 unit tests, ~0.3s, no network
```

Open `http://localhost:8743`.

## How to deploy it

```bash
npm run deploy    # wrangler pages deploy .
```

That's it — no build, no CI needed for a one-person project. It ships the working tree as-is. Confirm the API key secret is still set (`npx wrangler pages secret list --project-name=calm-navigation-companion`) — it's a one-time setup per Cloudflare project, not something `deploy` touches.

Live URL: **https://calm-navigation-companion.pages.dev**

## How to maintain it

1. Run `npm test` before every deploy. It's fast — there's no excuse to skip it.
2. After deploying, do a real smoke test: load the live URL, search a route, check the browser console for errors. `curl`ing a couple of files is a fast sanity check that a deploy actually landed:
   ```bash
   curl -s https://calm-navigation-companion.pages.dev/app.js | md5   # compare to local `md5 app.js`
   ```
3. Never let `config.js` grow a secret again. If you ever need a new third-party API key, it goes in a Cloudflare Pages Function + `wrangler pages secret put`, the same pattern as `functions/api/route.js`. Client-side `config.js` is committed to git — treat anything in it as public.
4. `PROJECT_STATUS.md` is the running "what's actually true right now" doc — update it, not just this file, whenever you fix something nontrivial. It has a dated audit log at the bottom worth continuing rather than replacing.

## How to add new features

- **New routing/scoring logic** → `routing.js`. It's a pure module (Node-testable via `routing.test.js`), no DOM. Keep it that way.
- **New navigation behavior** (off-route rules, arrival, step logic) → `navlogic.js`. This is the one file in the project that must stay 100% dependency-free (no DOM, no fetch, no `window`) — that's what makes `navlogic.test.js` possible without a browser. If a change needs the DOM, it belongs in `app.js` calling into `navlogic.js`, not inside it.
- **New sounds** → `ambientengine.js`, following the existing `_xLayer(level)` pattern (return `{ gain, stop() }`). Everything is synthesized (oscillators/noise buffers) — no audio files are used anywhere in this project; don't be the one to add the first one without checking with Antonio first, it's a deliberate constraint (see `README.md`'s "café" explanation).
- **New vibration patterns** → `patternlibrary.js` (pure data), wired up via `hapticmanager.js`.
- **New settings** → add to `prefs.js`'s `DEFAULTS`, read/write through `Prefs.get()`/`Prefs.set()`, never touch `localStorage` directly from `app.js`.
- **New UI** → `index.html` + `app.js` + `style.css`. Use the existing CSS custom properties (`--accent`, `--calm`, `--surface`, etc. — see the top of `style.css`, defined once per theme) instead of hardcoding colors.
- Whatever you add: if it's logic (not DOM wiring), consider whether it can be a pure function and get a test file. Four small `*.test.js` files already exist as the pattern to copy.

## Which files matter most

In order of "understand this before touching anything nearby":

1. **`navlogic.js`** — the actual navigation brain. Everything about off-route detection, rerouting, and arrival lives here as pure, tested logic.
2. **`routing.js`** — how routes get scored and how the app degrades to demo mode. The proxy contract (`/api/route`, `/api/geocode`) is defined by what this file sends.
3. **`app.js`** — the biggest file, DOM glue for all three pillars. Read its section header comments (`// --- PILLAR 1 ---` etc.) before making a change; it's organized, not a dumping ground.
4. **`functions/api/route.js` / `geocode.js`** — the entire security boundary for the API key. Small and simple on purpose; resist the urge to make these "smarter."
5. **`PROJECT_STATUS.md`** — not code, but read it first. It's the single source of truth for what's actually done vs. known-incomplete vs. deliberately out of scope.

## Which modules should not be modified without understanding their dependencies

- **`navlogic.js`**: consumed by both `app.js` (browser) and `navlogic.test.js` (Node) via the same file — it detects its environment via `typeof module`. Don't add a `window`/`document` reference here; it will silently break the Node test path with a confusing error, not an obvious one.
- **`prefs.js`**: `audiomanager.js`, `hapticmanager.js`, and `app.js` all read/write through the single `Prefs` instance created once in `app.js`. Don't instantiate a second `Prefs()` anywhere — it would desync from the one actually driving the UI.
- **`audiomanager.js`**: every audio engine (`ambientengine.js`, `voiceengine.js`, `effectsengine.js`) shares its single `AudioContext` and three buses. Adding a second `AudioContext` anywhere will break ducking/volume coordination in ways that are easy to cause and hard to trace back.
- **`functions/api/*.js`**: these run on Cloudflare's edge, not in the browser — no `window`, no `localStorage`, no DOM. `context.env.GRAPHHOPPER_API_KEY` is the only place the real key exists at runtime. Never log the full request URL after the key is appended (it isn't currently, keep it that way).
- **`sw.js`**: its `APP_SHELL` cache list is a manually maintained array of filenames. If you add a new top-level `.js`/`.css` file that `index.html` loads, add it here too, or returning visitors on a flaky connection won't get it from cache. There's no build step to auto-generate this list.

## One last check

Before you consider a change "done": run `npm test`, then actually open the app in a browser and click through a real search — the DOM-wiring layer (`app.js`) has zero automated coverage, so "the tests pass" is necessary but not sufficient.
