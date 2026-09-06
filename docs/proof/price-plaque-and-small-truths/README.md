# The price plaque, and three smaller truths

Captain, 6 September 2026, reading the live site: "there's a button mistake
where the prices are looking in a weird shape". The plan-astra review located
it and ranked it first. Three more findings from the same review ride with it,
because each is one file and each is the product saying something it should
not.

## What was measured, and how

Both arms are a production build of this tree served locally and read with
Playwright's Chromium at device scale 2. The before arm is the branch point,
`5bf044f55`; the after arm is this branch. Each surface was shot at 320, 390,
768 and 1440, with the analytics consent card dismissed first so it could not
sit over the row being measured.

Three surfaces, the ones a price is read on most:

| Key | Route | What it shows |
|---|---|---|
| `today-cheap-pints` | `/today` | the cheap-pints rail, a COLUMN of prices |
| `map-card` | `/` | the landing answer card, ONE price at hero size |
| `venue-sheet` | `/map?sel=venue-eltcmh` | the Blackfriar's peek price row |

The venue sheet's phone peek does not mount above 640px, so the 768 and 1440
shots of that surface record the desktop composition instead and the measured
box is 0 wide in both arms. That is the same in both, so the comparison holds.

## The plaque, measured

Computed style of the first `.priceBadge` on the page, identical at every width
except the font size each surface sets:

| | before | after |
|---|---|---|
| `border-radius` | 6px | 8px |
| `box-shadow` | `inset 0 1px 0 rgba(255,255,255,.42)` + the pressed inset | `none` |
| `transform` | `rotate(-1.5deg)` | `none` |
| face | JetBrains Mono | Inter (body) |
| weight | 700 on `/today`, 800 elsewhere | 700 everywhere |
| `min-inline-size` | 71.2px | `auto` |
| measured width of `£2.95` | 71.9px | 60.6px |
| alignment | right | left |

The band is untouched. `lib/priceBand.ts` remains the colour law, the surface,
border and ink still come from `--price-band-*`, and `tabular-nums` stays so a
column of figures still lines up.

## The radius is the button's ratio, not the button's number

The first pass took `--control-radius` literally, as the brief asked. Shot at
390 it was wrong, and the shot is why: that token is 14px on a 44px control, a
corner ratio of about a third, but a price plaque is 28px tall, so the same
14px renders a FULL STADIUM. `/today` became a stack of stadium chips and
`/borough/southwark` put one beside a circular rank marker, so the price read
as a status tag rather than as a figure. The design system reserves the pill
for circular icon controls and tab-group segments.

`--radius` (8px) is the same corner ratio on a 28px box that the control token
is on a 44px button, so a price joins the shape family instead of borrowing
another shape's meaning. The type reads `--control-font-size` and
`--control-font-weight` rather than restating `0.84rem`, which is the same rule
one level up: a control reads the row of tokens, it does not retype a figure.

## The other three

They are code and test changes with no visual surface of their own, so they are
pinned by unit tests rather than by a screenshot.

- **Tonight stamp.** The phone printed "Quiet night · Checked 22 Aug · via
  what's-on" on 6 September while the API answered that morning. It was dated
  from the freshest BUNDLED artifact, so a night with no rows took its date off
  a file on disk. `tonightWhatsOnObservedAt` reads the live read's own
  `kindObservedAt` and goes undated when it cannot date a kind on screen.
  Pinned by `__tests__/tonightOutListings.test.ts`.
- **Cheap Pint Leaderboard.** Measured on the shipped dataset, all ten ranked
  rows were one chain, six sat at £1.99, five of those were Bud Light, and one
  Wandsworth pub held two rows under two spellings of its own name. One row per
  pub, and one row per price several pubs publish for the same drink. Pinned by
  `__tests__/leaderboard.test.ts` against those exact rows.
- **You card.** It printed "1-day mapping streak" over an account an hour old.
  The block, the "best day streak" stat and `streakLabel` are retired. Pinned
  by `__tests__/yourContributionsCard.test.tsx`.
