# The simple front door

> **Superseded in part, 14 Sep 2026.** The Pro line and the one-field waitlist
> are removed from the landing FAQ (site audit D6: first revenue comes from
> venues, never drinkers). The hero map's named-pin rule also changed (site
> audit D21): every label is written clear of every named pin, with a
> land-coloured halo over the pub dots. The rows, the "five named pins" wording
> and the shots below stay unchanged as dated history.
> The 1 October 2026 change also replaced the drawing. Current picture and
> action contracts live in the [front-door rule](../../rules/components-design-system-and-launch-primitives.md#the-front-door-shows-london-then-answers-in-one-tap).

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

At capture time, the hero used inline vector geometry: 293 historic-pub dots
and five named pins. The generated module measured 26.9 KB against its 80 KB
ceiling. These measurements describe the drawing in the shots, not the current
landing hero. The front-door rule linked above owns the current contract.

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
