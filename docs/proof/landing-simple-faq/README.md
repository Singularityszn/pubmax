# The simple front door

Branch `fm/landing-simple-faq`. The captain's ask, 7 September 2026: a landing a
stranger understands at a glance, with the map of places to visit and the
historic pubs at the top, an FAQ that explains how the app works, one answer for
today and one for tonight, and a plain statement of what the app saves a
drinker.

Shot on a `next dev` build at device scale 2 with reduced motion, light and
dark, signed out. The red badge in the corner of every shot is the dev
overlay, not the page.

| Shot | What it shows |
| --- | --- |
| `landing-fold-390-light.png`, `landing-fold-390-dark.png` | The first screen on a phone: kicker, claim, one line, the drawing of London, the one primary, the quiet row. The primary sits about 620px down an 844px viewport, so it is above the fold in both themes. |
| `landing-fold-1440-light.png`, `landing-fold-1440-dark.png` | The desktop first screen: the copy and the drawing side by side, the primary under the lede. |
| `landing-full-390-*.png`, `landing-full-1440-*.png` | The whole page at both widths and both themes. |
| `landing-answers-390-light.png` | The two answer cards, each one sentence with the London day stamped on it. |
| `landing-saved-390-light.png`, `landing-saved-1440-light.png` | The saving line, measured from the shipped dataset. |
| `landing-faq-390-light.png` | The six questions. |
| `landing-pro-390-light.png`, `landing-pro-1440-light.png` | The Pro line and the one-field waitlist, which opens a mail app and stores nothing. |

## What the picture is

Not the live MapLibre canvas, and not a photograph. It is inline vector
geometry generated once at build by `scripts/landing/build-landing-map.mjs`
from `data/london_boroughs_simplified.json` and `public/data/historic_pubs.json`,
painted by `components/landing/LondonMapSnapshot.tsx`. 26.9 KB of generated
module against the 80 KB ceiling `__tests__/landingMapSnapshot.test.ts` holds.
No request, no script, sharp at both widths from one set of bytes, and it takes
the reader's own theme tokens.

Every mark is a real place: 293 dots for the historic pubs inside the frame,
and five named pins picked by a rule rather than by hand (sourced, dated,
oldest first, at least 150 user units apart so no two labels touch).

## The figures on the page

The saving line is measured, never typed:

- The average listed pint across 952 priced London pubs is £5.53.
- Across the cheapest third of them it is £4.16.
- That is £1.37 a pint.

`__tests__/pintSavings.test.ts` takes both means from the shipped dataset on
every run, so a re-collected dataset moves the sentence rather than leaving a
stale claim on the front door.

## What moved, and what did not

The one primary is `/near` now. "Still £6.50?" opens the Pint Drop composer,
which ends in a sign-in ask, and the live walk found that wall as B3. It is the
first quiet door instead, still carrying the anchor pub's own figure. `/near`
answers from a London patch when the reader refuses location, so the one tap
never ends at a wall.

The Pal lost its hero door because the quiet row caps at two. Its footer door
and its route are untouched.

The "Why PUBMAXX" section went: the six questions answer it better, and once.
