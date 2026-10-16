# Famous venues re-verification

The famous bars, late-food spots and restaurants in `data/famous_venues/` (`bars.json`, `late_food.json`, `restaurants.json`) ship in `public/data/venues_slim.json` only while each row's verification window is open. A window is 30 days from the row's `observedAt` to its `expiresAt`. `npm run verify:famous-venues -- --write` renews a window by checking each row against a live Google Places Text Search. `npm run refresh:slim` then rebuilds the slim index at the new clock.

The app does not check a famous venue's expiry when it serves it. The slim index was built on a fixed date, and every row in it keeps showing until the next `refresh:slim`. The freshness gate is the only warning, and it is set to fire two weeks before the earliest row in the current build expires.

## Where it stands (as committed on 2026-10-16)

| | |
| --- | --- |
| Slim built at | 2026-10-05 (`venues_slim.json` `generatedAt`, the `famous_venues` literal stamp) |
| Gate turns red | 2026-10-21 00:00 UTC (the 384h budget runs out) |
| Rows shipping | 82 (37 bars, 20 late food, 25 restaurants) |
| Those rows lapse | 2026-11-04. After that day the slim still shows them, unverified. |
| Withheld | 6 seed rows: 4 whose window closed on 2026-09-24 (below), and `food-wong-kei` and `food-golden-dragon`, which have no price anchor and are held back on purpose |

The four lapsed rows, with what the last runs found:

| Row | Last result |
| --- | --- |
| `bar-beaufort-bar-savoy` | `places_no_result` on 2026-09-25 and 2026-10-03; not checked on 2026-10-05 |
| `food-mangal-1` | `places_no_confident_match` on 2026-10-05 (exact name, but 403 m from the seed location) |
| `food-lahore-kebab-house` | `places_closed_temporarily` on 2026-10-05 |
| `food-maroush-edgware-road` | `places_no_confident_match` on 2026-10-05 (name tokens did not match) |

## Who can do this

Anyone with a Google Places API key who can reach `places.googleapis.com`. The npm script reads `GOOGLE_PLACES_API_KEY` from `.env.local`. A full run makes one Text Search call per seed row (88 today) and stops at 100. The committed verification file keeps only the place id and the verdict, never Google's names, addresses or statuses (Maps terms).

## Steps

1. Start from fresh `main` on a new branch.
2. Run `npm run verify:famous-venues -- --write`. Each row prints one outcome:
   - `CONFIRMED`: the row's `observedAt` and `expiresAt` move to today and today plus 30 days.
   - `CLOSED`: Places reports the venue permanently closed, so `--write` drops the row. The output names the ids to add to `data/famous_venues/removed.json`. Add them in the same change, or the next step refuses to drop a venue the last slim shipped.
   - `UNVERIFIED`: no confident match, an ambiguous one, a temporary closure, or a price anchor that has moved. The row is left as it was and keeps its old `expiresAt`.

   The run writes `data/famous_venues/verification_<today>.json`. It exits nonzero when any row is unverified, after writing. A failed Places call stops the run before anything is written. A second `--write` on the same day refuses to overwrite that day's file.
3. For each `UNVERIFIED` row, open its `sourceUrl` and decide. If the venue still trades and the match was the problem, fix the row (name, address, `lat`/`lng` or `anchor`) and re-run with `-- --write --limit 5`. A `--limit` run merges into today's file. If the venue is gone, delete the row and add its id to `removed.json`. If you leave it, it ships until its old `expiresAt` and then drops out on the next refresh.
4. Run `npm run refresh:slim`. It rebuilds `public/data/venues_slim.json` at the latest seed `observedAt` or `expiresAt` on or before today, and fails rather than silently drop a shipped venue. Commit the slim it writes.
5. Update the `famous_venues` entry in `data/freshness_registry.json`:
   - `stamp.value`: the new slim `generatedAt`.
   - `stalenessBudgetHours`: hours from that stamp to two weeks before the earliest `expiresAt` still in the build.

   If every row was confirmed today, that is 384 again. Any unverified row that still ships makes it shorter. `npx vitest run __tests__/venuesSlim.test.ts` prints the exact expected values if you get either one wrong.
6. Run `npm run check:freshness`, `npm run validate-data` and `npx vitest run __tests__/venuesSlim.test.ts __tests__/famousVenuesSeed.test.ts __tests__/verifyFamousVenuesWrite.test.ts __tests__/famousVenuePlacesVerify.test.ts`. The pack counts in `venuesSlim.test.ts` follow the slim's own clock, so they need no hand edits.

The rule behind steps 4 and 5 is "A slim rebuild that drops a shipped famous venue fails" in `docs/rules/scripts-builders-and-publishers.md`.

## Next time

A confirmed row is good for 30 days, and the gate fires 16 days after a full re-verification. Re-verify inside that fortnight, or the gate turns red. Two weeks after that the rows lapse while the slim keeps showing them.
