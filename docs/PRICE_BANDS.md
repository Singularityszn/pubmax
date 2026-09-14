# Price bands

Captain's law (5 September 2026, "I already told you"): RED means expensive,
YELLOW means affordable and average, GREEN means cheap. A price wears its band
and no other colour. How far to trust a figure (confirmed, listed, estimated,
logged once, aged) is said in a word, a badge or a pin shape, never in a tone.

`lib/priceBand.ts` is the one module. Every surface that prints a price asks
it for the band and paints through the `.priceBand-cheap`,
`.priceBand-average` and `.priceBand-expensive` class family in
`app/globals.css`. No surface restates a threshold or a hue.

## The rule

Sort every curated pub pint price a city holds, cheapest first. The cheapest
third is `cheap`, the middle third is `average`, the dearest third is
`expensive`. The two thresholds are the prices at the first and second
tercile of that list (nearest rank, nothing interpolated), so each one is a
price a real pub charges. A price sitting exactly on a threshold belongs to
the lower band.

Terciles were chosen over a median plus a margin because they need no
invented margin. "Average" is honestly the middle third of what we hold, and
each band holds the same number of pubs.

## London today

Cut from 950 priced pubs in `public/data/venues_slim.json` by
`npm run build:price-bands`, written to `public/data/price_bands/thresholds.json`.

| Band | Colour | London |
| --- | --- | --- |
| cheap | green | £5.20 or less |
| average | yellow | over £5.20, up to £6.15 |
| expensive | red | over £6.15 |

So a £6.50 pint reads expensive, which is the figure the captain saw painted
yellow on the landing card. The London median is £5.80.

## The area is the city, not the borough

A per-borough rule was measured and rejected. The upper tercile in the City of
London is £6.50 and in Westminster it is £6.50, so the very pint the captain
called expensive would have read "average" on its own doorstep, and a Soho
£6.50 would have read cheap against Soho alone. A drinker's wallet does not
reset at a borough line. The measured borough terciles on 5 September 2026:

| Borough | Priced pubs | First tercile | Second tercile |
| --- | --- | --- | --- |
| Westminster | 133 | £6.15 | £6.50 |
| Islington | 74 | £5.60 | £6.20 |
| Camden | 68 | £5.90 | £6.45 |
| Lambeth | 60 | £5.50 | £6.00 |
| Southwark | 58 | £5.40 | £6.20 |
| City of London | 57 | £6.05 | £6.50 |
| Tower Hamlets | 54 | £5.00 | £5.90 |
| Wandsworth | 52 | £5.50 | £6.05 |
| Hammersmith and Fulham | 34 | £5.40 | £6.20 |
| Kensington and Chelsea | 31 | £6.10 | £6.40 |
| Hackney | 29 | £5.30 | £5.90 |
| Ealing | 26 | £4.70 | £5.55 |
| Barnet | 23 | £4.70 | £5.00 |

Twenty more boroughs hold between 4 and 22 priced pubs each, under the sample
floor below.

## A city under the sample floor

`MIN_PRICE_BAND_SAMPLE` is 30. A city with fewer priced pubs than that has no
honest terciles of its own and reads the whole dataset's thresholds. The
module says which it used (`priceBandBasisFor(area).basis` is `city` or
`all`). Today every priced pub is in London, so the two rows agree, and
`__tests__/priceBand.test.ts` alarms the day a second city qualifies so the
copy that compares prices across London is revisited in the same commit.

## What is banded

The band is a PINT band. It is asked of pint figures alone: the venue index's
cheapest pint, a beer Pint Drop, a listed or modelled beer price, a beer lens
price. A wine, a cocktail, a course or a bar's anchor price is not measured
against pint terciles and stays in neutral ink.

A band is never authority. Which figure a surface may paint at all is still
that surface's own law: corroboration or a minted confirmation for a pin,
`priceStandingFor` for a standing, `venuePriceLane` for the sheet. The band
only says what colour a figure that may be painted is painted.

## Tokens

`--price-band-cheap`, `--price-band-average` and `--price-band-expensive` are
the hues (`--pint`, `--amber`, `--brick`) and paint a fill: a pin, a dot, a
plaque tint. `--price-band-cheap-ink`, `--price-band-average-ink` and
`--price-band-expensive-ink` are the same hues deepened to read as text at
4.5:1 or better on the page and the raised card, in light and in dark
(`app/theme.css` tunes the dark mixes). `__tests__/priceBand.test.ts` measures
the contrast from the shipped stylesheets.

The price plaque (`.price-plaque`, `PriceBadge`) is neutral until a band
paints it. Its old brass tint read as the yellow band on prices nobody had
banded.

## Rebuilding

```
npm run build:price-bands
```

Run it after the pint dataset is re-collected. `__tests__/priceBand.test.ts`
recomputes the table from the packs on disk and fails when the committed file
drifts.

## Pins

`__tests__/priceBand.test.ts` (the rule, the table, the tokens),
`__tests__/priceBandSurfaces.test.ts` (every surface paints through the
module; no colour comes from a standing), `e2e/price-colour-law.spec.ts`
(the landing card, the venue sheet and the near-you rail at 390).
