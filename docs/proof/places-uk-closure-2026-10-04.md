# UK city closure verification, 2026-10-04

The UK snapshot holds 38,118 pubs. A full run projected at least USD 563.01, even with all 5,000 monthly free Pro calls available. The approved scope changed to the biggest cities outside London within USD 40, in this order: Manchester, Birmingham, Edinburgh, Glasgow, Leeds, Bristol, Liverpool, then further cities while budget remained.

Firstmate confirmed exclusive Places use after the opening-hours job finished. The live baseline was 4,130 monthly GetPlace requests. The guard conservatively counted every prior Details request against the Pro free allowance, including requests that might have used another SKU. It reserved 870 free calls and 2,352 paid calls. IDs-only searches that returned no match or an ambiguous match released their reserved Details slots for later city rows.

## Before and after

| Measurement | Before | After |
| --- | ---: | ---: |
| UK city verdict ledger rows | 0 | 3,950 |
| Place Details attempts in this job | 0 | 3,222 |
| Usable permanent-closure verdicts | 0 | 3,166 |
| No matching Place ID | 0 | 258 |
| Ambiguous Place ID matches | 0 | 470 |
| Unreadable business status | 0 | 56 |
| Confirmed permanent closures from this job | 0 | 0 |
| Unconfirmed permanent closures from this job | 0 | 0 |
| Search daily quota | 100 | 100 restored |
| Details daily quota | 60 | 60 restored |

Actual requests imply a conservative tariff upper bound of **USD 39.984** for this job. This is not a billing invoice. The initial and final projections both stayed below USD 40; another paid attempt would exceed the cap.

## Coverage

| City | Pub rows searched | Selected scope |
| --- | ---: | --- |
| Manchester | 565 | Existing city box or OSM locality |
| Birmingham | 323 | Existing city box or OSM locality |
| Edinburgh | 344 | Recorded verification box or OSM locality |
| Glasgow | 348 | Existing city box or OSM locality |
| Leeds | 410 | Existing city box or OSM locality |
| Bristol | 499 | Existing city box or OSM locality |
| Liverpool | 420 | Existing city box or OSM locality |
| Sheffield | 355 | OSM locality only |
| Bradford | 122 | OSM locality only |
| Nottingham | 405 | OSM locality only |
| Leicester | 92 | OSM locality only |
| Coventry | 67 of 87 | OSM locality only, stopped at budget cap |

These are dataset rows in the stated scopes, not a claim that every pub in each municipal boundary was checked. London was excluded. The ledger records each search outcome and derived verdict. Google names remain transient; names, addresses, hours, reviews and photos from Google are not stored. Only Place IDs and our own derived verdicts survive.

The existing closure path still requires a unique nearby Place ID, permanent-closure status and name agreement before hiding a pub. No-match, ambiguous, unreadable and mismatched-name results do not hide venues. No venue was hidden by this run; no rendered UI change is claimed.

## Validation

- The dry-run CLI tests failed before implementation and passed afterward.
- `npm run verify` passed after its official prevalidation builders repaired a stale local generated venue-detail cache. No tracked bundled-data changes resulted from that rebuild.
- After the live ledger was written, the CLI, ledger, closure, UK base-map and national-search suites passed: 74 tests in four files.
- ESLint passed for changed source and tests. `git diff --check` passed.
- The live command exited successfully and confirmed both original daily quotas were restored. Its checkpoint was removed.

Run `node --import tsx scripts/verify_london_places.mjs --uk-cities --dry-run` to inspect the current plan. `--uk-cities` runs it with `GOOGLE_PLACES_API_KEY` supplied by the caller. `--prior-details` is accepted only for an offline dry run. A checkpoint whose monthly usage has changed refuses to resume until its spend is reviewed.
