# The map key follows the lens

Fix for review finding **P0-1** (`review-codebase-design-night2`), **F-1** of
`review-code-merged-night2` section 8, and lane 8 of `review-thermonuclear-night2`.
All three are about the Spoons value lens shipped in #1596.

## What was wrong

`pinBucketAndTag` (`components/map/canvas/geojson.ts`) returned the lens's units
band **as `bucket`**, the price property every downstream surface reads. So with
the lens on:

- `deriveMapRenderedState` stamped `meaning: "pint"` over a units band.
- `priceLegendInput` had no Spoons input, fell to `kind: "default"`, and
  `mapPriceLegend` printed the pint price key.
- The cluster donut's `b0..b3` counts, the GL cluster disc's colour and the
  cluster note all described those units bands as price bands.
- The maximum-pint-price cap chips stayed on screen beside pins no price painted.

Measured on a production build at 1440 (`before/map-key-1440.png`):

```
title:       Pint prices and other venue price bands
rows:        £    £5.15 or less
             ££   Over £5.15, up to £6.15
             £££  Over £6.15
             ?    No pint or venue price on the map
clusterNote: A split cluster ring shows the mix of price bands inside it. ...
```

That is a specific pint-price threshold stated about a named Wetherspoon whose
pint price this lane holds nothing about: `lib/wetherspoons.ts` records the probe
and the chain publishes none. It is the captain's colour law read backwards.

## What it is now

The lens paints through its own property. `bucket` stays the pub's price bucket,
untouched; `spoonsBucket` is stamped beside it and is absent while the lens is
off, exactly as `lib/ukBasePubs.ts` already did for the national base layer.

- `deriveMapRenderedState` reads it as its own `meaning: "spoons"`.
- `priceLegendInput` asks the lens FIRST, in the order `pinBucketAndTag` does, so
  a drink lane chosen alongside cannot put a wine key over units pins.
- `mapPriceLegend` gained `kind: "spoons"`, whose rows, threshold and cluster
  note are the lens's own words (`lib/spoonsValue.ts`).
- `clusterProperties` accumulate `s0..s3` beside `b0..b3`; `readCounts` and
  `clusterCircleColorExpr` prefer the s-counts when a cluster has any, so the
  donut and the GL disc count what their own pins are painted by.
- `priceCapFilter: false` takes the maximum-pint-price cap chips off both the
  desktop Layers panel and the phone Prices tab under this lens.

Same state, same build, at 1440 (`after/map-key-1440.png`):

```
title:       Spoons value key
hint:        Pin colours follow the units in the best £10 round at each
             Wetherspoon, not a pint price. This ranks what a tenner buys, not
             what to drink. Know your limits.
rows:        More   More than 12.8 units
             Usual  12.8 units
             Less   Less than 12.8 units
             ?      Not in the ranking
clusterNote: A split cluster ring shows the mix of value bands inside it. ...
             Grey means no pub in it is in the ranking. ...
```

At 390 (`before/map-key-390.png`, `after/map-key-390.png`) the same key is read
through More → Key, and the rows change the same way.

One string has been reworded since these shots (15 Sep 2026). The empty-cluster
note names a cluster rather than the view, because a pub outside a cluster is not
what makes a cluster grey. Every row above still reads as shown.

## A credit URL is an https URL

`parseCredit` (`lib/spoonsValue.ts`) took any non-empty string as `sourceUrl`,
which three surfaces render as an `href`. It now requires an https address, and
`scripts/spoonme/import-report.mjs` refuses to write a pack whose credit is not
one. The importer also bounds each row's text fields, because a row's words are
written verbatim from a third-party page into a committed file.

## Method

Production build (`NEXT_DIST_DIR=.next-prod npm run build`) served on a private
port, driven with Playwright's Chromium under `--use-angle=swiftshader
--enable-unsafe-swiftshader` so the map really paints. Each shot: open `/map`,
dismiss the consent bar and the first-visit location card, open the drink lane
panel (the phone's drink chip), press **Spoons value**, then open the key
(desktop Layers, phone More → Key). The before shots are the same script against
the same tree with the fix stashed.

## Tests

- `__tests__/spoonsValue.test.ts` runs the four-module chain
  (`pubsToGeoJSON` → `deriveMapRenderedState` → `priceLegendInput` →
  `mapPriceLegend`) and asserts the properties, the bands, the key's rows and the
  cluster note with the lens off, on, and on under a drink lane. It replaces a
  test that asserted `geojson.ts`'s own source text and wrote the defect down as
  intent.
- `__tests__/mapPriceLegend.test.ts` owns the `kind: "spoons"` rows.
- `__tests__/mapBasemapTaste.test.ts` owns the cluster disc's colour under it.
- `__tests__/spoonsValueImport.test.ts` owns the credit URL and the row bound.
- Two stylesheet regexes and one `useState(false)` assertion were removed from
  `__tests__/spoonsValueSurfaces.test.tsx`; `e2e/spoons-value.spec.ts` now
  measures the cut chips' rendered boxes at 390 instead.
