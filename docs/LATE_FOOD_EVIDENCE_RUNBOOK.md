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

## The twenty areas (reviewed on 2026-11-16)

| Night Area | Option | Publisher | Operator page | Hours on 2026-11-16 | Last full review |
| --- | --- | --- | --- | --- | --- |
| `clapham` | Honest Burgers Clapham | Honest Burgers | https://www.honestburgers.co.uk/locations/clapham/ | Monday-Tuesday and Sunday 11:00-22:00; Wednesday-Thursday 11:00-22:30; Friday-Saturday 11:00-23:00. | 2026-07-16 (lapsed; price not verified on re-review) |
| `victoria` | Franco Manca Victoria Nova | Franco Manca | https://www.francomanca.co.uk/restaurants/victoria-nova/ | Monday-Thursday 12:00-22:00; Friday-Saturday 12:00-23:00; Sunday 12:00-22:00. | 2026-11-16 |
| `piccadilly-soho` | Balans No.60 | Balans Restaurants | https://balans.co.uk/locations/soho-no-60/ | Monday-Wednesday 09:00-22:30; Thursday-Saturday 09:00-04:30 the following day; Sunday 09:00-00:30 the following day. | 2026-11-16 |
| `canary-wharf` | Franco Manca Canary Wharf | Franco Manca | https://www.francomanca.co.uk/restaurants/canary-wharf/ | Monday-Thursday 12:00-22:00; Friday-Saturday 12:00-23:00; Sunday 12:00-22:00. | 2026-11-16 |
| `barnes` | Rick Stein Barnes | Rick Stein | https://rickstein.com/restaurants/rick-stein-barnes/ | Monday-Thursday 12:00-21:00; Friday-Saturday 12:00-21:30; Sunday 12:00-20:00. | 2026-10-17 (lapsed; address missing on re-review) |
| `chiswick` | Honest Burgers Chiswick | Honest Burgers | https://www.honestburgers.co.uk/locations/chiswick/ | Monday-Thursday and Sunday 11:00-22:00; Friday-Saturday 11:00-23:00. | 2026-07-16 (lapsed; price not verified on re-review) |
| `shoreditch` | Honest Burgers Spitalfields | Honest Burgers | https://www.honestburgers.co.uk/locations/spitalfields/ | Monday-Tuesday and Sunday 11:00-22:00; Wednesday-Saturday 11:00-23:00. | 2026-07-16 (lapsed; price not verified on re-review) |
| `camden` | Honest Burgers Camden | Honest Burgers | https://www.honestburgers.co.uk/locations/camden/ | Sunday-Thursday 11:00-22:00; Friday-Saturday 11:00-23:00. | 2026-07-16 (lapsed; price not verified on re-review) |
| `brixton` | Honest Burgers Brixton | Honest Burgers | https://www.honestburgers.co.uk/locations/brixton/ | Monday-Wednesday 11:00-22:30; Thursday-Saturday 11:00-23:00; Sunday 11:00-22:00. | 2026-07-16 (lapsed; price not verified on re-review) |
| `bermondsey-london-bridge` | Pizza Pilgrims London Bridge | Pizza Pilgrims | https://www.pizzapilgrims.co.uk/pizzerias/london-bridge/ | Monday-Saturday 11:30-22:30; Sunday 11:30-21:00. | 2026-07-16 (lapsed; price not verified on re-review) |
| `kings-cross` | Honest Burgers King's Cross | Honest Burgers | https://www.honestburgers.co.uk/locations/kings-cross/ | Monday-Wednesday 10:30-22:00; Thursday-Saturday 10:30-23:00; Sunday 11:00-22:00. | 2026-07-16 (lapsed; price not verified on re-review) |
| `islington` | Franco Manca Islington | Franco Manca | https://www.francomanca.co.uk/restaurants/islington/ | Not eligible. Option removed. | 2026-11-16 |
| `dalston` | Honest Burgers Dalston | Honest Burgers | https://www.honestburgers.co.uk/locations/dalston/ | Not eligible. Option removed. | 2026-11-16 |
| `peckham` | Honest Burgers Peckham | Honest Burgers | https://www.honestburgers.co.uk/locations/peckham/ | Monday-Tuesday and Sunday 11:00-22:00; Wednesday-Saturday 11:00-23:00. | 2026-07-16 (lapsed; price not verified on re-review) |
| `greenwich` | Honest Burgers Greenwich | Honest Burgers | https://www.honestburgers.co.uk/locations/greenwich/ | Monday-Tuesday 11:00-22:00; Wednesday-Saturday 11:00-23:00; Sunday 11:00-22:30. | 2026-07-16 (lapsed; price not verified on re-review) |
| `hammersmith` | Honest Burgers Hammersmith | Honest Burgers | https://www.honestburgers.co.uk/locations/hammersmith/ | Monday-Tuesday and Sunday 11:00-22:00; Wednesday-Saturday 11:00-23:00. | 2026-07-16 (lapsed; price not verified on re-review) |
| `balham` | Franco Manca Balham | Franco Manca | https://www.francomanca.co.uk/restaurants/balham/ | Monday 12:00-21:30; Tuesday-Wednesday 12:00-22:00; Thursday 12:00-22:30; Friday-Saturday 12:00-23:30; Sunday 12:00-22:00. | 2026-11-16 |
| `marylebone` | Honest Burgers Baker Street | Honest Burgers | https://www.honestburgers.co.uk/locations/baker-st/ | Sunday-Wednesday 11:00-22:00; Thursday-Saturday 11:00-23:00. | 2026-07-16 (lapsed; price not verified on re-review) |
| `richmond` | Franco Manca Richmond | Franco Manca | https://www.francomanca.co.uk/restaurants/richmond/ | Monday-Wednesday 12:00-22:00; Thursday 12:00-23:00; Friday 12:00-23:30; Saturday 11:30-23:30; Sunday 11:30-22:00. | 2026-11-16 |
| `putney` | Franco Manca Putney | Franco Manca | https://www.francomanca.co.uk/restaurants/putney/ | Monday-Thursday 12:00-22:30; Friday 12:00-23:30; Saturday 11:30-23:30; Sunday 11:30-22:30. | 2026-11-16 |

## Next time

Re-review the six renewed rows before 2026-12-16 at 15:26 UTC. Their exact expiry times are in the dataset. Retain expired dates until every required fact passes review.

Review the lapsed rows when their operator pages provide the required address, hours, location and priced menu. On 2026-11-16, Honest Burgers did not publish a price on its current menu. Pizza Pilgrims did not show a price on its operator-hosted menu page. Barnes did not publish its street address on the location page. The Islington URL returned 404. The Dalston location says delivery only. The operator keeps the per-page record of the 2026-11-16 review outside the repository.
