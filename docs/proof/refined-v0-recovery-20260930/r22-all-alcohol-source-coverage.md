# All-alcohol source coverage check (R22)

Read-only review of source taxonomy, committed price records and their display/provenance owners in `/Users/karanmanoharan/.codex/worktrees/v0-integration/pubmaxx`. No tests, browser, API, network or production checks were run. Counts below describe rows in the committed generated bundle, not distinct purchasable offers or production availability.

## What the committed bundle contains

`public/data/uk_prices/manifest.json` was generated 2026-09-29. It reports 7,603 rows: 4,643 `listed` rows and 2,960 `estimate` rows. The estimates are beer-category only, unnamed and without serving size. Listed rows have source URL and observation date in the bundle contract; drink labels and serving sizes are optional fields.

| Requested coverage | Stored `listed` rows | Printed label field | Serving field | `observedAt` range | What evidence supports |
| --- | ---: | ---: | ---: | --- | --- |
| Beer | 142 (123 site-harvest, 19 drink-price-update) | 58 | 6 | 2026-07-18 to 2026-09-21 | Listed bundle records. Separate 2,960 beer estimates are modelled category figures, not publisher prices. |
| Cider | 6, inside `beer` as subtype `beer-cider` | 6 | 1 | 2026-07-26 to 2026-09-21 | No standalone cider category. Example: “ROSÉ CIDER Hibiscus & Ginger”, £6.30, `pint`, observed 2026-07-26, Bundobust source URL. Five other cider-subtype rows have no serving size. |
| Wine | 2,193 (1,327 site-harvest, 866 drink-price-update) | 1,954 | 24 | 2026-07-11 to 2026-09-29 | Example with explicit comparable serve: “Sauvignon Blanc, New Zealand”, 250 ml, £13, observed 2026-09-29, Sydney Arms menu URL. Other rows usually lack a serving field. |
| Spirits | 436 across whisky 62, gin 84, vodka 90, rum 200; all site-harvest | 146 | 0 | 2026-09-04 to 2026-09-21 | No umbrella `spirits` category and no structured serving sizes in these rows. |
| Shots | 72, site-harvest | 30 | 0 | 2026-09-04 to 2026-09-21 | Stored as a separate category, but row classification is not dependable by count alone: one `shot` row is named “Altos Plata Tequila, Beesou Honey, Green Chilli, Lima, Soda Sparkling Marg”, £12, from Richard the First’s menu. |
| Cocktails | 1,575 (900 site-harvest, 675 drink-price-update) | 1,366 | 0 | 2026-07-11 to 2026-09-21 | Named rows exist, but no structured serving sizes. |
| All alcohol | No all-alcohol category or aggregate | n/a | n/a | n/a | `Drink.alcoholType` is optional and may be `unknown`; category alone cannot prove alcoholic status. Beer contains at least one `Thatchers 0%` row. Do not sum the category counts into a total of alcoholic offers. |

“Label field” means the bundle has a nonempty printed-name field. It is not a manual validation count. The bundle README says its builder quarantines known contradictions, but quarantining does not reclassify rows. The shot example above shows why category totals cannot stand in for accurate category supply. The 30 serving fields across all listed rows are just 24 wine and 6 beer entries; no serving is inferred when absent.

## Meaning and limits of those rows

- `lib/drinks.ts` defines beer, wine, whisky, gin, vodka, rum, cocktail and shot as separate categories. Cider is `beer-cider`, a subtype under beer. It has no first-class category. `AlcoholType` can be `alcoholic`, `low-no` or `unknown`; the field is optional and missing ABV/name evidence can leave it unknown.
- The bundle distinguishes `listed` from `estimate`. Listed rows carry their printed label when available, publisher/source URL, source lane and `observedAt`. Estimates require a basis and sample size and must remain identified as estimates. They do not show what a pub currently sells.
- The 1,560 listed `drink-price-update` rows (beer 19, wine 866, cocktails 675) are dated static snapshots. The E1 drink menu shows their “Snapshot from” date, by design; this lane has no per-row expiry window. Site-harvest category quotes flow through `listedCategoryPrices`, which excludes beer and applies `priceStandingFor`. The listed-price policy expires a row after 365 days. Community reports have a separate corroboration/30-day authority policy. The generic `confirmed` standing has no producer, per `lib/priceTier.ts`. These windows do not turn an unverified source row into a live offer.
- `drinkSeeds` and the three demo update rows are fixtures, not supply. Demo rows are excluded from the committed bundle’s 1,560 listed update rows. The seed lane is visibly marked “Demo” and opt-in. No fixture counts appear in the table.
- Published/listed and community observations remain separate. `VenueDrinkPrices` labels published-menu quotes separately from “Logged by a PUBMAXXER” reports. The bundle totals above include no community observations, and no live community store was read for this review.
- Serving sizes are source text. The UI says “Serving not recorded” when missing. `listedPriceComparison` only ranks recognized equal millilitre serves; unknown or mixed measures remain unranked. Community’s `pint | half | other` measure is a separate, narrower vocabulary and cannot fill missing menu serving data.

## Highest proof gap

No browser/API proof here establishes that an actual committed publisher row reaches a venue sheet with exact name, price, serving, observation date and source link while community evidence remains visibly separate. Existing menu tests use injected fixtures. A subsequent source trace found that the Sydney Arms example is not currently a viable curated endpoint proof: its `venue-uk-n8308248176` identity is not resolved by the curated venue-detail reader, and the UK-base sheet does not consume listed bundle prices. The drink-menu update path consumes a different snapshot lane. Moreover, the curated representative-price projection would suppress the £13 Sauvignon Blanc 250 ml row behind the cheaper £10.50 Rioja of the same serving size. See the [follow-up trace](r23-publisher-row-source-path.md). A future actual browser proof must first establish the correct base-sheet data path, or select a real curated winning quote. Neither would prove a dated row is still on sale today.

## Source owners

- Taxonomy and optional alcohol/serving fields: `lib/drinks.ts`, `lib/drinkSubtypes.ts`.
- Committed row schema, lanes and limitations: `public/data/uk_prices/README.md`, `public/data/uk_prices/manifest.json`, `public/data/uk_prices/rows.json`.
- Price standing/expiry: `lib/priceTier.ts`, `lib/listedCategoryPrices.ts`, `lib/listedPriceComparison.ts`.
- Static update merge and date caption: `lib/drinkPriceUpdates.ts`, `lib/venueMenu.ts`, `components/drinks/DrinkMenu.tsx`.
- Separate listed/community presentation: `components/map/VenueDrinkPrices.tsx`; community policy: `lib/communityPrice.ts`, `docs/rules/lib-prices-trust-and-drinks.md`.
