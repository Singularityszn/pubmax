# Famous venues re-verification

The famous bars, late-food spots and restaurants in `data/famous_venues/` (`bars.json`, `late_food.json`, `restaurants.json`) ship in `public/data/venues_slim.json` only while each row's verification window is open. A window is 30 days from the row's `observedAt` to its `expiresAt`. `npm run verify:famous-venues -- --write` renews a window by checking each row against a live Google Places Text Search. `npm run refresh:slim` then rebuilds the slim index at the new clock.

The app does not check a famous venue's expiry when it serves it. The slim index was built on a fixed date, and every row in it keeps showing until the next `refresh:slim`. The freshness gate is the only warning, and it is set to fire two weeks before the earliest row in the current build expires.

## Publication records

The [2026-11-06 verification receipt](../data/famous_venues/verification_2026-11-06.json) owns the run outcomes and Places call counts.
The [2026-11-06 withholding archive](../data/famous_venues/withheld_2026-11-06.json) owns the captain's decision, full original rows, failed checks, and restoration requirements.
Withdrawal from current recommendations does not assert that a venue closed.

The active seed files own each venue's verification window and price observation date.
The `generatedAt` field in `public/data/venues_slim.json` records the committed slim clock.
The `famous_venues` entry in the [freshness registry](../data/freshness_registry.json) owns the freshness stamp and budget.
Step 5 explains how to derive that budget.

The [2026-10-21 publication report](FAMOUS_VENUES_REVERIFY_2026-10-21.md) records the earlier publication, source repairs, and quota limits.

## Who can do this

Anyone with a Google Places API key who can reach `places.googleapis.com`. The npm script reads `GOOGLE_PLACES_API_KEY` from `.env.local`. A full run makes one Text Search call per active seed row and stops at 100. Check available daily quota before selecting a batch. The committed verification file keeps only the place id and the verdict, never Google's names, addresses or statuses (Maps terms).

## Steps

1. Start from fresh `main` on a new branch.
2. Run `npm run verify:famous-venues -- --write`. Each row prints one outcome:
   - `CONFIRMED`: the row's `observedAt` and `expiresAt` move to today and today plus 30 days.
   - `CLOSED`: Places reports the venue permanently closed, so `--write` drops the row. The output names the ids to add to `data/famous_venues/removed.json`. Add them in the same change, or the next step refuses to drop a venue the last slim shipped.
   - `UNVERIFIED`: no confident match, an ambiguous one, a temporary closure, or a price anchor that fails the checks below. The row keeps its existing values, including its old `expiresAt`.

   A confident Places match also needs a price anchor under one of the row's own source pages.
   The verifier checks [source policy and robots permission](rules/scripts-harvest-and-source-permission.md) before sending one anchor HEAD request, which reads response headers.
   Permission refusals and request failures produce `anchor_source_unreachable` and leave the row unverified.

   The anchor HEAD never follows a redirect or requests its target.
   A redirect that only adds or removes `www.` or a trailing slash still counts as the same page.
   A missing or malformed redirect location, or a redirect to another page, produces `anchor_source_redirected` and leaves the row unverified.

   The run writes `data/famous_venues/verification_<today>.json`.
   A full run exits nonzero after writing if any row is unverified.
   A `--write --limit N` batch records unverified rows and exits successfully.
   A failed Places call stops the run before anything is written.
   Without `--limit`, a second `--write` on the same day refuses to overwrite that day's file.
   With `--limit`, today's checks count towards N, and new checks merge into the existing file.
3. For each `UNVERIFIED` row, open its `sourceUrl` and decide:
   - **The venue still trades and the match was the problem.** Fix the row (name, address, `lat`/`lng` or `anchor`) and re-check it on a later day with `npm run verify:famous-venues -- --write --limit N`, where N is the number of rows you fixed. It cannot be re-checked the same day: the full run's checks count against `--limit`, so a same-day `--limit` run calls Places for nothing. On a later day the run takes rows oldest `observedAt` first, and an unverified row kept its old date while every confirmed row moved to the full run's day, so the rows it picks are the ones you fixed. Then repeat steps 4 to 8.
   - **The venue is gone.** Delete the row and add its id to `removed.json`.
   - **You leave it.** It ships until its old `expiresAt` and then drops out on the next refresh.
   - **The captain authorises withholding.** Archive the full original row and the source failure before removing it from the active seed. Add its ID to `removed.json`. Record restoration requirements without asserting closure.

   Restoration requires supported identity and price evidence, removal of the ID from `removed.json`, and another slim rebuild.
   Price observation dates remain separate from venue confirmation dates.
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
