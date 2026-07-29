# Product/QA Audit — 2026-07-29

A critical, "would I approve this for public release" pass over the live app: real first-time-user testing (cold cache, no persisted state), code inspection with no attachment to prior decisions, and root-cause investigation of anything that looked wrong — rather than assuming a fresh coat of paint or a plausible-sounding write-up would do.

One thing this audit did **not** do, on purpose: fabricate "thousands of simulated users" or invented beta-tester review quotes. That would be presenting made-up data as if it were real. What follows is real testing and real code reading, organized by the same personas the request asked for, but every claim below is something actually reproduced or actually read in the source — not guessed.

## Real bugs found and fixed

### 1. Settings sheet (and any modal sheet) could visually break under the autocomplete dropdown
**Severity: High** — this is a first-impression-breaking visual bug, not a taste issue.

`.ac-list` (the address-autocomplete dropdown) has `z-index: 60`; `.settings-overlay` has `z-index: 30`. If a user taps Settings while an autocomplete suggestion list is still open (a completely normal sequence — tap an address field, then tap the gear icon before picking a suggestion), the dropdown rendered visually **on top of** the settings sheet instead of behind it, with its own opaque, bordered "Use my current location" card overlapping the sheet's own heading and body text. Reproduced live, confirmed via computed styles (`z-index: 60` vs `30`), and confirmed fixed live afterward.

**Fix**: `openSettings()` now explicitly closes both address autocomplete controllers before opening the sheet, since the dropdown genuinely shouldn't be visible at all while a modal has focus — the right fix is closing it, not just reshuffling z-index numbers against each other (the dropdown legitimately needs a high z-index to sit above ordinary page content in its normal state). `app.js`.

### 2. Misleading error message when both address fields fail to resolve
**Severity: Medium** — a real "wait, did this work or not?" moment.

Typing garbage into both the start and destination fields and searching shows: "Couldn't find either place — check the spelling, or try a nearby landmark." Directly below that error, the map and full route-time estimates for the *previous* search still render — because the app deliberately falls back to the last-known-good locations rather than doing nothing (a sensible design). The problem: the two single-field failure messages already say "kept the previous start/destination location instead," but the both-failed message didn't, making it the one case where a route confidently appears right under an error that gives no indication why.

**Fix**: the both-failed message now matches the other two, explicitly stating "Kept the previous start and destination instead." `app.js`.

## Investigated and ruled out (false alarms — reported here for transparency, not padding)

- **Dozens of duplicate "GraphHopper error 404" console warnings on cold load.** Turned out to be an artifact of testing against a plain `python3 -m http.server` (no Cloudflare Functions runtime, so `/api/route` 404s against Python's own error page) instead of `wrangler pages dev` (this project's documented correct local-testing method). Switched to `wrangler pages dev`, and the warnings disappeared entirely under a genuinely clean load.
- **What looked like 14 duplicate routing calls from a single "Find calm route" click.** Directly instrumented `console.warn` with captured stack traces to check — exactly **one** real call happens per search, from the expected code path (`fetchCalmRoute` → `runSearch`). The apparent duplication was the browser-automation console-reading tool over-reporting in this specific dev environment, not the app. Confirmed via direct instrumentation before writing this down, specifically to avoid reporting a fabricated bug.
- **A 2×2 tiled/repeated screenshot of the full-screen nav view.** DOM inspection at the moment of the glitch showed exactly one `#map`, one `.nav-top-card`, one `.leaflet-container` — no duplication in the actual page. A second screenshot taken moments later rendered cleanly. Concluded this was a one-off capture glitch in the screenshot tool itself, not a rendering bug in the app.

## Investigated and judged not a bug (disclosed design observation, not silently changed)

**The "Dark" appearance (and the system-dark fallback shown to any first-time visitor with an OS-level dark preference) is an unconventional olive-green/salmon palette, not the near-black/blue-gray most users expect from "Dark mode."** On first look this read as broken/muddy. It is not: the exact same palette (just inverted lightness) is used consistently in the Light theme too — this is deliberate, existing brand styling (calm/nature-themed), not a copy-paste error or leftover value. Checked objectively rather than going on first impression: every key text/background pairing (body text, button text, subtitle text, icon-on-surface) passes WCAG AA, several comfortably clear AAA (calculated contrast ratios ranged 5.35:1–12.85:1). This is a legitimate branding/taste call, not a functional defect — flagged here for the person who owns this product to weigh in on, not overridden unilaterally.

## What was checked and found solid

- Full route search → error handling → start/stop navigation, re-verified end to end after both fixes above (walking + simulated GPS)
- Settings sheet: preset/mode/soundscape pickers, accessibility toggles, appearance switching (Light/Dark/Flow) — all functionally correct
- Auditory regulation and Haptic fidgeting pages — clear onboarding copy, no console errors, accessible kalimba tine markup (`role="group"`, per-key `aria-label`s) already in place
- Empty-input and invalid-address handling doesn't crash, degrades gracefully with clear (now corrected) messaging
- `npm test` — 257/257 passing after all changes

## Not achievable in this environment (disclosed, not glossed over)

- No real device testing (iOS/Android), no real walking/cycling test, no real GPS drift/weak-signal conditions, no real battery/CPU profiling, no VoiceOver/TalkBack pass — consistent with every other disclosed limitation in this project's other feature docs.
- No access to real user reviews or real beta-tester feedback — everything above came from direct testing and code reading in this session, not simulated "thousands of users."

## Verdict

Would ship the two fixes above without hesitation — both are real, both are now verified fixed. Would **not** claim "ready for a million downloads tomorrow" without the device/accessibility testing listed above, which is a hard limitation of this environment, not a corner cut. The unconventional dark-theme palette is worth a real design review with actual users before a public launch, even though it isn't a functional bug.
