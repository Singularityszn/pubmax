# One price door per trust state: the venue Overview at 390, 768 and 1440

Proof for the captain's rule from the core-loop battle test (L03, 5 September
2026): one button system, one clear primary per screen. Every shot is the venue
Overview, signed in through the e2e auth doubles, on a production build of the
app with `/api/pint-drops` answered by a route mock in the shape production
answers it. `before` is origin/main at `5c1176a26`; `after` is this branch.
Phone shots are 390x844 at device scale 2, tablet shots 768x1024 at scale 2,
desktop shots 1440x900 at scale 1, light theme, reduced motion, the sheet
scrolled to its price area.

Five states, one pub each:

| state | pub | how the state is made |
| --- | --- | --- |
| none | The Old Bell Tavern, `venue-1kt3p9o` | no price on any source, no drops |
| listed | Fox and Pheasant, `venue-133bdp8` | a listed bundle row (£6 beer) and no baseline, no drops |
| logged-once | The Sir Christopher Hatton, `venue-1vle947` | one public £4.50 drop by `tester`, 4 days old |
| confirmed | The Sir Christopher Hatton | the same drop plus a second drinker's, both carrying a minted confirmation |
| aged-out | The Sir Christopher Hatton | the same drop, 90 days old |

`tally.json` in each directory is the count of visible price actions inside the
sheet after each shot: every button or link whose accessible name mentions a
price, a pint drop, Log it, a "Still £" door or a bare figure. The one action
left at 390 on `none` beside the door is the phone peek's quiet "No price yet.
Be the first" cell, the at-most-one quiet secondary the rule allows. Shots were
taken with a Playwright script over `e2e/helpers/authDoubles.ts`, signed in as
account A, the drops served exactly as `e2e/overview-price-door.spec.ts` serves
them.

## The count

| state | 390 before | 390 after | 768 before | 768 after | 1440 before | 1440 after |
| --- | --- | --- | --- | --- | --- | --- |
| none | 9 | 2 | 8 | 1 | 8 | 1 |
| listed | 6 | 1 | 6 | 1 | 6 | 1 |
| logged-once | 6 | 1 | 6 | 1 | 6 | 1 |
| confirmed | 5 | 1 | 5 | 1 | 5 | 1 |
| aged-out | 6 | 1 | 6 | 1 | 6 | 1 |

## What changed on the sheet

- **The policy** is `overviewPriceDoor` in `lib/pintTrust.ts`: `logged-once`
  and `aged-out` keep the confirm door from #1492 (`Still £4.50?`); every other
  state and every non-drop lane gets the one log door (`Log tonight's price`).
- **The composer is folded** behind that door. Before, "What's it tonight?"
  with its Log it and three price chips sat open under every pub; after, it
  mounts when the door is taken (or the sign-in gate, or a ranked mission for
  the pub), and the door folds away once it has.
- **The retired doors**: the first-drop nudge's "Or leave a Pint Drop", the
  prices-by-drink "Log a beer price" beside the price area, and the sticky
  bar's "Add price". The sticky bar now carries no painted primary at all:
  "Make it Stop 1" is a ghost, because the phone peek's "Plan stop" is the one
  painted plan action on that screen.
- **The door's treatment** is the flat action accent every launch primary
  wears (`.priceDoor`, `app/globals.css`), never a price band.

Pins: `__tests__/overviewPriceDoor.test.ts`, `e2e/overview-price-door.spec.ts`.
