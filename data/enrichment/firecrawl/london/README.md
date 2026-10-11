# London source enrichment, 9 October 2026

This directory records the 9 October first-party source collection. The existing producer publishes its hours and dog-policy evidence to `data/amenities/london_pub_website_hours_dogs.json`.

The rebased publication retains non-conflicting main records and newer exact-source observations. The shared-chain guard removes one previous generic dog statement. Identical Bohem Brewery hours passages remain excluded. Two directory pages on edan.io are excluded from publication.

The Thirsty Bear publishes two regular cider pint prices: Inches Cider at GBP 5.95 and Whisky Cider at GBP 4.95. The source explicitly labels the columns "Half / Pint". Both rows pass the existing keyless price reader and retain their source URL and read time. The existing bundle producer publishes both named drinks. All 7,595 previous bundle rows remain unchanged.

## Coverage

[`coverage.json`](coverage.json) owns the original before/after inventory. Its `identityAligned` pair uses exact published ownership mappings over the same London shard identities. These snapshots predate the rebase and do not measure coverage of the rebased publication.

The original preflight undercounted prices and images. It treated `curatedRef.id` as a runtime venue ID and omitted UK base IDs. Some references contain OSM source IDs. `coverage.json` preserves those original snapshots beside the corrected before/after pair. The correction uses existing published UK base ownership tuples. It adds no name or distance match.

These are field-inventory counts, not browser or deployment proof. Hours from another lane can already fill a field, so a source record need not close an inventory gap. A status-check record does not establish that a pub is operational. An image URL does not prove image rights or rendering. Estimates do not earn observed-price coverage.

The published source totals are in `counts` in [`london_pub_website_hours_dogs.json`](../../../amenities/london_pub_website_hours_dogs.json). The original collection totals and ownership split remain under `sourceFacts` in `coverage.json`. The curated detail reader receives the source facts. UK base source facts remain collected evidence because that reader does not consume this hours file. This pass adds no new runtime reader.

## Credit plan and spend

Before collection, the selected Firecrawl connection reported 897 credits. Both configured connections reported the same shared balance. They were never added together.

The approved plan reserved at most 500 credits and retained at least 100 account credits. Each plain scrape reserved one credit. A PDF reserved four credits and was limited to four pages. Every response and continuation cursor was cached in ignored task state.

| Measure | Result |
| --- | ---: |
| Original website candidates | 400 |
| Original candidates permitted by robots | 322 |
| Original candidates refused | 78 |
| Completed original source queue | 322 |
| Scrape attempts, including retries | 448 |
| Cached text responses | 430 |
| Cached HTTP 200 responses | 412 |
| Rate-limited attempts | 10 |
| Other failed attempts | 8 |
| Reserved credits | 484 |
| Provider-reported credits used | 452 |
| Final shared balance | 445 |
| Unused pass reservation | 16 |
| Google requests | 0 |
| Google reserved spend | USD 0 |
| Remaining Google budget | USD 100 |

The first 25 attempts used parallel transport and triggered ten rate limits. Firstmate approved recovery after the reset window. Each affected candidate was retried once. Later provider calls, including balance checks, ran serially at least ten seconds apart. Reservations include failures. Credit counts are not invoice dollars.

The pass completed the permitted original queue and selected linked menus. It stopped after the final venue-specific PDFs. Other-venue estate menus, historical menus, shops and offers were excluded. No search, stealth proxy, extraction add-on, purchase or Google photo copying was used.

The Google plan was priced before any paid request on 7 October 2026. ID-only calls were free. Details cost USD 5, 17 or 20 per 1,000 at Essentials, Pro or Enterprise level. Monthly free caps were 10,000, 5,000 and 1,000 respectively. Photo retrieval cost USD 7 per 1,000 with a 1,000-call free cap. The original known-call ceiling was USD 45.278 before overlap savings. It assumed full list price because remaining SKU allowances were unverified. The task retained its USD 95 stop and USD 5 reserve.

Sources: [Google pricing](https://developers.google.com/maps/billing-and-pricing/pricing), [Places field masks](https://developers.google.com/maps/documentation/places/web-service/data-fields), [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies).

Google authentication and quota preflight remain blocked. Tavily had no usable plan credit, and the captain approved Firecrawl instead. This pass changes no billing, quota, migration or deployment.

## Review evidence

`review-notes.json` keeps dated contact and address excerpts from 279 pages concerning 207 distinct pubs. These are review-only observations. They do not replace OSM fields or increase runtime contact coverage.

Three closure notices remain review-only. The Post Bar notice does not establish permanence. Kanpai names its former Peckham premises and its new London Bridge location. Website notices do not enter the Google verification record.

The Simmons estate offer remains rejected. Mr Fogg's combined menu includes other locations and a 330ml cider line, so its extracted prices remain rejected. The Elderfield PDF states bare numeric amounts. The existing reader does not accept them as explicit GBP pint prices, so they remain held. The Thirsty Bear's misattributed GBP 3 candidate is excluded because that amount belongs to a half-pint column.

`accepted-prices.json` records the two accepted source rows. `spend-ledger.json` records every attempt and balance check. `source-decisions.json` records refusals and import exclusions. Raw page dumps and connection identifiers remain outside git.

## Validation and delivery

The existing hours producer generated the original collection artifact. The rebase merged retained records by source and OSM ownership, without new collection. The UK price bundle producer generated the price publication. The [bundle reference](../../../../public/data/uk_prices/README.md#the-rules-that-keep-it-honest) owns the reconciliation publication contract.

The original collection checks recorded the following results:

- `PUBMAX_VERIFY_COMMITTED_DATA=1 npm run validate-data` passed all 22 datasets.
- Nine focused data suites passed 240 tests with one worker.
- ESLint passed for the changed reconciliation test.
- Three local curated-detail reads returned the new source evidence under the correct IDs.
- Every baseline hours record and previous bundle row passed the before/after comparison.

These checks predate the rebase and do not validate the rebased publication. These records establish no full `npm run verify`, CI, PR delivery, merge or deployment result for the rebased head.
