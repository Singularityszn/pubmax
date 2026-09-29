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

**Six reviewed category contradictions stay in the source ledger, not in listed
authority.** `lib/ukPriceBundle.ts` matches their exact page, printed item,
category and price. The builder excludes them and counts the exclusions in
`manifest.json`; bundle readers also refuse them if they encounter an older
file. The source observations remain in
`data/uk_prices/site_harvest.jsonl` at lines 106, 107, 110, 111, 444 and 1246.
These are the Plough's 0% Negroni, Picante Spritz, vodka description and
Pineapple & Yuzu soda, the Guard House's 0.0% Berry Hugo and the George &
Dragon's Frobishers Juice. `npm run build:uk-price-bundle` removed exactly six
listed rows from the generated file on 2026-09-29, with no new rows and no
change to the 3,243 venue count.

This review used committed observations and a synthetic menu to reproduce the
reader's item-boundary failure. It did not re-fetch any page or review every
harvest row. A printed `250ml` on the juice does not establish a wine serving;
unknown servings remain unknown. The reader now takes an
item's own printed name before nearby menu text when naming its category, reads
juice as a soft drink rather than treating `250ml` as wine, and checks a beer's
bottle measure against its own item where available. Other category conflicts
still need review; neither the exact-match quarantine nor this synthetic fixture
proves other labels correct or supplies a fresh source observation.

**One row per pub, drink and lane, and it is the cheapest the lane stated.** A
lane states many lines for one pub's beer; the figure a drinker can walk in and
pay is the lowest of them.

The crawl's own findings, including everything it read and found nothing on,
are in `data/uk_prices/harvest_report.json` and
`data/uk_prices/rendered_report.json`. The rows the crawl accepted are published
to `data/uk_prices/site_harvest.jsonl`, so the bundle rebuilds from the tree.
