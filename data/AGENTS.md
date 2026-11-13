# Datasets, packs and seeds

The committed data: what a row is worth, which lane it belongs to and which layer it ships in. The published copies under `public/data/` follow the same rules. Repo-wide rules are in the root [AGENTS.md](../AGENTS.md). Dataset shapes are in [`data/README.md`](README.md#shapes).

## Traps

- **Every UK price lives in one bundle, and each row says what it is worth.** `public/data/uk_prices/` is built by `npm run build:uk-price-bundle`. `lib/ukPriceBundle.ts` owns the shape. An estimate is in the file, but an authority lane reads `authoritativeBundleRows`, so an estimate never colours a pin or enters the cheapest buckets or the Pint Index.
- **All harvest lanes share one set of price-reading rules.** `lib/harvest/ukPriceCrawl.ts` owns them, and [`docs/UK_PRICE_HARVEST.md`](../docs/UK_PRICE_HARVEST.md) explains them. An offer such as "2 for £9" is not a pint price. A shared pub name is not a match.
- **Two pub layers, and only one is the product.** `venues_slim*.json` is the curated index. The UK-wide unpriced OSM pubs are a separate base layer. Never merge base pubs into the venue index. An area joins the curated layer by promotion from the base snapshot.
- **City pins have restricted fields.** See the [city-pack contract](cities/README.md#what-a-pin-says-it-knows).
- **The OSM credit sits on the map.** `OSM_ATTRIBUTION` in `components/map/canvas/tokens.ts`.
- **A hyped pub row needs a dated http source.** `score` and `mentions` order the list and are never shown. An ambiguous name stays unmatched.
- **A date is derived, never typed.** `data/freshness_registry.json` is the one source. Tests read the collection day through `PINT_DATASET_OBSERVED_AT`.
- **`npm run export:data` does not collect.** It refuses to drop rows unless `--allow-row-loss` says so. Re-collect with `node scripts/refresh_pint_price_observations.mjs`.
- **A historical price is history.** `public/data/price_history/london.json` never enters bands, pin colour, cheapest buckets, the Pint Index or any current-price merge. `lib/priceHistory.ts` owns the rule.
- **A retired lane is retired, not switched off.** Reviving one is a captain source decision with a producer beside it.

## Detail

Full rules, pins and history: [`docs/rules/data-bundles-layers-and-lanes.md`](../docs/rules/data-bundles-layers-and-lanes.md).
