# Famous venue renewal evidence, 21 October 2026

Freshness remains blocked. Eighteen of the 82 shipped rows still need source repairs or accessible evidence before renewal.
The outer executor must retain this failure until those rows pass the existing verifier.

## Results

- `npm run check:freshness` reproduced the failure before this work and still exits 1 afterwards.
- The final check reports `famous_venues` at 405.2 hours against its 384-hour limit.
- The three durable stores without credentials remain informational in keyless mode under `freshnessGateFailed`.
- Two supplied owner receipts contain 44 confirmed checks. These cover 43 shipped rows and the previously withheld Lahore Kebab House.
- Nineteen new Text Search attempts produced 18 confirmations and one anchor ownership failure.
- Three earlier operational matches passed fresh anchor checks without another Places request.
- The combined receipt contains 65 confirmations, including 64 shipped rows.
- All 149 tests passed in the four focused data suites.

The seed dates, price observation dates, slim index, freshness registry and plugin code remain unchanged.
Applying the confirmed checks in memory still leaves an earliest expiry of `2026-11-04T00:00:00.000Z`.
The runbook therefore derives a freshness deadline of `2026-10-21T00:00:00.000Z` and a zero-hour budget for today's candidate stamp.
A partial publication cannot resolve this failure. No seed changes or slim rebuild were published.

## Receipts and quota

[The combined verification receipt](../data/famous_venues/verification_2026-10-21.json) retains the actual Places `checkedAt` values and each live anchor inspection.
Recovered anchor checks retain their original Places timestamps and add separate `anchorCheckedAt` values.
Original owner receipts are copied unchanged into `data/famous_venues/receipts/`, with their SHA-256 hashes in the combined receipt.
The original owner checkouts were read only.

Google Monitoring reported 102 SearchText attempts before the new calls: 100 successful requests and two HTTP 429 responses.
This work made 19 additional attempts, with no retries, within the 140 daily limit and the 39-attempt task limit.
The receipt's 119 cumulative live calls combine 100 calls from the supplied owner receipts with these 19 calls.
The two earlier rejected requests remain separately represented by the Monitoring baseline.
No Details calls, quota changes, raw Places responses or credentials were stored.

The source checks applied the existing source predicate and robots rules before reading anchor headers.
Redirected robots files were checked through the existing robots consumer with source checks on redirect destinations.
No refused source was bypassed.

## Remaining shipped rows

These results describe the source checks made during this attempt. Redirects require source review before a row can change.

| Row | Evidence and remaining work |
| --- | --- |
| `bar-connaught` | The anchor returns HTTP 308 to the general restaurants and bars page. Verify a venue-specific price source. |
| `bar-coburg` | The anchor returns HTTP 308 to the general restaurants and bars page. Verify a venue-specific price source. |
| `bar-donovan` | Robots permits the path, but the anchor returns HTTP 403. Accessible source evidence is required. |
| `bar-swift-soho` | The anchor redirects to `http://www.barswift.com/swift-soho`. Verify the new source and its price before changing the row. |
| `bar-swift-borough` | The anchor redirects to `http://www.barswift.com/swift-borough`. Verify the new source and its price before changing the row. |
| `bar-bar-termini` | The anchor redirects to `https://bar-termini-soho.com/`. Verify the new source and its price. |
| `bar-kwant` | Places confirms the identity, but the existing anchor fails `anchor_source_not_row_source`. Verify ownership and source evidence without weakening that guard. |
| `bar-ecc-chinatown` | The anchor redirects to the Experimental Group Chinatown page. Verify the new source and its price. |
| `bar-cahoots` | The anchor redirects to `https://www.cahoots.co.uk/`. Verify the specific venue and its price source. |
| `bar-vault-milroys` | The anchor redirects to `https://milroysofsoho.com/pages/the-vault`. Verify the new source and its price. |
| `bar-soma-soho` | The anchor redirects to `https://soma.london/`. Verify the specific venue and its price source. |
| `food-super-kebab` | The source permits access but answers HEAD with HTTP 405. A permitted document read must establish anchor availability. |
| `food-berenjak-soho` | Robots returns HTTP 429. Wait for permitted access or obtain another supported source. |
| `food-bar-italia` | Instagram robots disallows the anchor path for all crawlers. Obtain permitted price evidence. |
| `food-vq-chelsea` | The anchor redirects to `https://vqrestaurants.com/chelsea/`. Verify the new source and its price. |
| `restaurant-wolseley` | The anchored breakfast PDF returns HTTP 404. Obtain a current, supported menu source. |
| `restaurant-wiltons` | The anchored PDF redirects to a Squarespace CDN document. Verify that document and its price before changing provenance. |
| `restaurant-flat-iron-soho` | Robots returns HTTP 403. Obtain permitted price evidence. |

Seven of these rows had no prior Places check and no usable anchor in this attempt.
They were not sent to Places: Swift Soho, Swift Borough, Bar Termini, Experimental Cocktail Club, Cahoots, The Vault and SOMA.
The combined receipt retains each inspected URL, redirect destination, HTTP status and permission result.

## Other withheld rows

- `bar-beaufort-bar-savoy`, `food-wong-kei` and `food-golden-dragon` have no price anchor. They remain withheld.
- `food-mangal-1` retains its earlier location mismatch. Its source now redirects to `https://swhelper.org/`.
- `food-maroush-edgware-road` retains its earlier name mismatch. Its unchanged input was not queried again.

No rows or anchors were removed to change the result.

## Focused verification

The following command passed all 149 tests:

```sh
./node_modules/.bin/vitest run __tests__/venuesSlim.test.ts __tests__/famousVenuesSeed.test.ts __tests__/verifyFamousVenuesWrite.test.ts __tests__/famousVenuePlacesVerify.test.ts
```

`npm run check:freshness` still exits 1. An executable receipt check also passed against `applyVerification` and the real seed rows.
It checked receipt hashes, unique identities, summaries, preserved price dates and the unresolved expiry deadline.

The outer executor owns full verification and subsequent delivery phases after the source blockers are resolved.
