# Navigation UX/Interaction Polish

Added 2026-07-29. A full usability, interaction, animation, and layout pass over turn-by-turn navigation mode — full-screen map, floating glass cards, smart auto-hiding controls, camera/marker intelligence, and animated route rendering — while preserving every existing feature (voice guidance, haptics, rerouting, background nav, Calm Echoes, Flow Mode).

## What changed

**Full-screen navigation.** Starting a route now hides the header, footer, and page-dots (`.app-shell.nav-fullscreen`) and the map grows from its normal card size to `100dvh` via the same CSS `height`-transition mechanism the app already used for its previous, smaller (62vh) nav height — just raised to fill the whole viewport. The route stays visible and interactive throughout the transition; nothing unmounts or flashes to black.

**Floating glass UI.** The old fixed "banner" and "bottom bar" are now two floating cards (`.nav-top-card`, `.nav-controls-card`) with `backdrop-filter` glass, positioned with `env(safe-area-inset-*)` so they clear the Dynamic Island/notch, home indicator, and Android cutouts in both orientations. The top card shows only next maneuver, distance, street name, ETA, and arrival clock. The bottom card holds exactly 5 controls — Stop, Mute, Haptic toggle, Recenter, Settings — each a 44×44pt touch target.

**Smart controls.** The bottom card fades and lifts out of the way after 6 seconds of inactivity and reappears on any tap/drag; the top card and map are never affected by this, so navigation info is always visible even while controls are hidden.

**Camera and marker intelligence.** The user marker interpolates smoothly between GPS fixes (`NavLogic.lerpLatLon`, 450ms tween) instead of jumping, heading is exponentially smoothed (`NavLogic.smoothHeading`) to kill compass jitter, and the camera leads slightly ahead of the user's direction of travel (`NavLogic.destinationPoint`, mode-aware look-ahead distance) rather than centering exactly on the dot. Panning the map manually suspends auto-follow and automatically resumes it after 12 seconds idle. The accuracy ring's opacity reflects reported GPS accuracy.

**Animated route rendering.** The calm route draws on with an SVG stroke-dashoffset animation instead of appearing instantly; a reroute cross-fades the old line out while the new one draws in, instead of a hard cut. The arrival screen fades and scales in rather than snapping to visible.

**Design tokens.** Added formal `--secondary`/`--success`/`--warning`/`--danger`/`--surface`/`--glass`/`--border` custom properties to every theme block (Light, Dark, Flow, both High-Contrast variants) so color usage is consistent and themeable rather than ad hoc.

## Files modified

- `app.js` — marker tweening/heading smoothing, camera look-ahead + auto-return-to-follow, smart-controls timer, route draw-on/crossfade animation, arrival-screen entrance class, nav card element wiring (mute/haptic/settings buttons moved into the unified control bar), `initTheme()` reordering (see Bugs found below), a `ResizeObserver` keeping Leaflet's tile grid in sync with the map's animated container size
- `navlogic.js` / `navlogic.test.js` — three new pure functions: `lerpLatLon`, `smoothHeading`, `destinationPoint` (10 new tests)
- `style.css` — full nav-card redesign (`.nav-top-card`, `.nav-controls-card`, `.nav-control-btn`), full-screen mode rules, safe-area padding, formal design tokens across every theme block, Reduced Transparency support, dev-only sim-badge repositioning
- `index.html` — `viewport-fit=cover`, restructured nav markup (unified control bar, new street-name/arrival-clock/haptic/settings elements)

No new files/components were created — this pass is entirely a redesign of the existing navigation markup, styling, and interaction logic.

## Bugs found and fixed during manual testing

This pass surfaced four real, pre-existing-or-newly-introduced bugs that would have shipped broken without a live browser verification pass — none of these were visible from reading the code alone:

1. **Theme-init crash for any returning visitor with a persisted theme.** `initTheme()` was called before `map`/`tileLayer` existed (a `const`/`let` temporal-dead-zone `ReferenceError`), silently halting the entire script before route inputs, map tiles, or anything else initialized. A second, identical crash existed one level deeper (`setNightMode()` needing `prefs`/`audioManager`, also declared later). Fixed by moving the single `initTheme()` call to the very end of the file, after every dependency exists.
2. **Top card layout broken by a leftover inline style.** `index.html` still had a static `style="display:none;"` on the nav cards from before this redesign (when JS toggled visibility directly); inline styles beat any CSS rule regardless of specificity, so the intended `.page-inner.nav-active .nav-top-card { display: block; }` rule never applied, and the maneuver row and ETA/arrival-time row rendered as an overlapping single flex row instead of two stacked rows. Fixed by removing the inline attributes and moving visibility fully to CSS.
3. **Leaflet's tile grid going gray below the fold in full-screen mode**, confirmed as a real, deterministic bug (not test noise) via repeated clean-reload testing. Root cause: `#map`'s nav-active height was `100%` of a parent (`.map-wrap`) that was *also* mid-transition, and `.map-wrap`'s own base height was never explicitly set (`auto`), so neither element ever fired a clean, resolvable `transitionend` — any timing-based `invalidateSize()` call (even a retry ladder spread across 1.6s) was measurably flaky. Fixed properly with a `ResizeObserver` on `.map-wrap` that calls `invalidateSize()` on every real layout-size change, which is the standard technique for Leaflet living inside an animated container, and converged reliably across repeated clean tests.
4. **Service worker repeatedly serving stale `app.js`/`style.css`/`index.html`** during this same testing session — the project's own previously-documented cache-name-bump rule, re-applied five more times (v4→v13) as each of the above fixes landed.

## Accessibility

- Reduced Motion: full-screen transition and route draw-on both collapse via the existing global `data-motion="reduced"` mechanism.
- High Contrast: `backdrop-filter` is disabled and cards fall back to solid `--surface` backgrounds; verified visually — strong text contrast, no glass artifacts.
- Reduced Transparency (`prefers-reduced-transparency`): same solid-background fallback, applied automatically.
- `aria-live="polite"` on the instruction and street-name text so VoiceOver/TalkBack users hear maneuver changes without needing spoken voice guidance enabled.
- All 5 control buttons are real `<button>` elements with `aria-label`s and meet the 44×44pt minimum touch target.

## Performance

- Marker tweening and camera panning use `requestAnimationFrame`/Leaflet's own animated `setView`, not per-frame JS layout reads.
- Smart-controls fade is a single `opacity`/`transform` toggle on one element, not per-frame work.
- Route draw-on is a single CSS transition on an SVG attribute, GPU-friendly, no JS animation loop.

## Remaining limitations (disclosed)

- **No true compass-up map rotation or 3D pitch.** Leaflet has no native rotation/pitch support without an additional plugin, which this zero-dependency, zero-build project deliberately doesn't add. The user-location *marker* rotates to show heading; the map itself stays north-up. This was flagged as a hard platform limit before this pass began, not discovered mid-way.
- **Not verified on a real device.** All testing was done in a desktop-sized browser viewport (with `resize_window` used to spot-check landscape/tablet-ish sizes) plus the dev-only GPS simulator (`?simulate=1`) — no real walking/cycling test, no real GPS jitter, no real battery/CPU profiling, no VoiceOver/TalkBack pass on an actual phone. This is the same disclosed gap every prior feature doc in this project (`FLOW_MODE.md`, `CALM_ECHOES.md`) has flagged.
- **Manual pinch/rotate/long-press gesture testing wasn't exercised live** — Leaflet's own default touch handlers were left in place (not modified by this pass) and are already covered by the pre-existing `gestureengine.js` test suite for the app's own custom gesture layer; this pass didn't add or change any gesture handling.
- **GraphHopper routing isn't configured in this local dev environment**, so the app runs in its own documented demo-route fallback mode during testing — expected, unrelated to this pass.

## Manual testing checklist (completed this session)

- [x] Full route search → start nav → full-screen transition → floating cards render correctly stacked
- [x] Smart controls: auto-hide after idle, reveal on tap
- [x] Camera follows simulated GPS movement with smoothed heading/marker tween
- [x] Route renders/animates correctly; tiles fully load after the full-screen resize (verified across multiple clean reload cycles)
- [x] Stop navigation → clean return to normal view, no leftover state
- [x] Light theme + High Contrast + Reduced Motion combination, in nav mode
- [x] Flow theme, in nav mode
- [x] Landscape/short-viewport (800×400) layout
- [x] `npm test` — 257/257 passing
- [ ] Real device (iOS/Android), real walking/cycling, VoiceOver/TalkBack, battery profiling — not achievable in this environment

## Production readiness score: 6/10

Calibrated against "a coursework Design Thinking prototype," consistent with this project's other feature docs — not a funded, venture-scale launch bar.

**Solid**: full-screen mode, floating cards, smart controls, camera/marker smoothing, and route animation are all verified live and working correctly, including after finding and fixing four real bugs (one of which — the theme-init crash — would have broken the app entirely for any returning visitor). Design tokens are now consistent across all theme combinations.

**Not solid enough for a real launch without further work**: no real-device testing of any kind, no compass-up rotation, no accessibility audit beyond what's checkable in a desktop browser (no real screen-reader pass).
