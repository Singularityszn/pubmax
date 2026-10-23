# Google Places refresh

`data/places_enrichment.json` (London) and `data/places_enrichment_uk_cities.json` (UK cities) hold opening hours, addresses, phones and websites copied from Google Places for verified place ids. Each field keeps its own `observedAt`. Addresses, phones and websites keep showing under that date. Opening hours set open state, busyness, get-in and plan route evidence only for 30 days from their own date (`PLACES_REFRESH_DAYS`), after which a venue falls back to its other hours sources or to unknown.

## Where it stands (as committed on 2026-10-17)

| | London | UK cities |
| --- | --- | --- |
| Venues copied | 3,053 | 1,400 |
| With opening hours | 2,935 | 1,334 |
| Copied | 2026-10-04 10:22 to 10:34 UTC | 2026-10-04 15:16 to 15:21 UTC |
| Freshness lane reads stale | 2026-10-20 10:22 UTC | (same lane) |
| A `--refresh` may start | 2026-10-20 10:22 UTC | 2026-10-20 15:16 UTC |
| Hours stop setting open state | 2026-11-03 10:22 UTC | 2026-11-03 15:16 UTC |
| Spend cap | USD 85 per calendar month (UTC); October has USD 23.94 left | USD 28 in total, shared with both extras packs; **all of it is spent** |

The `google_places_content` lane is advisory, so it warns rather than failing the release gate. Its 384h budget is the 30-day window less a two-week lead, and `--refresh` opens at the same moment.

**The London pack** needs about 3,053 calls at USD 20 per 1,000, so about USD 61. That does not fit October's USD 23.94, so run it from 1 November (UTC), when the month's cap resets, and before 3 November 10:22 UTC.

**The UK-city pack** cannot be refreshed until its USD 28 task cap is raised. That cap never resets, and the 4 October push spent all of it. Raising it is the captain's decision (`config.cap` for `uk_cities` in `scripts/enrich_google_places.mjs`). Unless it is raised, the UK-city hours stop setting open state on 3 November for good, while their addresses, phones and websites keep showing with their dates.

## Who can do this

Anyone with the Places API key in `.env.local` who can reach `places.googleapis.com`. The agent cloud containers cannot.

## Steps

For a local preview without external requests, run `npm run enrich:google-places -- --dry-run --refresh`.
Add `--pack=uk_cities` to inspect the shared task cap. The preview does not refresh any copied field.

`--usage` reads live Google metrics. `--write --exclusive` changes daily quota overrides before requests and restores them afterwards.
If production settings must stay unchanged, use the preview only.

1. Start from fresh `main` on a new branch.
2. Preview the push and the spend: `npm run enrich:google-places -- --dry-run --usage --refresh`. Add `--pack=uk_cities` for the UK-city pack. Check that the planned calls fit the cap it reports.
3. Wait for any other job that shares the key to finish, then run `npm run enrich:google-places -- --write --exclusive --refresh` (with the same `--pack=`). A push that stops part way resumes with the same command without `--refresh`.
4. Run `npm run build:places-enrichment` so `data/places_enrichment_stamp.json` matches the packs.
5. Run `npm run check:freshness`, `npm run validate-data` and `npx vitest run __tests__/placesEnrichmentData.test.ts __tests__/placesFreshnessLead.test.ts`, then commit the packs and the stamp.

The full rules (spend ledger, row failures, quota handling) are in `docs/rules/lib-venues-areas-listings-and-nights.md`.

## Next time

Copied hours serve for 30 days. The lane warns, and a refresh may start, 16 days after the oldest copy. Plan the push inside that two-week window and inside the month's cap.
