# The trust story reads one way: /map?sel=venue-1vle947 at 390 and 1440

Rendered proof for the read half of the second-drinker loop (captain's cut,
5 September 2026, Fable51Fix section 1). Every shot is the same page, The Sir
Christopher Hatton, with `/api/pint-drops` answered by a route mock in the
shape production answers it (the real row is Lager £4.50 by handle `tester`,
logged 1 September 2026, no authority key, no confirmation). Three states are
driven through that one mock. `before` is a production build of origin/main at
`94bdffd1c`; `after` is this branch. Phone shots are 390x844 at device scale 2,
desktop shots 1440x900 at device scale 1, light theme, reduced motion, the
sheet scrolled to its price area.

The two flags are read off the sheet's own text after each shot: whether the
sheet printed "No price yet", and whether it printed "No beer price logged here
yet".

| state | viewport | before: chip | before: No price yet | before: No beer price logged | after: chip | after: No price yet | after: No beer price logged |
| --- | --- | --- | --- | --- | --- | --- | --- |
| logged-once | 390 | none | no | no | `logged-once` | no | no |
| logged-once | 1440 | none | no | no | `logged-once` | no | no |
| confirmed | 390 | none | no | no | `confirmed` | no | no |
| confirmed | 1440 | none | no | no | `confirmed` | no | no |
| aged-out | 390 | none | no | **yes** | `aged-out` | no | no |
| aged-out | 1440 | none | no | **yes** | `aged-out` | no | no |

## What each state paints, and what changed

- **logged-once** (the production row): unchanged on screen. The Overview
  prints £4.50, "Logged by a Pubmaxxer", the age and "Logged once, needs a
  second drinker"; the pin wears the provisional badge and no figure. What is
  new is the hook: the row and the phone peek carry
  `data-pint-trust="logged-once"` and `data-venue-id`, the element the
  second-drinker action mounts against.
- **confirmed** (a server-minted pair): the Overview prints the trust pill
  "£4.50 Confirmed <day>", the pin paints its band and its £4.50 tag, and the
  tag's ink is the confirmed green rather than the brass plaque ink. The two
  inks are one token, `--price-confirmed-ink`, shared with the pill. The
  software rasteriser this rig paints with flattens small SDF text to grey in
  BOTH builds, so the ink is held at the engine instead: the collision test
  evaluates the layer's `text-color` expression through
  `@maplibre/maplibre-gl-style-spec` and holds it to the standing.
- **aged-out** (the same row, 90 days old): before, the price area printed the
  bundle's modelled `est. £6.50` above a prices-by-drink block reading "No beer
  price logged here yet", while the Drinks tab printed the £4.50 drop. That is
  the regression the captain's cut names. After, the area prints £4.50, "logged
  90 days ago" and "Over 30 days old, needs a fresh drinker", and the block
  above holds its absence line. The pin paints nothing from the drop lane.

Pins: `__tests__/pintTrust.test.ts`, `__tests__/lonePintDropLane.test.ts`,
`__tests__/mapSymbolCollision.test.ts`, `e2e/trust-read.spec.ts`.
