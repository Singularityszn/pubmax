# UK price estimates: the model, and what it is not allowed to say

Captain's decision, 3 September 2026: give every pub in the UK a price now,
accepting estimates that are labelled as such, and corroborate them later as
pubs and drinkers publish real figures.

This is the model that does that, and the fences that stop it turning into a
price nobody can correct.

## The four standings

`lib/priceTier.ts` is the whole vocabulary, and it is the only place a standing
is decided. A surface narrows from it and never restates it.

| Standing | Tone | What it means | Ceiling |
| --- | --- | --- | --- |
| `confirmed` | green | A drinker confirmed this price | 30 days |
| `listed` | amber | The pub or its chain published it, with a URL and a date | 365 days |
| `estimate` | modelled | We modelled it. Nobody published it | the basis's own day |
| `none` | grey | Nothing is known | n/a |

`priceStandingFor` takes the strongest claim the evidence supports and never a
stronger one. An expired confirmation does not become an estimate by itself: it
falls through, and the pub takes whatever standing its own remaining evidence
supports. The reason travels with the decision, so a surface can still say that
a listing went stale rather than only that a pub has no price.

**`confirmed` has no producer yet, and that is deliberate.** Nothing in the tree
can confirm a price today: `PintDropReviewStatus` in `lib/pintDrops.ts` is
`"hidden" | "pending" | "reported"`, with no confirmed state and no
`confirmationId` writer. The type is written now so every surface is built
against the whole vocabulary rather than retrofitted onto it later. **Building
the confirm path is the named follow-up**, and it is the single highest-value
one, because it is the only price supply that grows with the product rather than
with scraping budget.

### Two ceilings, and why one of them is ours rather than the brief's

The 30 day confirmation window is the house's existing price-authority window,
restated in days because `priceTier` is a leaf module on purpose.

The 365 day listed ceiling is a judgement call this work added. The brief set no
age bar on the listed standing. Shipping none would let a two-year-old menu read
as today's price, which is the exact failure the standings exist to prevent, so
one is applied. A year rather than a month, because a chain republishes its menu
on its own slow cadence and not on a drinker's visit. It is one constant,
`LISTED_MAX_AGE_DAYS`, and moving it is a one-line decision rather than an
archaeology exercise.

## The estimate engine

`lib/priceEstimate.ts` is pure and takes two inputs: a pub, and the basis table.

### What it knows about a pub

Everything is OSM-stated or derived from the pub's own point. Nothing is
inferred from a name, which keeps this continuous with the extraction law in
`data/osm/uk/VENUES.md`.

- `operator`, the chain the pub states it belongs to
- `website`, the pub's own site
- `postcode`, for the region outside London
- `londonBoroughCode`, from the point-in-polygon classifier the Pint Index
  itself uses, never from a name or a postcode guess

### The two bases, narrower first

1. **`chain_menu`.** The pub belongs to a chain whose menu we are permitted to
   read. The figure is the median across that chain's own published pints. This
   is first because it is the narrower claim: it is about pubs run by the same
   operator off the same menu.
2. **`regional_baseline`.** Otherwise, the median for the pub's own region.

A pub that matches neither gets nothing, and grey is a real answer. It is what
points a drinker at the pubs whose price is still missing, which is the whole
reason for showing the weak standings rather than hiding them.

### The sample floor

`MIN_ESTIMATE_SAMPLE` is 3. Below it the basis is skipped rather than used
quietly. Two prices that happen to agree still describe two pubs, and the entire
claim an estimate makes is that it generalises. A basis under the floor is
dropped by the build script AND refused by `validate-data`, so an artifact that
ships a two-price basis fails the build rather than modelling nothing at runtime.

### Every estimate names its own evidence

`basis`, `sampleSize` and `computedAt` ride on every estimate, and
`estimateBasisNote` prints the sample, because a figure modelled from four pubs
and one modelled from four hundred are not the same claim and must not read the
same.

## The basis table

`npm run build:price-estimates` writes `public/data/price_estimates/baselines.json`.

**The engine is runtime; the table is the build.** Estimating 38,215 pubs into a
shipped artifact would put a per-pub figure on every phone and freeze it there.
What ships instead is a few dozen basis rows, and each pub's estimate is derived
when a surface asks. The table is read by static import
(`lib/priceEstimateBaselines.ts`), so Next traces it and no
`outputFileTracingIncludes` key is needed.

### What may feed a basis

Only prices a permitted first-party publisher actually published, and permission
is the **narrower** of the two governance tables:

- `data/price_sources.json` must mark the source permissible, and
- `lib/harvest/sourcePolicy.ts` must not refuse its estate.

That is what keeps the 1,914 Nicholson's rows out today. `sourcePolicy` refuses
Mitchells & Butlers on `robots-unreadable`, `price_sources.json` marks
Nicholson's permissible, and the narrower rule binds. Resolving that
contradiction by re-reading robots is PR 2's job, not a judgement made here.

### What the table holds today

| Basis | Rows | Why |
| --- | --- | --- |
| Chains | **0** | No chain we are permitted to read has published a single pint price. The 1,538 Greene King rows in the tree are 863 wines and 675 cocktails, with no beer among them. |
| Regions | **29** | London boroughs, from the bundled dataset's own per-borough average. |

So today **2,963 of the 38,215 UK pubs (7.8%) carry an estimate**, and every one
of them is in London. The other 35,252 are grey and say so. Raising that number
is exactly what the chain harvest is for.

### The London rows are modelled off a scrape, and say so

The bundled London dataset publishes its own per-borough average in
`estimated_average_price_text`. That figure is competitor-derived and is
quarantined from the citable Pint Index. It stays quarantined: it feeds an
ESTIMATE, and `standingCarriesAuthority` bars every estimate from every
authority lane. Its provenance is written into each region row so a reader can
weigh it rather than having to trust it, and `validate-data` refuses a region row
that will not name its provenance.

The average is read off the row rather than recomputed from `price_gbp`, because
the dataset publishes that average as its own figure and recomputing it would
invent a third number nobody stated.

## The fences

Three, and they are the load-bearing part of this work.

1. **An estimate may never speak with authority.**
   `standingCarriesAuthority` answers false for `estimate` and `none`.
   `__tests__/priceEstimateAuthorityFence.test.ts` walks the tree and fails if
   any price-authority module so much as mentions the engine: the pin colour
   bands, cheapest-pint buckets, the Pint Index, its archive, the freshness spine
   and every current-price merge. This is the same fence `lib/priceHistory.ts`
   wears, against the same module list, for the same reason.
2. **An estimate may never print as a bare price.** `priceStandingFigure` is the
   ONE place a standing's figure becomes a string, so a modelled price cannot
   lose its `est.` on the way to a screen.
   `__tests__/trustPillRender.test.ts` asserts it on the rendered markup rather
   than on the helper.
3. **A basis must be answerable.** `validate-data` refuses a chain basis that
   will not name the pages it was read from, a region basis that will not name
   its provenance, and any basis under the sample floor or outside the pint band.

## Surfaces

**TrustPill** (`components/prices/TrustPill.tsx`) is the reader-facing standing:
one shape, four tones, the figure through `priceStandingFigure`, and for an
estimate the method link plus its basis note. It renders for `none` too.

**The pin** carries the standing as a feature property and prints `est. £X` in
the tag lane it already has, but only on a pub with no sayable price of its own,
and never under a drink lens.

Two things the pin deliberately does NOT do:

- **It does not move the colour band.** A band is the price stack's answer, and a
  modelled figure is not in that stack.
- **It does not repurpose the rim.** The brief asked for the standing on the pin
  edge. On this map the edge is the contrast and findability lane by law
  (`venuePinEdgeTokens`, and `__tests__/mapPinBandContrast.test.ts` holds every
  band to an edge over every dark basemap tone), and every ring tone is already
  spoken for by selection, scraped, Pint Drops, provisional, what's-on and the
  band halo. Taking the rim for a fifth meaning would break a contrast contract
  to add a sixth ring nobody could tell from the other five. The standing went
  into the price tag instead, which is where a claim about a price belongs.

### The one wiring step left, and why it is left

`pubsToGeoJSON` takes the standings map as its own optional argument, defaulting
to null, so today's behaviour is bit-for-bit unchanged until a caller passes one.
The only caller is `components/PubMapCanvas.tsx`, which this lane is not
permitted to edit. The change there is one argument on one call:

```ts
pubsToGeoJSON(venues, venueSignals, favoritePint, drinkCategory,
  whatsOnByVenue, provisionalVenueIds, lensPrices, priceStandings)
```

Everything behind that argument is built and tested
(`__tests__/pinPriceStanding.test.ts`).

## What this does not do

- It does not confirm anything. See the follow-up above.
- It does not harvest. PR 2 extends the first-party lane to permitted chain
  menus UK-wide, which is what puts chain rows in the basis table and lifts
  estimate coverage off 7.8%.
- It does not touch the Pint Index, which still publishes only prices with a
  named source and a date, and still holds none.
