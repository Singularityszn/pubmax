# London source enrichment, 9 October 2026

This pass adds 87 first-party source records, including 81 hours records and 20 dog statements. The existing producer writes them to `data/amenities/london_pub_website_hours_dogs.json`.

All 176 previous hours records remain unchanged. The shared-chain guard removes one previous generic dog statement. Identical Bohem Brewery hours passages remain excluded. Two directory pages on edan.io are excluded from publication.

The Thirsty Bear publishes two regular cider pint prices: Inches Cider at GBP 5.95 and Whisky Cider at GBP 4.95. The source explicitly labels the columns "Half / Pint". Both rows pass the existing keyless price reader and retain their source URL and read time. The existing bundle producer publishes both named drinks. All 7,595 previous bundle rows remain unchanged.

## Coverage

The denominator is the same 3,641 London shard pub identities before and after the pass. The table uses exact published ownership mappings.

| Field | Before | After | Remaining gaps |
| --- | ---: | ---: | ---: |
| Opening hours | 3,076 | 3,109 | 532 |
| Recorded business-status check | 3,008 | 3,008 | 633 |
| Address | 3,496 | 3,496 | 145 |
| Phone | 2,923 | 2,923 | 718 |
| Website | 2,892 | 2,892 | 749 |
| Google place ID | 3,008 | 3,008 | 633 |
| Source image URL | 460 | 460 | 3,181 |
| Listed non-estimate pint | 44 | 45 | 3,596 |
| Legacy snapshot pint | 568 | 568 | 3,073 |
| Either observed pint lane | 599 | 600 | 3,041 |

The original preflight undercounted prices and images. It treated `curatedRef.id` as a runtime venue ID and omitted UK base IDs. Some references contain OSM source IDs. `coverage.json` preserves those original snapshots beside the corrected before/after pair. The correction uses existing published UK base ownership tuples. It adds no name or distance match.

These are field-inventory counts, not browser or deployment proof. Hours from another lane can already fill a field, so 81 new source records close only 33 inventory gaps. A status-check record does not establish that a pub is operational. An image URL does not prove image rights or rendering. Estimates do not earn observed-price coverage.

The source file grows from 178 to 265 rows, and from 176 to 257 hours records. Dog-welcome statements grow from 19 to 38 after the chain withdrawal. Exact published ownership assigns 57 new rows to curated venues and 30 to UK base venues. The curated detail reader receives the source facts. UK base source facts remain collected evidence because that reader does not consume this hours file. This pass adds no new runtime reader.

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

The existing hours producer and UK price bundle producer generated the changed data. The historical Sydney price audit remains unchanged. A separate later-publication entry accounts for the two new ledger rows. Its test checks the preserved historical prefix, exact additions, evidence hash and final ledger and bundle counts.

- `PUBMAX_VERIFY_COMMITTED_DATA=1 npm run validate-data` passed all 22 datasets.
- Nine focused data suites passed 240 tests with one worker.
- ESLint passed for the changed reconciliation test.
- Three local curated-detail reads returned the new source evidence under the correct IDs.
- Every baseline hours record and previous bundle row passed the before/after comparison.

Full `npm run verify`, no-mistakes, CI and PR delivery remain pending Firstmate's heavy-slot allocation and pipeline instruction. This commit is the implementation handoff. No merge or deployment occurred.
