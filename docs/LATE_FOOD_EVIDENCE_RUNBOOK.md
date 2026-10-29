# Late-food evidence re-review

`public/data/late_food_evidence.json` lists one operator-backed late-food option for each of the twenty London Night Areas. `lib/lateFood.ts` serves an option only until its `source.expiresAt`, which is 30 days after `source.reviewedAt`. Past that date, `/api/late-food` and both plan-ending builders leave the option out and say the evidence is missing. Nothing is made up in its place.

Every row was reviewed on 2026-07-16 and expired on 2026-08-16, and from 17 August the late-food answers were empty in every area. The re-review of 2026-10-17 renewed eight rows, which expire on 2026-11-16. The other twelve could not be re-read and keep their lapsed dates, so those twelve areas still answer with no late food. The table below says which is which. The `late_food_evidence` registry entry declares `rowExpiry`, so the dataset reads `stale` once its LATEST row has expired. It does not read stale while only some rows have lapsed, so the gate cannot show the twelve.

The temporary exemption `late_food_evidence` held in `TEMPORARY_ADVISORY_UNTIL` (`scripts/check_freshness.mjs`) was deleted in the commit that landed the 2026-10-17 re-review. A stale finding now fails the gate.

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

## The twenty rows (as committed on 2026-10-17)

| Night Area | Option | Publisher | Operator page | Hours as last reviewed | Last reviewed |
| --- | --- | --- | --- | --- | --- |
| `clapham` | Honest Burgers Clapham | Honest Burgers | https://www.honestburgers.co.uk/locations/clapham/ | Sunday-Thursday 11:00-22:30; Friday-Saturday 11:00-23:00. | 2026-07-16 (lapsed; not served) |
| `victoria` | Franco Manca Victoria Nova | Franco Manca | https://www.francomanca.co.uk/restaurants/victoria-nova/ | Monday-Thursday 12:00-22:00; Friday-Saturday 12:00-23:00; Sunday 12:00-22:00. | 2026-10-17 |
| `piccadilly-soho` | Balans No.60 | Balans Restaurants | https://balans.co.uk/locations/soho-no-60/ | Monday-Wednesday 09:00-22:30; Thursday-Saturday 09:00-04:30 the following day; Sunday 09:00-00:30 the following day. | 2026-10-17 |
| `canary-wharf` | Franco Manca Canary Wharf | Franco Manca | https://www.francomanca.co.uk/restaurants/canary-wharf/ | Monday-Thursday 12:00-22:00; Friday-Saturday 12:00-23:00; Sunday 12:00-22:00. | 2026-10-17 |
| `barnes` | Rick Stein Barnes | Rick Stein | https://rickstein.com/restaurants/rick-stein-barnes/ | Monday-Thursday 12:00-15:00 and 17:00-21:00; Friday 12:00-15:00 and 17:00-21:30; Saturday 12:00-21:30; Sunday 12:00-20:00. | 2026-10-17 |
| `chiswick` | Honest Burgers Chiswick | Honest Burgers | https://www.honestburgers.co.uk/locations/chiswick/ | Monday-Saturday 11:00-23:00; Sunday 11:00-22:30. | 2026-07-16 (lapsed; not served) |
| `shoreditch` | Honest Burgers Spitalfields | Honest Burgers | https://www.honestburgers.co.uk/locations/spitalfields/ | Monday-Saturday 11:00-23:00; Sunday 11:00-22:30. | 2026-07-16 (lapsed; not served) |
| `camden` | Honest Burgers Camden | Honest Burgers | https://www.honestburgers.co.uk/locations/camden/ | Sunday-Thursday 11:00-22:00; Friday-Saturday 11:00-23:00. | 2026-07-16 (lapsed; not served) |
| `brixton` | Honest Burgers Brixton | Honest Burgers | https://www.honestburgers.co.uk/locations/brixton/ | Monday-Wednesday 11:00-22:30; Thursday-Saturday 11:00-23:00; Sunday 11:00-22:00. | 2026-07-16 (lapsed; not served) |
| `bermondsey-london-bridge` | Pizza Pilgrims London Bridge | Pizza Pilgrims | https://www.pizzapilgrims.co.uk/pizzerias/london-bridge/ | Monday-Saturday 11:30-22:30; Sunday 11:30-21:00. | 2026-07-16 (lapsed; not served) |
| `kings-cross` | Honest Burgers King's Cross | Honest Burgers | https://www.honestburgers.co.uk/locations/kings-cross/ | Monday-Saturday 10:30-23:00; Sunday 11:00-22:30. | 2026-07-16 (lapsed; not served) |
| `islington` | Franco Manca Islington | Franco Manca | https://www.francomanca.co.uk/restaurants/islington/ | Monday-Tuesday 12:00-21:30; Wednesday-Thursday 12:00-22:00; Friday-Saturday 12:00-23:00; Sunday 12:00-21:30. | 2026-10-17 |
| `dalston` | Honest Burgers Dalston | Honest Burgers | https://www.honestburgers.co.uk/locations/dalston/ | Monday-Saturday 11:00-23:00; Sunday 11:00-22:30. | 2026-07-16 (lapsed; not served) |
| `peckham` | Honest Burgers Peckham | Honest Burgers | https://www.honestburgers.co.uk/locations/peckham/ | Monday-Saturday 11:00-23:00; Sunday 11:00-22:30. | 2026-07-16 (lapsed; not served) |
| `greenwich` | Honest Burgers Greenwich | Honest Burgers | https://www.honestburgers.co.uk/locations/greenwich/ | Monday-Saturday 11:00-23:00; Sunday 11:00-22:30. | 2026-07-16 (lapsed; not served) |
| `hammersmith` | Honest Burgers Hammersmith | Honest Burgers | https://www.honestburgers.co.uk/locations/hammersmith/ | Monday-Saturday 11:00-23:00; Sunday 11:00-22:30. | 2026-07-16 (lapsed; not served) |
| `balham` | Franco Manca Balham | Franco Manca | https://www.francomanca.co.uk/restaurants/balham/ | Monday 12:00-21:30; Tuesday-Wednesday 12:00-22:00; Thursday 12:00-22:30; Friday-Saturday 12:00-23:30; Sunday 12:00-22:00. | 2026-10-17 |
| `marylebone` | Honest Burgers Baker Street | Honest Burgers | https://www.honestburgers.co.uk/locations/baker-st/ | Monday-Saturday 11:00-23:00; Sunday 11:00-22:30. | 2026-07-16 (lapsed; not served) |
| `richmond` | Franco Manca Richmond | Franco Manca | https://www.francomanca.co.uk/restaurants/richmond/ | Monday-Wednesday 12:00-22:00; Thursday 12:00-23:00; Friday 12:00-23:30; Saturday 11:30-23:30; Sunday 11:30-22:00. | 2026-10-17 |
| `putney` | Franco Manca Putney | Franco Manca | https://www.francomanca.co.uk/restaurants/putney/ | Monday-Thursday 12:00-22:30; Friday 12:00-23:30; Saturday 11:30-23:30; Sunday 11:30-22:30. | 2026-10-17 |

## Next time

The rows expire 30 days after each review. Re-review them within that window, or the late-food answers go empty again and the freshness gate turns red. The eight rows renewed on 2026-10-17 expire on 2026-11-16 between 14:02 and 14:04 UTC.

The twelve lapsed rows need a person in a real browser. On 2026-10-17 honestburgers.co.uk answered every automated read, `robots.txt` included, with a Cloudflare block page. The Pizza Pilgrims menu page (`anchor.sourceUrl`) no longer prints the Margherita price, and the price PDFs it links sit on a host the validator does not accept as the operator's. What each page said is in `docs/proof/late-food-rereview-2026-10-17/README.md`.
