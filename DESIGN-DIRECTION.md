# Calm Navigation Companion — design direction

**Set 2026-09-03,** applying the `frontend-design` skill. Supersedes the palette
introduced in `REDESIGN_2026-07-29.md`, which is kept for its component and
layout decisions — only colour and type changed here.

## Why it changed

The old palette was cream `#FAF9F6`, Fraunces (a high-contrast serif) for
display, `#FF8A65` terracotta for accent, Inter for body. That is, precisely,
the look AI-generated design defaults to. The `style.css` comments said where
it came from: *"matching the reference's hero-text and primary-CTA treatment"*
and *"the same hierarchy the reference site uses in its own hero."* The palette
was derived from a reference site rather than from this app's subject.

The calm, low-stimulation **direction** was never the problem — it is grounded
in the research and it stands. The execution was a default.

## The direction now

**A mid-tone ground.** Not cream, not near-black. Both glare at someone already
near their sensory limit, and both are AI defaults. Cards sit *lighter* than the
page, inverted from convention. This is the one real risk in the design and it
is taken deliberately: high luminance contrast is hostile to this audience.

| Token | Light | Role |
|---|---|---|
| `--bg` | `#D7DDE0` | Amsterdam haze. The ground |
| `--surface` | `#EAEEEF` | Raised — lighter than the ground |
| `--ink` | `#232B30` | Deep blue-grey, never black |
| `--accent` | `#7E5628` | Brass. The kalimba tine |
| `--calm` | `#35604A` | Moss. Quiet routes, green space |
| `--busy` | `#8E4029` | Amsterdam brick. Busy streets |

Dark mode is warm slate (`#171B1D`), not the old indigo-black.
**Flow Mode is untouched** — it is a separately specced, deliberately
"organic/mesmerising" appearance and is already distinctive.

## Type

- **Body: Atkinson Hyperlegible.** Braille Institute, letterforms disambiguated
  for low vision. A justified choice for a sensory-accessibility app, not a
  taste one. Replaces Inter.
- **Display: Bricolage Grotesque.** Personality without a high-contrast serif.
- **Data: IBM Plex Mono**, tabular figures — distances, ETAs, times. Glanced at
  mid-walk, never read as prose.

## Signature: the calm ribbon

`.breakdown-bar` was a 7px decorative sliver. It is the only element that shows
the whole walk at once, every segment a real measured road class, so it is now
where the design spends its boldness: 16px, hairline seams, countable — the way
the kalimba's tines are countable. A smooth gradient would look more premium and
would hide the information the walker needs.

The road-class ramp in `app.js` was retuned from a stock green→amber→red risk
scale to the app's own hues (moss → brass → brick), so a segment is the same
colour language as the route line, not a second scale to learn. Segments are
ordered quietest-first and the bar carries an `aria-label` naming the four
biggest surfaces — previously a screen reader got a row of empty spans.

## Retired

`--gradient-accent`, a 3-stop calm→sky→accent gradient doing decorative work on
four unrelated controls, and the gradient-clipped `<h1>`. A gradient accent is
the default "premium" move.

## Bug found and fixed en route

`prefers-reduced-motion` was **not working at all.** The rule was written as a
selector list with an at-rule inside it, which the CSS parser discards whole —
verified in a browser: the old snippet parses to **0 rules**. Only the in-app
motion toggle worked. Anyone who set Reduce Motion at the OS level got all 15
keyframe animations at full strength, in an app built for sensory sensitivity.

## Verified, not assumed

Every semantic colour measured in a live browser against its own ground:
ink 10.49, ink-soft 5.51, calm 5.24, busy 5.25, accent 4.71, muted 4.93,
white-on-accent 6.46 — all ≥ 4.5:1. Full suite: 293/293 passing.
