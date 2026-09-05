# The core journeys, measured for a keyboard and a screen reader

Captain's audit J37, section 5.5: the essential journeys must work keyboard-only,
with a screen reader and under reduced motion, and none of it had been tested.
This is the measurement, the findings and what was changed.

Measured 5 September 2026 against a local production build (`next build` plus
`next start`, keyless), Chromium, `@axe-core/playwright`. Before and after are
two separate builds of two separate trees on two ports, so the comparison is
measured rather than remembered.

## What was run

- **axe-core** on `/`, `/map?sel=<venue>`, `/tonight`, `/today`, `/plan`,
  `/plan/<id>` as host and as an uninvited guest, `/moment` and `/u/you`, each at
  390 and 1440, in light and dark, always under `prefers-reduced-motion: reduce`.
  That is 36 measured surfaces.
- **The loop, driven by keyboard alone**: discover a venue, plan an outing,
  share and join, contribute a price. Nothing in that spec clicks a journey step.
- **Reduced motion**: no content left invisible or parked off its place by a
  suppressed entrance.

## Findings, before

Nineteen serious violations over seven distinct defects. No criticals.

| Selector | Rule | Impact | Surfaces hit | Routes |
|---|---|---|---|---|
| `.kicker` | color-contrast | serious | 4 | /plan, /moment |
| `.screenHead > .kicker` | color-contrast | serious | 2 | / |
| `.cityChooserReleaseBadge` | color-contrast | serious | 4 | / |
| `.cityChooserLocate` | color-contrast | serious | 2 | / |
| `.cityChooserSearchInput` | color-contrast | serious | 2 | / |
| `.venueHygieneSource` | color-contrast | serious | 1 | /map |
| `.dropStripRail` | scrollable-region-focusable | serious | 4 | / |

Two more were found by driving the surfaces rather than by axe, which tests
neither:

- **The map's drink filter had no visible focus at all.** An inline
  `outline: "none"` in `FavoritePintPicker.tsx` outranks every stylesheet rule,
  so it silently killed the global `:focus-visible` ring. The same control
  measured 179x22, under the 24px WCAG 2.5.8 floor.
- **The city chooser's search field showed a 22%-alpha ring** where every other
  control on the page wears a 2px solid one.

## The one cause behind six of them

`--brass`, the coral accent, used as TEXT on a light surface. It reads **2.49:1
on the recessed panel, 2.75:1 on the page and 2.91:1 on a card** — below AA
everywhere in light, while passing comfortably in dark (5.32:1 to 6.48:1). Every
coral word on a light surface was failing, and each had been fixed nowhere
because nobody had measured the set.

So the fix is one token, not six patches. `--brass-ink` (`--color-accent-ink`)
is the accent when it is a WORD:

| Surface | `--brass` (before) | `--brass-ink` (after) |
|---|---|---|
| `--paper`, the page | 2.75:1 | **5.27:1** |
| `--panel-raised`, a card | 2.91:1 | **5.59:1** |
| `--panel`, the recessed well | 2.49:1 | **4.78:1** |

Three decisions ride with it, and `__tests__/accentInkContrast.test.ts` holds all
three:

1. **Light only.** Dark keeps the one coral, because deepening a colour that
   already reads 5.3:1 to 6.5:1 there would only make the accent harder to see.
2. **Not `--brick`.** A price wears its band and no other colour (captain's law,
   5 September 2026), so a kicker in the price band's crimson would say
   "expensive". `--brass-ink` is warmed instead — hue 12 against brick's 356 — so
   it reads as the coral under candlelight rather than as a price.
3. **Ink, not fill.** A coral FILL is untouched and still carries
   `--color-on-accent`; `--brass-accessible` remains the login primary alone.

## Every change

| Change | Why |
|---|---|
| `--brass-ink` / `--color-accent-ink` (globals.css, theme.css) | the token above |
| `.kicker` takes the ink | one line, four routes |
| `.cityChooser--section` locate, badge and labels take the ink | same defect |
| `.cityChooserSearchInput` takes `--color-text` | what a person TYPES is text, never the accent |
| `.cityChooserReleaseBadge` tint 18% to 10% | 10.5px bold on a coral tint cleared neither theme (4.38 light, 4.09 dark); 10% clears both (5.02, 4.69) |
| `.cityChooserSearchField:focus-within` takes the house ring | the input suppresses its own outline, so the field must show focus |
| `.venueOccupancySignIn a`, `.nightCrawl__enterKicker` take the ink | same defect |
| `.venueHygieneSource` drops `opacity: 0.72` for `--color-text-muted` | opacity composites ink toward the surface where no token can see it |
| `.invitePreview__join` takes `--color-on-accent` | white on the coral fill read 3.41:1 in light and 2.15:1 over dark's amber; dark ink reads 5.33:1 and 8.45:1 |
| `.dropStripRail` becomes a tab stop with a focus ring | a sideways rail of cards holding no control of their own: every drop past the fold was unreachable by keyboard |
| The skeleton rail stops being scrollable | it is decoration behind `aria-hidden`, so it must not be a scroll container nobody can reach |
| `FavoritePintPicker` drops inline `outline: "none"` and fills its label's height | restores the global focus ring; lifts the target off the 24px floor |
| `--fit-ink` and `--plan-stamp-ink` on the plan surface | see below |
| `.planCollab button` takes `--color-on-accent` | the same white-on-coral defect as the invite preview |
| `.matchGroupPrefs` body copy takes `--color-text-soft`, its eyebrow the stamp ink | a TINTED panel lifts past the surface `--muted` was tuned against |

## A second pass, after rebasing onto #1521

That PR made the Plan invite token live, so the host page began rendering its
route list and crew panel — surfaces the first sweep never reached, and which
carried five more serious violations of the same family. A hue printed as TEXT
on a 12 per cent tint of itself:

| Element | Before (light) | After |
|---|---|---|
| `.planRoute__fit`, verdict "likely" | 2.26:1 | **5.04:1** |
| `.planRoute__fit`, verdict "uncertain" | 1.56:1 | **4.98:1** |
| `.planCollab__heading > span` | 4.00:1 | **8.28:1** |
| `.matchGroupPrefs__eyebrow` | 4.21:1 | **8.71:1** |
| `.matchGroupPrefs__intro` | 4.32:1 | **7.94:1** |
| `.planCollab button` | 3.41:1 light, 2.15:1 dark | **5.33:1** and **8.45:1** |

`--fit-ink` and `--plan-stamp-ink` deepen the hue toward `--ink` per theme (45
per cent of the hue in light, 85 per cent in dark), the same derivation
`app/theme.css` already uses for the price-band inks. The pill keeps its colour
in its border and its ground; only the word changes. Every verdict was measured,
not just the one axe happened to catch: `unlikely` and `book-ahead` were already
above AA and are lifted with the rest rather than left as a second rule.

## Findings, after

**0 serious, 0 critical** across all 36 surfaces. The keyboard loop passes end to
end, and reduced motion leaves nothing invisible or parked.

## What the keyboard walk established

- The landing's tab order is 30 stops with no trap and a visible ring on every
  one. The publisher credit inside "Listed by Pint Prices, collected 4 September
  2026" is 68x16, which is correct: WCAG 2.5.8 exempts a target inline in a
  sentence.
- **A pub is reachable without a pointer at both widths.** The pins are painted
  into a WebGL canvas, so the DOM parallel is the venue list: on desktop through
  Layers then List view, on the phone through More map controls then Layers.
  Opening the list moves focus onto its first pub, and Enter opens that pub and
  moves focus into it.
- **The venue sheet is a real modal.** Twenty-four Tab presses at 390 never left
  it and the ring cycles; every control in it is 44px tall.
- **The price door works keyboard-only and moves focus to what it revealed.**
  Signed out that is the sign-in gate, because posting a price needs a verified
  actor; signed in it is the composer's figure field.
- The phone dock's six destinations are each 61x44 and each show focus. The skip
  link is the first stop everywhere and lands in `<main>`.

## The fences

| Fence | Holds |
|---|---|
| `e2e/a11y-core-journeys.spec.ts` | axe serious/critical = 0 on nine routes at two widths in two themes |
| `e2e/a11y-keyboard-loop.spec.ts` | the loop keyboard-only, focus indicators, target floor, reduced motion |
| `__tests__/accentInkContrast.test.ts` | the shipped ratios on every step of both ladders, and a sweep so a coral is not put back on a light word |
| `e2e/accessibilityGate.ts` | a failure now names the SELECTOR, not just the rule |

## Screenshots

`before/` and `after/`, at 390, 768 and 1440, light and dark, for the landing,
`/plan` and `/moment` — the three surfaces where the kicker's colour changed.

`after/plan-detail-*` is the shared Plan page. It has no `before/` pair on
purpose: that surface only started rendering its crew panel and route list when
this branch rebased onto #1521, so a "before" shot would be of a page that never
existed. The figures in the table above are the evidence there, and a measured
ratio is stronger evidence about contrast than a screenshot anyway.
