# Late-food evidence re-review

`public/data/late_food_evidence.json` records operator-backed late-food evidence for the twenty London Night Areas. `lib/lateFood.ts` serves an option only until its `source.expiresAt`, which is 30 days after `source.reviewedAt`. Past that date, `/api/late-food` and both plan-ending builders leave the option out and say the evidence is missing. Nothing is made up in its place.

The [dataset](../public/data/late_food_evidence.json) owns the current options, service hours, review dates and expiry times for each area. The [freshness rules](rules/lib-shared-seams-stores-http-freshness-brand.md) explain partial expiry reporting and gate failures.

## Who can do this

A person with a browser. `reviewedAt` records that someone read the operator's page and checked the row against it, so the dates must not be advanced without that review. The [source ledger](data/SOURCE_LEDGER.md) governs separate harvest permissions. A harvest does not replace this manual review.

## For each row

1. Open the `sourceUrl` and confirm the page is the operator's own page for that location. A tool that reads a page for you must say what it is: it never sends a browser's user agent, and it stops at a host's block page rather than trying another way in.
2. Check the street address against `address`, and the map pin the page links to against `coordinates`.
3. Read the opening hours for every day and update both `serviceHoursText` and `weeklyHours`. A closing time after midnight goes on the day the service starts, with `closesNextDay: true`.
4. Check the `anchor` dish and price on the operator's menu page (`anchor.sourceUrl`), and update `anchor.price` and `anchor.observedAt`.
5. Set `source.observedAt` and `source.reviewedAt` to the time you read the page, and `source.expiresAt` to 30 days later.
6. If the page is gone, the location has closed, or the hours no longer reach late evening, remove the option. Then update that area's `status` and `reason` to say no option has passed review.

When the rows are done, set `generatedAt` to the review time and give `snapshotId` a new date and version. Then run `npm run check:freshness`, `npm run validate-data` and `npx vitest run __tests__/lateFoodEvidence.test.ts __tests__/lateFood.test.ts`.

## Next time

Re-review each option before its `source.expiresAt` in the dataset. Retain expired dates until every required fact passes review.

Review the lapsed rows when their operator pages provide the required address, hours, location and priced menu. On 2026-11-16, Honest Burgers did not publish a price on its current menu. Pizza Pilgrims did not show a price on its operator-hosted menu page. Barnes did not publish its street address on the location page. The Islington URL returned 404. The Dalston location says delivery only. The review record is held outside the repository in `data/pubmax-late-food-rereview/README.md`.
