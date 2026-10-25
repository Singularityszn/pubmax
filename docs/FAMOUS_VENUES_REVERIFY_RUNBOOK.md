# Famous venues re-verification

The famous bars, late-food spots and restaurants in `data/famous_venues/` (`bars.json`, `late_food.json`, `restaurants.json`) ship in `public/data/venues_slim.json` only while each row's verification window is open. A window is 30 days from the row's `observedAt` to its `expiresAt`. `npm run verify:famous-venues -- --write` renews a window by checking each row against a live Google Places Text Search. `npm run refresh:slim` then rebuilds the slim index at the new clock.

The app does not check a famous venue's expiry when it serves it. The slim index was built on a fixed date, and every row in it keeps showing until the next `refresh:slim`. The freshness gate is the only warning, and it is set to fire two weeks before the earliest row in the current build expires.

## Publication on 2026-10-21

| | |
| --- | --- |
| Slim built at | 2026-10-21 (`venues_slim.json` `generatedAt`, the `famous_venues` literal stamp) |
| Gate turns red | After 2026-11-06 00:00 UTC, when the 384-hour budget is exceeded |
| Rows shipping | 70 (27 bars, 19 late food, 24 restaurants) |
| Those rows lapse | 2026-11-20. After that day the slim still shows them until rebuilt. |
| Withheld | 18 complete withheld seed rows archived in `data/famous_venues/withheld_2026-10-21.json` |

The captain authorised withholding unverifiable entries while retaining their history.
Withdrawal from current recommendations does not assert that a venue closed.
The fixed seed files contain only confirmed rows after this publication.
The archive retains original rows, price observations, source checks, repaired candidates, and restoration requirements.
`removed.json` records each withdrawn ID for the existing slim rebuild guard.
Restoration requires supported identity and price evidence, removal of the ID from `removed.json`, and another slim rebuild.

The [publication report](FAMOUS_VENUES_REVERIFY_2026-10-21.md) records the evidence and quota limits.
Lahore Kebab House returned on its genuine 2026-10-21 confirmation.
Wolseley returned after its official current breakfast PDF repaired the old source failure.
The archive retains its full original row under `restoredRows`.
Its derived confirmation reuses the original same-day Places identity receipt without another request.
Price dates remain separate from venue confirmation dates.

## Who can do this

Anyone with a Google Places API key who can reach `places.googleapis.com`. The npm script reads `GOOGLE_PLACES_API_KEY` from `.env.local`. A full run makes one Text Search call per active seed row and stops at 100. Check available daily quota before selecting a batch. The committed verification file keeps only the place id and the verdict, never Google's names, addresses or statuses (Maps terms).

## Steps

1. Start from fresh `main` on a new branch.
2. Run `npm run verify:famous-venues -- --write`. Each row prints one outcome:
   - `CONFIRMED`: the row's `observedAt` and `expiresAt` move to today and today plus 30 days.
   - `CLOSED`: Places reports the venue permanently closed, so `--write` drops the row. The output names the ids to add to `data/famous_venues/removed.json`. Add them in the same change, or the next step refuses to drop a venue the last slim shipped.
   - `UNVERIFIED`: no confident match, an ambiguous one, a temporary closure, or a price anchor that has moved. The row is left as it was and keeps its old `expiresAt`.

   The run writes `data/famous_venues/verification_<today>.json`. It exits nonzero when any row is unverified, after writing. A failed Places call stops the run before anything is written. A second `--write` on the same day refuses to overwrite that day's file.
3. For each `UNVERIFIED` row, open its `sourceUrl` and decide:
   - **The venue still trades and the match was the problem.** Fix the row (name, address, `lat`/`lng` or `anchor`) and re-check it on a later day with `npm run verify:famous-venues -- --write --limit N`, where N is the number of rows you fixed. It cannot be re-checked the same day: the full run's checks count against `--limit`, so a same-day `--limit` run calls Places for nothing. On a later day the run takes rows oldest `observedAt` first, and an unverified row kept its old date while every confirmed row moved to the full run's day, so the rows it picks are the ones you fixed. Then repeat steps 4 to 8.
   - **The venue is gone.** Delete the row and add its id to `removed.json`.
   - **You leave it.** It ships until its old `expiresAt` and then drops out on the next refresh.
   - **The captain authorises withholding.** Archive the full original row and the source failure before removing it from the active seed. Add its ID to `removed.json`. Record restoration requirements without asserting closure.
4. Run `npm run refresh:slim`. It rebuilds `public/data/venues_slim.json` at the latest seed `observedAt` or `expiresAt` on or before today, and fails rather than silently drop a shipped venue. Commit the slim it writes.
5. Update the `famous_venues` entry in `data/freshness_registry.json`:
   - `stamp.value`: the new slim `generatedAt`.
   - `stalenessBudgetHours`: hours from that stamp to two weeks before the earliest `expiresAt` still in the build.

   If every row was confirmed today, that is 384 again. Any unverified row that still ships makes it shorter. `npx vitest run __tests__/venuesSlim.test.ts` prints the exact expected values if you get either one wrong.
6. If withdrawals affect `data/pub_walk_pairs.json`, prune only withdrawn endpoints and remap indices while retaining every valid measured pair.
   Re-measure changed opening clusters through the real MapLibre painted-pin browser probe before updating its fixture.
7. Run `npm run build:uk-base` if withdrawn venues owned base rows. This regenerates base shards and their place indexes without obsolete curated-owner references.
8. Run `npm run check:freshness`, `npm run validate-data` and `npx vitest run __tests__/venuesSlim.test.ts __tests__/famousVenuesSeed.test.ts __tests__/verifyFamousVenuesWrite.test.ts __tests__/famousVenuePlacesVerify.test.ts`. The pack counts in `venuesSlim.test.ts` follow the slim's own clock, so they need no hand edits.

The rule behind steps 4 and 5 is "A slim rebuild that drops a shipped famous venue fails" in `docs/rules/scripts-builders-and-publishers.md`.

## Next time

A confirmed row is good for 30 days, and the gate fires 16 days after a full re-verification. Re-verify inside that fortnight, or the gate turns red. Two weeks after that the rows lapse while the slim keeps showing them.
