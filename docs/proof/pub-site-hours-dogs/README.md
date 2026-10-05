# Dog policy and opening hours from pub sites, 5 October 2026

The amenity harvest kept the text of 478 pub pages it read on 5 October 2026.
This change reads dog policy and opening hours from those texts again. It
sends no Firecrawl request and no model call, so the spend is USD 0.

## How a fact stands

`lib/harvest/pubSiteHoursAndDogs.ts` reads each page without a model. A fact
stands only when a passage on the page states it, and the row keeps that
passage, the page URL and the day of the read.

- **Dogs.** A welcome or a refusal counts only when the whole statement,
  past "sorry" or "please", is a fixed form. A welcome is "dog friendly",
  "dogs are welcome in our pub", "we welcome dogs" or "bring your dog". A
  refusal is "no dogs", "dogs are not allowed in the pub", "we do not allow
  dogs" or "only assistance dogs". A statement with any other words, such as a
  day, an hour or a room, stays unknown. A page that both welcomes and refuses
  dogs, even when either has a limit, stays unknown. So do a guest review, a
  footer link and "assistance dogs welcome".
- **Hours.** Only a passage under an opening-hours label counts. Kitchen,
  food, seasonal and Christmas blocks do not. A day the page does not state is
  absent, not closed. A time with no am, pm or colon ("11 - 5") is not read.
  A clock with no am or pm is read only as 24-hour, when its window has an
  hour from 13 to 23, a 00 hour or a zero-padded clock. "12:00 - 11:00" and
  "5:00 - 11:00pm" are not read, and an hours block stops at such a window.
  Hours with a condition ("for club nights") are not read. A page with two
  hours blocks that disagree on a day states nothing.

The same fences as the amenity harvest apply. Only a read that the amenity run
finished is used, so the source policy, robots, the landing check, the address
check and the duplicate check all held. A page on the chain list is skipped. A
passage that more than one pub on one host states word for word is the
chain's, so it is dropped.

## Result

`npm run harvest:pub-website-hours-dogs` writes
`data/amenities/london_pub_website_hours_dogs.json`.

| Measure | Count |
| --- | --- |
| Finished reads with a kept page | 360 |
| Pubs with a stated fact | 178 |
| Dogs welcome | 19 |
| Dogs not allowed | 0 |
| Opening hours | 176 (154 with all seven days) |
| Pages on the chain list | 6 |
| Hours passages dropped as chain-wide | 32 |
| Dog passages dropped as chain-wide | 8 |
| Pages that state neither | 147 |

Every row names a venue in the app.

## Where the app reads it

The venue detail (`lib/venueDetailIndex.ts`) adds `siteFacts` to the venue.
While the read is no older than 30 days, the same rule as other opening
evidence, the site's hours set `openingHours` when nothing else has set
them. Fresh Google Places hours still replace them. The Overview tab shows
the dog policy and the hours under "Details and practical info". It uses the
existing amenity chip and hours list, credited "Pub website · Read 5 Oct
2026". A fact that Google Places already gives is not shown twice. The
site's hours also show when Google's hours are too old to decide open state.

## Gaps

- The amenity vocabulary has no dog key. The map filters and the pint dataset
  columns do not carry dog policy.
- The pub copy judge still refuses "dog" in written copy. Copy does not mention
  the dog policy until the copy facts carry it.
- No page refused dogs, so no row says "not allowed". Unit tests cover the
  refusal path.

## Proof

- `before-mobile.png`: The Churchill Arms with the facts file removed. The
  details section has no dog policy and no hours.
- `after-mobile.png`: the same pub with the facts file. It shows "Dogs welcome"
  and the week's hours, credited to the pub website.
- `api-after.jsonl`: `/api/venue/<id>` for The Churchill Arms and the Maynard
  Arms. Each carries `siteFacts`, `openingHours`, and an open state from
  those hours. Before this change, the same response had no `siteFacts`, no
  `openingHours`, and `busyness.isOpen` was `"unknown"`.
