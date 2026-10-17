# Late-food evidence re-review, 17 October 2026

This is a dated record of one review session. It is not a description of current behaviour. The live rules are in `docs/LATE_FOOD_EVIDENCE_RUNBOOK.md`.

**This is a proposal, not the human review.** An agent made these reads as single page-at-a-time reads, the way a person in a browser would. No script, scheduled task or harvest code fetched these hosts, and none was added to `lib/harvest/sourcePolicy.ts`. The `reviewedAt` dates in `public/data/late_food_evidence.json` become a person's review only when the captain checks this record and approves the pull request.

All times are UTC on 2026-10-17. Excerpts are short quotes of the page text as served. No screenshots are kept.

## Result

| | Rows |
| --- | --- |
| Renewed (page read, address, hours and anchor checked) | 8: `victoria`, `canary-wharf`, `islington`, `balham`, `richmond`, `putney`, `piccadilly-soho`, `barnes` |
| Not renewed, page could not be read | 11: every Honest Burgers row |
| Not renewed, anchor price no longer published | 1: `bermondsey-london-bridge` (Pizza Pilgrims) |
| Removed | 0 |

The renewed rows expire on **2026-11-16 between 14:02 and 14:04 UTC**, the same day the old gate exemption would have lapsed. The next re-review is due within a month.

The twelve rows not renewed keep their 2026-07-16 dates and stay expired. `lib/lateFood.ts` does not serve them, so those twelve areas still answer with no late food. Nothing was invented in their place, and no row was removed: none of the pages said a location had closed or that its hours stopped short of late evening.

## robots.txt

| Host | Read at | Status | What it says about the paths read |
| --- | --- | --- | --- |
| www.honestburgers.co.uk | 14:01:43, 14:01:52 | 403 | A Cloudflare page: "Sorry, you have been blocked". No rules could be read, so no page on this host was requested. |
| www.francomanca.co.uk | 14:01:52 | 200 | `Disallow: /wp-json/` and `/?rest_route=` only. `/restaurants/` and `/wp-content/uploads/` are allowed. |
| balans.co.uk | 14:01:53 | 200 | `Disallow: /wp-admin/` and `/wp-includes/` only. |
| rickstein.com | 14:01:53 | 200 | `Disallow: /cdn-cgi/` only. |
| www.pizzapilgrims.co.uk | 14:01:53 | 404 | No `robots.txt`, so no path is disallowed. |

The first Honest Burgers request sent a generic browser user agent. The retry and every later request used curl's default user agent. Both were blocked, and no other way round the block was tried.

## Row by row

Coordinates were checked against the coordinates inside the Google Maps link each page carries, which were read from the page and not followed. A `goo.gl` short link was not followed, because resolving it reads a Google host outside the permitted pages.

| Area | Page read | Address on page | Map pin | Hours on page | Anchor | Change to the row |
| --- | --- | --- | --- | --- | --- | --- |
| `victoria` | 14:02:37 [victoria-nova](https://www.francomanca.co.uk/restaurants/victoria-nova/) | "7 Sir Simon Milton Square / Victoria Street / London / SW1E 5DJ" | link `!3d51.4973963!4d-0.1431839`, same | "Mon–Thu: 12:00 pm – 10:00 pm", "Fri–Sat: 12:00 pm – 11:00 pm", "Sun: 12:00 pm – 10:00 pm" | Page now links `2026/09/FM-MENU-SEPT-26-WC0926P-1.pdf` (read 14:07:08): "FRANCO’S OG MARGHERITA … 13.95" | Dates renewed. Anchor document moved from `2026/06/FM-MENU-L0526P.pdf`. Price, hours, address unchanged. |
| `canary-wharf` | 14:03:13 [canary-wharf](https://www.francomanca.co.uk/restaurants/canary-wharf/) | "Unit 35 / Crossrail Station / Canary Wharf / London / E14 5AR" | `!3d51.5060582!4d-0.0172408`, same | Same three lines as Victoria | `2026/09/FM-MENU-SEPT-26-L0926P-1.pdf` (14:07:08): "… 13.95" | Dates renewed. Anchor document moved from `2026/06/FM-MENU-L0526P.pdf`. |
| `islington` | 14:03:21 [islington](https://www.francomanca.co.uk/restaurants/islington/) | "72 Upper Street / Islington / London / N1 0NY" | `!3d51.536196!4d-0.103887`, same | "Mon–Tue: 12:00 pm – 9:30 pm", "Wed–Thu: 12:00 pm – 10:00 pm", "Fri–Sat: 12:00 pm – 11:00 pm", "Sun: 12:00 pm – 9:30 pm" | `2026/09/FM-MENU-SEPT-26-L0926S.pdf` (14:07:09): "… 13.50" | Dates renewed. Anchor document moved from `2026/06/FM-MENU-L0526S.pdf`. |
| `balham` | 14:03:26 [balham](https://www.francomanca.co.uk/restaurants/balham/) | "53 Bedford Hill / London / SW12 9EZ" | `!3d51.4436188!4d-0.1500045`, same | "Mon: 12:00 pm – 9:30 pm", "Tue–Wed: … 10:00 pm", "Thu: … 10:30 pm", "Fri–Sat: … 11:30 pm", "Sun: … 10:00 pm" | `L0926S`: "… 13.50" | Dates renewed. Anchor document moved from `L0526S`. |
| `richmond` | 14:03:32 [richmond](https://www.francomanca.co.uk/restaurants/richmond/) | "8 Red Lion Street / Richmond / TW9 1RW" | `!3d51.4594444!4d-0.305`, same | "Mon–Wed: 12:00 pm – 10:00 pm", "Thu: … 11:00 pm", "Fri: … 11:30 pm", "Sat: 11:30 am – 11:30 pm", "Sun: 11:30 am – 10:00 pm" | `L0926S`: "… 13.50" | Dates renewed. Anchor document moved from `L0526S`. |
| `putney` | 14:03:38 [putney](https://www.francomanca.co.uk/restaurants/putney/) | "28 Putney High Street / London / SW15 1SQ" | `!3d51.4652842!4d-0.2146232`, same | "Mon–Thu: 12:00 pm – 10:30 pm", "Fri: … 11:30 pm", "Sat: 11:30 am – 11:30 pm", "Sun: 11:30 am – 10:30 pm" | `L0926S`: "… 13.50" | Dates renewed. Anchor document moved from `L0526S`. |
| `piccadilly-soho` | 14:03:45 [soho-no-60](https://balans.co.uk/locations/soho-no-60/) | "60-62 Old Compton Street, W1D 4UG" | `!3d51.5127668!4d-0.1325587`, same | Monday to Wednesday "9am - 10:30pm"; Thursday to Saturday "9am - 4:30am"; Sunday "9am - 12:30am". The page also says food is "served until 5am every night". | The page's Menu button now goes to `https://balans.co.uk/soho-no-60/` (read 14:06:18), which links `2025/07/Overnight-Menu.pdf` (read 14:06:48), headed "NO.60": "Cheeseburger 20" | **Wednesday now closes 22:30, not 23:30.** Anchor page and document replaced: the old `/menus/soho-no-60/` returns 301 to the location page, and the old `No.60-Overnight-1.pdf` returns 302 to the home page. Price unchanged at £20. |
| `barnes` | 14:04:03 [rick-stein-barnes](https://rickstein.com/restaurants/rick-stein-barnes/) | Page structured data: "Tideway Yard, 125 Mortlake High Street", "SW14 8SW" | Directions link is `goo.gl/maps/3qKCcGC5ZbAp3CuH7`, not followed. The page's structured data gives 51.470971, -0.256475, 42 m from the committed pin. The committed pin was kept. | "Restaurant - 12-3pm and 5-9pm (Friday until 9.30pm, Saturday 12-9.30pm, Sunday 12-8pm)" | The page no longer prints a fish and chips price. It links its "daily menu", `2024/02/Daily-Menu-Reopening.pdf` (read 14:07:22): "Fish and chips, haddock deep-fried in dripping, … 26" | **Anchor price £22 to £26**, label "Fish and chips", anchor now the daily-menu PDF with its page link recorded. Hours and address unchanged. The return-booking page in `supportingUrls` was not re-read. |
| `bermondsey-london-bridge` | 14:04:48 [london-bridge](https://www.pizzapilgrims.co.uk/pizzerias/london-bridge/) | "Unit SU48, Bermondsey Street, London, SE1 9SP", same | Directions link is `goo.gl/maps/otYPWTQ8UtLe8VNG9`, not followed, and the page carries no coordinates. | "Mon: 11:30AM - 10:30PM", "Tues - Sat: 11:30AM - 10:30PM", "Sun: 11:30AM - 9PM", same | `anchor.sourceUrl` [menu](https://www.pizzapilgrims.co.uk/menu/) (read 14:05:20) lists "Margherita" with its description and no price. Its price PDFs sit on `www.datocms-assets.com`, which the validator does not accept as an operator host. The location page's "Classic Margherita £10" is a Monday to Thursday 12 to 3pm lunch offer, not the menu price, so it was not used. | **Not renewed.** The anchor cannot be checked on an accepted operator page. Dates left at 2026-07-16. |
| 11 Honest Burgers rows | not requested | | | | | **Not renewed.** The host blocked `robots.txt` (above), so `clapham`, `chiswick`, `shoreditch`, `camden`, `brixton`, `kings-cross`, `dalston`, `peckham`, `greenwich`, `hammersmith` and `marylebone` were not read. Dates left at 2026-07-16. |

## Reads beyond `sourceUrl` and `anchor.sourceUrl`

The brief allowed each row's `sourceUrl` and its `anchor.sourceUrl`, and nothing else. Every committed anchor document had moved, so a check against `anchor.sourceUrl` alone could not say what the operator charges today. For six rows the agent also read the one menu document each operator page links today, once per document: the three Franco Manca September PDFs, the Balans `/soho-no-60/` menu page and its Overnight PDF, and the Rick Stein daily menu. All of them are on the same operator host, and robots allows them. These are the reads a person would make by clicking the page's own Menu link. **The captain should confirm this was acceptable.** If it was not, those six anchors stand unverified, and the rows should be left at their old dates as the Pizza Pilgrims row is.

The committed Franco Manca June PDFs (`2026/06/FM-MENU-L0526P.pdf` and `L0526S.pdf`, read 14:06:58 and 14:06:59) are still served, and print the same 13.95 and 13.50. But no branch page links them now, so they were not kept as the anchor.

## Things for the captain to judge

- **Barnes is the earliest "late" option.** Its kitchen closes at 21:00 Monday to Thursday and 20:00 on Sunday. That is unchanged from the July review, so the row was kept, but it may not meet "late evening".
- **Two pins are unchecked.** Barnes (42 m from the page's own structured data) and Pizza Pilgrims (no coordinates on the page) link only `goo.gl` short links.
- **The gate cannot see the twelve lapsed areas.** `rowExpiry` reads `stale` only once the latest row has expired, so `npm run check:freshness` reads this dataset as fresh while twelve of its areas serve nothing.
- **Honest Burgers needs a person in a real browser.** Eleven of the twenty areas depend on it. A person can open those pages, check each row, and renew it with the same six steps.
