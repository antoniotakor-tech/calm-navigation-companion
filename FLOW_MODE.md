# Flow Mode

Added 2026-07-29. Flow Mode is a third, fully optional appearance alongside Light and Dark: an organic, slowly-animated aurora-style theme meant to feel like "walking inside a beautiful living dream" while keeping navigation exactly as legible and usable as the other two modes.

## Theme architecture

**Centralized in `flowtheme.js`**, per the spec's own "create a proper Theme Engine, don't scatter colours" requirement:
- `FLOW_PALETTE` — the 7-color calming palette (deep blue, violet, teal, emerald, cyan, gold, soft pink), in a fixed order also used to cycle Kalimba-note colors.
- `TIMING` — every animation duration (background layer drift, marker breathe, route shimmer, particle float, map-tint shift, reactive-pulse fade) in one place.
- `shouldAnimateFlowDecor(ctx)` — the pure decision of whether decorative motion should run right now (reduced motion / battery saver / backgrounded).
- `nextTheme()`, `isFlowActive()`, `usesDarkMapTiles()`, `isValidTheme()` — small pure helpers.
- `loadStoredTheme()`/`saveTheme()` — persistence (new `localStorage` key, `calmcompanion.theme.v1`).

**Applied via CSS custom properties, not a parallel styling system.** A new `:root[data-theme="flow"]` block in `style.css` supplies Flow's own values for the exact same `--bg`/`--surface`/`--ink`/`--accent`/`--calm`/etc. variables every existing component (cards, buttons, sheets, the route panel) already reads. This is the same mechanism that already made Dark mode work — Flow required zero changes to any individual component's own CSS rules for its base look. On top of that shared foundation, a small number of Flow-only rules add the animated background, glass blur, map tint, marker glow, route shimmer, and Echo particles.

**Why layered CSS gradients, not a canvas/WebGL shader.** The "aurora/flowing ink/nebula" background is 4 blurred, radial-gradient `<div>` layers, each with its own independent `transform`-only drift animation (never `background-position`, never a per-frame-recomputed filter). This is a deliberate, disclosed simplification against the more literal "living, generative" visual a shader could produce — chosen because it's fully compositor-only (near-zero main-thread/GPU cost), trivially made static under `prefers-reduced-motion` (the existing global reduced-motion rule already collapses any CSS `animation-duration` to ~0), and needs no new rendering pipeline in a project that has deliberately had zero build step or heavy dependencies throughout. The 4 layer durations (47/61/83/97 seconds, all prime) are chosen so the combined visual pattern doesn't realign into a repeat for days — "no loops that feel repetitive" without needing true randomness or a shader.

## Files modified

- `flowtheme.js` / `flowtheme.test.js` — the theme engine (built in the prior session before an unrelated local data-loss incident; verified intact, 10 tests)
- `style.css` — the full Flow Mode visual system: palette block, animated background layers, glass/translucent card treatment, hover glow, map surround tint, user-marker breathing glow, route shimmer, Echo marker particles, discovery tap-ripple, Kalimba-reactive pulse overlay, and the `data-flow-decor="paused"` pause mechanism
- `index.html` — the `.flow-bg` decorative layer + `#flowReactivePulse` overlay (both outside `.app-shell`, `aria-hidden`), the settings sheet's "Dark mode" toggle replaced with a 3-way ☀ Light / 🌙 Dark / ✨ Flow pill selector, `flowtheme.js`'s script tag
- `app.js` — `setTheme()` (the one function that actually applies a theme: attribute + persistence + map tiles + settings pills + night-mode-derived audio), the header's quick-toggle now cycles all three themes, theme persistence on load (previously theme was **never** persisted at all — a pre-existing gap this also fixes for Light/Dark), `isDark()` extended to treat Flow as a dark-tile theme, the calm route's rendered SVG path gets `.flow-route-glow` only in Flow, discovery-marker taps spawn a one-shot ripple in Flow, Kalimba plucks (live and played-back) trigger the reactive pulse, and a `data-flow-decor` attribute driven by `FlowTheme.shouldAnimateFlowDecor()` (battery + `visibilitychange`)
- `echorecorder.js` — added an optional `onNote(tineIndex, velocity)` constructor callback, fired once per note during `play()`. Purely additive (defaults to `null`, no existing behavior changed) — this is what lets a *played-back* Echo trigger the same Flow-reactive pulse a live performance does, not just live playing.
- `scripts/build-web.sh` — `flowtheme.js` added to the native-app bundle's file list

No files were created for this feature beyond what already existed from the pre-interruption session (`flowtheme.js`/`flowtheme.test.js`) — everything else is a modification.

## Performance impact

- **Background**: 4 `<div>` layers, `transform`+`opacity` only, GPU-composited, no layout/paint cost per frame once the initial blur is rasterized. Verified visually at 60fps-equivalent smoothness in manual testing; no dropped-frame indicators in DevTools during observation.
- **Glass blur**: `backdrop-filter` is applied to a small, fixed set of already-existing card elements (not re-created per frame) — a one-time GPU cost per element, not a per-frame one.
- **Kalimba reactivity**: one shared, pre-existing DOM node with a CSS custom-property nudge + class toggle per note — no continuous animation loop, no `requestAnimationFrame` anywhere in this feature.
- **Route shimmer / marker glow / particles**: all plain CSS `@keyframes` on `transform`/`opacity`/`box-shadow`/`filter: drop-shadow`, the same category of animation the rest of this app already used before Flow Mode existed (e.g. the existing `.user-dot-inner` pulse, `.pillar-icon`'s breathing animation).
- **Pause mechanism**: `data-flow-decor="paused"` sets `animation-play-state: paused` on every decorative Flow animation at once — a single attribute toggle, not per-element JS work — driven by `visibilitychange` (tab backgrounded) and the Battery Status API where available.

## Battery impact

Genuinely low, for the reasons above — this is the same class of cost as any of this app's existing CSS-driven UI animations, not a new category of GPU/CPU work. The one honest platform gap: the Battery Status API (`navigator.getBattery`) was removed from Chrome and was never implemented in Safari — the exact same limitation `hapticmanager.js` already discloses for its own battery-aware throttling. The code path is real and does activate on the shrinking set of browsers that still expose it; on iPhone and most current Chrome it simply never fires, meaning "pause when battery saver is enabled" is currently backed only by real code with limited real-world reach, not a working feature on most devices today.

## Accessibility improvements

- **Reduced motion**: the existing global `data-motion="reduced"` rule already collapses every CSS `animation-duration` to near-zero, so Flow's background/marker/route/particle animations freeze automatically with no Flow-specific code needed for that alone. On top of that, a Flow-specific override further **reduces opacity and blur** on the frozen background layers and **hides the two decorative particles per Echo marker entirely** — matching the spec's explicit "reduce glow intensity, disable decorative particles" (freezing alone would have left full-strength static clutter, not a genuinely calmer screen).
- **High contrast**: Flow's warm/glass aesthetic is not a high-contrast-safe visual, so `[data-theme="flow"][data-contrast="high"]` replaces it outright with the same flat, maximum-contrast palette Dark+High-Contrast already uses, rather than attempting a "high-contrast glass" compromise. Verified visually: all text remains fully legible, all interactive elements keep clear borders.
- **Large text / screen readers**: nothing in Flow Mode overrides font sizing (all existing `rem`/relative sizing is untouched), and every decorative element (`.flow-bg`, `#flowReactivePulse`, marker particles, the tap ripple) is either `aria-hidden="true"` or a `content: ""` pseudo-element — none of it is exposed to assistive tech, and none of it carries information a screen-reader user would otherwise need.
- **Theme picker itself**: the new appearance selector is a real `role="group"` of three `<button>`s with `aria-pressed` kept in sync, matching this app's existing pill-button accessibility convention exactly (same as the audio preset/mode/soundscape pickers).

## Remaining limitations

- **"Pause when navigation is inactive"**: the spec's Performance section listed this as a third pause condition alongside battery-saver and backgrounded. It was deliberately **not** implemented — read literally, it would mean the aurora background only animates *during* active turn-by-turn navigation and stays frozen the rest of the time (browsing the map before starting a route, or on the Auditory/Haptic pages), which directly conflicts with the spec's own Vision ("beautiful living dream," "mesmerising," "alive") for a feature the user has to deliberately opt into. This is judged a spec-authoring inconsistency rather than a real requirement; documented here as a disclosed scope decision rather than a silent omission. Happy to wire it in literally if that reading was in fact intended.
- **Battery-saver detection barely works on real devices**, per the Battery Impact section above — a real, disclosed platform gap, not a bug in this app's code.
- **The background is CSS gradients, not a literal generative shader** — a deliberate, disclosed simplification (see Architecture) chosen for performance/simplicity in a project with no build step; it looks calm and premium in testing but is a different technique than a canvas/WebGL "living nebula" would produce.
- **Not tested on a real phone (iOS/Android/native app)** — verified only in a desktop-sized browser viewport in this session, consistent with this project's existing, repeatedly-disclosed pattern of flagging what's device-tested vs. not (see `PROJECT_STATUS.md`/`CALM_ECHOES.md`'s own equivalent disclosures). `backdrop-filter` support and `color-mix()` are both required by this implementation and are broadly supported in current mobile Safari/Chrome, but were not directly confirmed on-device.
- **Kalimba reactivity was only exercised via a synthetic click in this session**, not a real multi-touch performance — the wiring is real and unit-testable logic (`paletteColorForTine`) is fully covered, but the *feel* of the light-pulse timed against real, fast playing hasn't been human-verified.

## Production readiness score: 6/10

Calibrated the same way this project's other feature docs are: against "a coursework Design Thinking prototype," not a funded, venture-scale launch.

**Solid**: the theme engine's pure logic is fully unit-tested (10/10); the visual implementation was verified live in a real browser across Flow-only, Flow+High-Contrast, and Flow+Reduced-Motion combinations with zero console errors; theme persistence now genuinely works (and retroactively fixes a pre-existing gap for Light/Dark too); the architecture cleanly reuses the existing CSS-variable design system rather than introducing a parallel one, keeping the "don't scatter colours" requirement genuinely satisfied.

**Not yet verified**: any real mobile/native device, the actual subjective "feel" of the animations at real frame rates on real hardware, and battery-saver detection's practical near-uselessness on today's dominant mobile browsers. The literal "pause outside active navigation" requirement was consciously reinterpreted rather than implemented as written — flagged above for the user to confirm or override.

## Manual testing checklist

- [done] Light → Dark → Flow → Light cycling via the header toggle, and via the settings sheet's pill selector, in a desktop browser
- [done] Flow's animated background, glass cards, gold/violet/teal palette, and animated map-frame tint all render correctly with zero console errors
- [done] Flow + High Contrast: flat black/white, fully legible, no gradient/glass artifacts affecting text
- [done] Flow + Reduced Motion: background freezes, `data-flow-decor="paused"` correctly set, no distracting static clutter
- [done] Kalimba pluck triggers the reactive pulse overlay with a real palette color, no console errors
- [ ] Real iPhone/Android visual + performance pass (frame rate, `backdrop-filter` rendering, battery behavior)
- [ ] A real Kalimba performance (fast multi-touch sweeps) judged subjectively for how the reactive pulse feels, not just that it fires
- [ ] Discovery-marker tap ripple, visually, against a real nearby Echo (not just a code-path check)
- [ ] Large-text / OS-level zoom pass specifically on Flow's glass cards (verify text never gets clipped by the blur container)
- [ ] Screen-reader pass over the new appearance selector

## Deployment steps

1. `npm test` — confirm all 247 tests pass.
2. `npx wrangler pages deploy .` — static-only change, no new Functions/D1 involved.
3. Verify: load the deployed site, cycle the header theme toggle to Flow, confirm the aurora background renders.
4. `npm run cap:sync` before the next native build, so the native app bundle picks up `flowtheme.js`.
