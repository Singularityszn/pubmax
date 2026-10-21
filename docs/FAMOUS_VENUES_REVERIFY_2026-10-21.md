# Famous venue renewal, 21 October 2026

The freshness repair publishes 69 confirmed venues and withholds 19 unverifiable entries with their full history.
Withdrawal from current recommendations does not assert closure.
The fixed seed reader and the existing verification rules remain unchanged.

## Publication and evidence

The original failure reported `famous_venues` at 405.4 hours against a 384-hour limit.
Sixty-five genuine confirmations were already recorded but had not been applied to the seed.
The existing `applyVerification` function now applies those confirmations and four supported source repairs.
Lahore Kebab House returns on its genuine confirmation.

The new confirmations cover these repairs:

| Venue | Recorded price | Evidence |
| --- | --- | --- |
| Cahoots Underground | Elizabeth, £16.50 | Current Underground menu PDF, extracted through the authorised Firecrawl account at 21:25:41 UTC |
| Super Kebab | Lamb Doner L, £14 | Permitted live GET of `/Menu` at 21:26 UTC |
| VQ Chelsea | Breakfast Burger, £12.95 | Current Chelsea menu PDF inspected at 21:15:02 UTC |
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
- [Withholding archive](../data/famous_venues/withheld_2026-10-21.json) retains 19 full original rows, their original observations, failure reasons, source reviews, and restoration requirements.
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
