# Famous venue renewal, 21 October 2026

The freshness repair publishes 70 confirmed venues and withholds 18 unverifiable entries with their full history.
Withdrawal from current recommendations does not assert closure.
The fixed seed reader and the existing verification rules remain unchanged.

## Publication and evidence

The original failure reported `famous_venues` at 405.4 hours against a 384-hour limit.
Sixty-five genuine confirmations were already recorded but had not been applied to the seed.
The existing `applyVerification` function now applies those confirmations and five supported source repairs.
Lahore Kebab House returns on its genuine confirmation.

The new confirmations cover these repairs:

| Venue | Recorded price | Evidence |
| --- | --- | --- |
| Cahoots Underground | Elizabeth, £16.50 | Current Underground menu PDF, extracted through the authorised Firecrawl account at 21:25:41 UTC |
| Super Kebab | Lamb Doner L, £14 | Permitted live GET of `/Menu` at 21:26 UTC |
| VQ Chelsea | Breakfast Burger, £12.95 | Current Chelsea menu PDF inspected at 21:15:02 UTC |
| The Wolseley | The English, one breakfast dish, £24.50 | Official breakfast PDF, extracted through authorised Firecrawl at 21:26:35 UTC |
| Wiltons | Potted Shrimps, warm or cold, £28 | Current menu PDF inspected at 21:15:02 UTC |

Each price retains its actual source observation date.
All other published anchors retain their earlier price dates, even though venue confirmations advance to 21 October.
The Cahoots price is for one alcoholic cocktail, separate from its non-alcoholic alternative and shared drinks.
The VQ price avoids the ambiguous two-price Full English entry and separate cover charge.
No private-room minimum spend becomes a drink price.

The supplied menus also establish corrected Swift Soho, Swift Borough, and Bar Termini prices.
Those repaired candidates remain in the archive because the daily Places quota could not support their required identity checks.
Their old prices and dates remain intact in their archived original rows.

## Preserved records

- [Original combined verification](../data/famous_venues/verification_2026-10-21.json) retains all 65 original confirmations and earlier failures.
- [Source repair receipt](../data/famous_venues/receipts/source_repairs_2026-10-21.json) records four confirmations, seven repaired candidates, source inspections, and input hashes.
- [Wolseley repair receipt](../data/famous_venues/receipts/wolseley_source_repair_2026-10-21.json) records the fifth confirmation and both Firecrawl input hashes.
- [Withholding archive](../data/famous_venues/withheld_2026-10-21.json) retains 18 withheld original rows and the full restored Wolseley row, their original observations, failure reasons, source reviews, and restoration requirements.
- [Publication record](../data/famous_venues/publication_2026-10-21.json) identifies every published and withheld ID.

Original owner receipts remain unchanged.
The archive records permitted canonical Connaught and Coburg pages and the refusals for their menu PDFs.
The SOMA PDF remains blocked by robots.
The ECC menu host returned a robots challenge, and the Vault page was a challenge.
Those refusals were not bypassed.

## Quota

Google Monitoring reported 139 SearchText attempts before the final request: 136 successful requests and three HTTP 429 responses.
The effective daily limit was 140.
The final Cahoots check used one attempt and confirmed the venue.
This phase used one new attempt, bringing the recorded task total from 19 to 20 of its 39-attempt ceiling.
Super Kebab, VQ, and Wiltons reuse genuine same-day identity matches after their source repairs.
No further Places requests were made.
No Details requests, quota changes, billing changes, credentials, or raw Places responses were stored.

## Generated data and verification

`npm run refresh:slim` rebuilt the index at `2026-10-21T00:00:00.000Z`.
The earliest published expiry is `2026-11-20T00:00:00.000Z`.
The existing two-week lead rule derives a 384-hour budget and a deadline of 6 November at 00:00 UTC.
No expiry window or freshness limit increased.

The first data validation found two base-map rows that still referenced withdrawn curated IDs.
The existing base-shard builder regenerated those references from the current slim index.
The base-map comparison confirms exactly two owner changes, with no added or removed OSM rows.
The place-index builder restored the companion index after the shard publication.

The four focused data suites passed all 150 tests, including a new archive and publication regression.
The six focused data, base-map, and freshness-route suites then passed all 168 tests.
`PUBMAX_VERIFY_COMMITTED_DATA=1 npm run validate-data` passed all 22 dataset checks after the base data rebuild.
An executable comparison confirmed that all 88 original rows remain represented by the published rows or their complete archived originals.
`npm run check:freshness` passed with two existing advisory stale datasets.
Three durable stores remain explicitly unmeasured without local credentials.
Their absence remains informational in keyless mode and does not become a claim of freshness.

The outer executor owns complete verification, PR publication, and actual ChatGPT testing.
This phase does not run lint, static analysis, the full suite, or deployment.

## Wolseley restoration and dependent data repair

The official breakfast page links the current Winter 2026 PDF.
The PDF states The English at £24.50 and breakfast service until 11:30.
The published anchor retains the breakfast course and the 21 October price observation date.
The repair reuses the original same-day Places identity match, including its place ID and 07:18:57.664 UTC check time.
No new Google request occurred.
The original failed receipt remains unchanged.
The archive moves Wolseley into `restoredRows` and preserves its complete original row and earlier inspections.
The active seed now contains 27 bars, 19 late-food venues, and 24 restaurants.

The walking table still referenced fourteen venues removed by the earlier publication.
Restoring Wolseley leaves thirteen withdrawn endpoints to remove.
The repair removes 2,416 affected edges and remaps indices consistently.
All 39,696 pairs with two active endpoints retain their exact measured distances and original Overture and OpenStreetMap provenance.
No route was invented or recalculated.

The existing slim and base builders ran after restoration.
The slim rebuild also recalculates Duck and Waffle's restaurant price band from the restored restaurant distribution.
The freshness stamp remains 21 October, and the earliest expiry remains 20 November.
Their derived budget remains 384 hours.
Revision-only builder changes were removed after semantic comparison.

The original two suites reproduced three failures before the repair.
Installed Chrome then measured the actual MapLibre 6.14.0 engine at 390 by 844 pixels through the existing painted-pin probe.
The camera did not move before measurement.
The [engine receipt](proof/map-opening-20261021/engine-phone-frame.json) records all six painted clusters and their centres.
The fixture now uses those independent engine measurements and retains every centre and projection assertion.
The first browser attempt failed because the temporary driver's transpiler helper was absent from its injected script.
Correcting that driver setup produced the recorded measurement.

The five focused data suites passed 157 tests.
The two originally failing suites passed all 28 tests after the repair.
The final combined run passed all 179 tests across the six focused suites.
Committed data validation and the freshness check passed.
The existing two advisory stale datasets and three unmeasured durable stores remain explicit.
No linter, formatter, static analysis, full suite, merge, or deployment ran in this phase.
