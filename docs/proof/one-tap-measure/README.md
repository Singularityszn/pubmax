# The one-tap price door asks the measure

Proof for review finding F-2, over contribution battle test D04: the single
primary price door on a pub's Overview hard-coded `measure: "pint"` and never
asked, so the defect the whole half-pint work exists to close was still open on
the busiest lane.

`before` is this branch's parent, `acb00f71d`. `after` is this branch. Every
shot is the "What's it tonight?" composer on the Overview of The Old Bell
Tavern (`venue-1kt3p9o`, a pub with no price on any source), signed in through
the e2e auth doubles on a production build, light theme, reduced motion,
`/api/pint-drops` answered empty by a route mock in the shape production
answers it. Phone shots are 390x844 at device scale 2, tablet 768x1024 at
scale 2, desktop 1440x900 at scale 1.

| file | what it shows |
| --- | --- |
| `price-door-390.png`, `-768`, `-1440` | the composer as it opens |
| `half-picked-390.png`, `-768`, `-1440` | after `Half` is tapped (after only) |

## What changed

**Before.** One closed drink chip row, a price field, `Log it`. Nothing on
screen said what serving the figure was about, and the paired `pint_drops` row
was stamped `measure: "pint"` whatever the drinker was holding. A half at £2.60
carried a real authority key, so a second reporter's agreement minted a
confirmation and £2.60 fed pin colour, the cheapest-pint buckets and the Pint
Index at a pub whose pint is £5.50.

**After.** The closed measure row from the Pint Drop composer stands above the
price field on the beer lane, rendered by the ONE shared control
(`components/map/composer/MeasureChips.tsx`), so the two price doors cannot ask
one question two ways. `Pint` is selected, and it is a real answer on screen
rather than an assumption. `lib/oneTapPintDrop.server.ts` carries the answer
into the row and states nothing of its own.

A non-pint answer writes NO community price. `community_prices` carries no
measure column by design, and AGENTS.md says why: its composer offers a closed
category and no drink text, so its beer chip MEANS a pint. That held only while
nobody could say otherwise. Now the door asks, so the way to keep it true is to
send a half down the lane that can hold it: a dated Pint Drop carrying its own
measure, held out of every pint read by `isPintPricedDrop`. Nothing is scaled
and nothing is lost.

The sentence under the field follows the measure too. In the `half-picked`
shots the reach line stops saying a second drinker moves the map, because for a
half that is untrue at any count.

## Held by

- `__tests__/oneTapMeasureAsked.test.tsx` - the rendered chips, the measure in
  the request, the lane that asks nothing, the reset after a log, and a
  tree-wide sweep proving no shipped module states a measure literal outside
  `lib/drinkMeasure.ts`.
- `__tests__/priceSubmitRoute.test.ts` - the paired row's measure, the absent
  measure reading as a pint, and a half writing no community price.
- `e2e/one-tap-measure.spec.ts` - a half logged through the real door at 390,
  and the pub's pin colour unmoved.
