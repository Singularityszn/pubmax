# Sun Tavern retained price claims - source only

Status: static inspection only. No publisher fetch, parser execution, tests, regeneration or maintained-source change. Current menu and historical page completeness remain unverified.

## Exact lineage

`data/uk_prices/site_harvest.jsonl:910-916` retains seven observations for `venue-uk-n1420042285`, source `https://www.thesuntavern.co.uk/menu/`. The Sept 4 gin £7 label is `sics Umbrella Vesper Grey Goose Vodka, Boatyard Gin, Kina L’Aero, Vichy Catalan`. Rum, shot and whisky £10 rows have neither label nor serving. Beer £8.50 names `BELFAST COFFEE Bán Poitín, Cold Brew Coffee, Cream, Demerara, Nutmeg`; cocktail £7 and wine £8 are later Sept 21 unnamed observations. Ledger contains no original snippet, section context or recorded renderer for these rows.

All seven remain listed in `public/data/uk_prices/rows.json`, under canonical `venue-ndc1rt`. The exact OSM identity-to-curated join is tuple `n1420042285` in `public/data/uk_base/packs/a917f46cc28c0e9e/51.500_-0.125.json`: The Sun Tavern, 441 Bethnal Green Road, coordinates 51.52729/-0.05842, curated ID `venue-ndc1rt`. This is identity resolution, not verification of each menu item.

## Concrete classifier seam

`lib/harvest/ukPriceCrawl.ts:137-183` does not recognize Vesper in its cocktail vocabulary. Printed-item priority (`292-333`, `667-693`) therefore cannot identify that title through its named cocktail rule; fallback chooses nearest recognized category word relative to the price (`617-634`). The retained item names both vodka and gin as ingredients. Ingredient-word classification can therefore produce a single-gin claim for an unrecognized named mixture. The mixer guard (`600-603`) checks a nearby `with`, not this comma-separated ingredient list. This is a source-supported defect candidate, not a replay of the missing original snippet or proof of the current live menu's price/category.

Existing parser controls cover recognizable cocktail names containing spirits and split-title ambiguity (`__tests__/ukPriceCrawl.test.ts:264-315`), but no exact Sun/Vesper case was found. Smallest parser regression: supplied explicit named Vesper item with those ingredients and a printed price must not become a single-gin offer. Use a clearly synthetic business fixture, not reconstructed historical publisher proof. Future parser repair belongs the existing harvest owner.

## Existing retained-record authority

Builder `scripts/build_uk_price_bundle.mjs:220-266` checks exact quarantine before normalization, then resolves canonical identity; it does not reclassify old observations. `lib/siteHarvestLedgerCore.ts:31-50` only normalizes wine serving labels. `lib/ukPriceBundle.ts:99-151` owns exact category quarantines; no Sun signature is present. Structural validation allows missing label/serving (`181-224`); authority checks standing and quarantine (`232-234`, `266`). The retained rows therefore survive a parser-only future fix.

`lib/ukPriceBundle.server.ts:44-55` caches parsed committed rows after successful read. Its category index (`101-122`) uses the existing authoritative projection. `lib/listedCategoryPrices.ts:42-92` retains eligible category rows with null serving/label where absent. The 365-day listed window (`lib/priceTier.ts:49`) includes these snapshots on Oct 1. Eligibility is retained documentary supply, not independent fresh publisher verification.

Smallest retained-record correction proposal, after Root's meaningful RED and evidence decision: exact gin/source/amount/literal-label quarantine at the existing owner, with raw ledger unchanged and Root's official producer handling generated data. Extend `__tests__/ukPriceBundle.test.ts` to prove parse/authority/category exclusion, raw retention, unrelated genuine fixture gin preservation, and changed source/amount/label/category controls. Do not fabricate a replacement cocktail price or serving.

## Limits and next verification

The three unnamed £10 spirit rows cannot be called genuine single-spirit offers from this ledger. Their matching amount does not prove misclassification either. Missing serving is intentionally representable; generic category deletion would exceed evidence. The Belfast Coffee beer claim is another concrete named-mixture concern requiring its own exact evidence review, not an automatic recategorization.

Actual browser category availability fixtures must not treat the retained Vesper gin claim as verified single-gin supply. Root should obtain permitted primary publisher evidence or historical capture before deciding exact withheld claims beyond the named contradiction. No statement here verifies any live Sun single-spirit offer, a current price, or a serving.
