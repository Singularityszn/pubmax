# UK price bundle

Every UK drink price this tree holds, in one file, each row saying what it is
worth. Built by `npm run build:uk-price-bundle`. The JSON here is generated;
this README is hand-written and survives rebuilds.

```
manifest.json   # { version, generatedAt, rowsPath, counts, notes[] }
rows.json       # the rows themselves, sorted by venue, drink, then lane
```

## What a row is

```
{
  "venueId":    "venue-uk-w68394027",   // or a curated venue id where one owns the pub
  "name":       "The Witch Ball",
  "category":   "beer",                  // a lib/drinks.ts category
  "priceGbp":   5.4,
  "lane":       "site-harvest",          // who produced it
  "standing":   "listed",                // what it is worth, per lib/priceTier.ts
  "sourceUrl":  "https://…/drinks",      // the page it was published at
  "publisher":  "thewitchball.co.uk",
  "observedAt": "2026-09-04T10:06:14.812Z",
  "basis":      null,                    // estimate rows only
  "sampleSize": null,                    // estimate rows only
  "drinkLabel": "Coke Zero",             // optional: printed name (max 80 chars)
  "drinkSubtype": "soft-drink-coke-zero" // optional: lib/drinkSubtypes.ts id when the label classifies
}
```

`drinkLabel` and `drinkSubtype` are stamped at bundle-build time from each lane's
printed drink name (`scripts/build_uk_price_bundle.mjs` via `lib/bundleDrinkFields.ts`).
When a lane only states a category, both fields stay absent. `drinkSubtype` is
never guessed without a label that classifies.

`servingSize` is optional source-stated serving text on listed rows, carried
through from the producing lane. An absent field means unknown size. `Btl`
records a bottle label without inventing its volume. The builder and runtime
parser apply `isValidUkPriceBundleRow` in `lib/ukPriceBundle.ts` to this field.

`lib/ukPriceBundle.ts` owns the shape, the parser and the one rule about who may
read what. `scripts/validate-data.mjs` refuses the file over a row with no
observation day, a published row with no source URL, an estimate with no
basis and sample behind it, a `drinkLabel` over 80 characters, or a
`drinkSubtype` outside the closed vocabulary for its category.

## The three lanes

| lane | standing | produced by |
| --- | --- | --- |
| `site-harvest` | `listed` | `npm run harvest:uk-prices` (document) and `npm run harvest:uk-prices-rendered` (browser) |
| `drink-price-update` | `listed` | the reviewed publish in `public/data/drink_price_updates` |
| `estimate` | `estimate` | `lib/priceEstimate.ts` over `public/data/price_estimates/baselines.json` |

## The rules that keep it honest

**An estimate is in the file and may never be painted as a fact.** A coverage
answer that omits the modelled figures is not a coverage answer, so they are
here. `authoritativeBundleRows` is what an authority lane reads, and it hands
back only what `standingCarriesAuthority` admits, so pin colour, the
cheapest-pint buckets, the price bands and the Pint Index cannot take one.

**The narrower governance table binds.** A row whose source host is refused on
permission by `lib/harvest/sourcePolicy.ts` is dropped and counted, whatever
`data/price_sources.json` says about it. Nicholson's rows were withdrawn from
the site ledger and every tracked update snapshot on 2026-09-22; the build
predicate also refuses them if they are introduced again.

**A demo fixture is not a price.** `isDemoDrinkProvenance` spots one and it is
never carried into a dataset that claims to say what a pint costs.

**Reviewed category contradictions stay in the source ledger.**
`CATEGORY_QUARANTINE` in `lib/ukPriceBundle.ts` owns the exact exclusions by
source URL, printed item, category and price. The builder counts exclusions in
`manifest.json`; bundle readers also refuse those claims in older files.
The observations remain in `data/uk_prices/site_harvest.jsonl` for audit.
Quarantine neither reclassifies a drink nor supplies a fresh observation.
Current coverage and exclusion counts come from the generated manifest.

The [harvest guide](../../../docs/UK_PRICE_HARVEST.md#what-counts-as-a-price)
owns the reader's category and serving-evidence rules and their limits.
`data/uk_prices/site_harvest_reconciliation.json` records the Sydney Arms
publication under `postReconciliationPublication`, alongside the original
reconciliation. It identifies the existing capture, its observation time, the
superseded row and the resulting ledger and bundle. Reprocessing that capture
does not make its observation time newer. Subsequent additions are recorded in
`laterPublications`, preserving the original reconciliation and Sydney ledger
prefix. Each entry identifies its source evidence file and hash, source URL,
observation time, added rows, and resulting ledger hashes and bundle counts.
The Thirsty Bear's retained evidence is in
[`accepted-prices.json`](../../../data/enrichment/firecrawl/london/accepted-prices.json).
Regression coverage lives in
`__tests__/siteHarvestReconciliation.test.ts`.

**One row per pub, category, printed drink name, serving and lane.**
Names and servings are trimmed and case-normalised for the collect key.
Different explicit servings and an unknown serving stay distinct. For each
key, the newest observation wins; equal timestamps keep the lowest price.
`ukPriceBundleCollectKey` and `bundleRowSupersedes` in `lib/ukPriceBundle.ts`
own this ordering, shared with the site-harvest ledger.
Before keying or publication, `normalizeSiteHarvestLedgerRow` in
`lib/siteHarvestLedgerCore.ts` splits a trailing wine measure from a legacy name
when no serving field exists. "Merlot 175ml" and "Merlot" with `175ml` therefore
share a key; this does not change the observation date.

The crawl's own findings, including everything it read and found nothing on,
are in `data/uk_prices/harvest_report.json` and
`data/uk_prices/rendered_report.json`. The rows the crawl accepted are published
to `data/uk_prices/site_harvest.jsonl`, so the bundle rebuilds from the tree.
