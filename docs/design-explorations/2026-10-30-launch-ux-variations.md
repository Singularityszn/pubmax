# Launch UX variations, 30 October 2026

A dated design record for the November launch. It gives three directions for the same product, each as a set of concrete changes per surface, so the captain can pick one direction or mix them. It does not change the locked colour decision: light ships Candle Coral, dark ships Night Out, one coral fill per screen, semantic hues keep their jobs, no second signature element ([`DESIGN.md`](../../DESIGN.md), [`docs/DESIGN_SYSTEM.md`](../DESIGN_SYSTEM.md)). Every change below is possible with the launch tokens and the four primitives (Kicker, TrustPill, EmptyState, Screen).

Evidence behind it: the 29-page phone sweep and the live-site read in [`../plans/LAUNCH_REVIEW_2026-10-30.md`](../plans/LAUNCH_REVIEW_2026-10-30.md), and the still-open items from [`../plans/PlanAstra.md`](../plans/PlanAstra.md) section 2 (items 6, 9, 10 and 16).

## 1. What the phone sweep showed

- **The venue sheet is the product and it is the longest screen in the app.** Twenty-two blocks on Overview, hygiene twice, a getting-home fold labelled "Last train" inside Overview, tabs named Stories and Lore for keys called `pints` and `story`. A first-time user scrolls past the price door to find the pub's address.
- **Every list page is a column of text rows.** Tonight, Today, Near, Crawls and Borough share one shape: kicker, h1, two buttons, then rows. It is clear, and it is the same screen five times.
- **Pictures are rare.** The landing hero, the crawl feature, the Pal portrait. The map peek, the venue head, Tonight and the profile are text. PlanAstra item 3 (a photograph for every priced pub) is still the single biggest visual gap.
- **The primary is right.** One coral button per screen holds. Selection reads in ink. The dock is calm.
- **Three dead-end doors.** "Lock it in on Plan" with no link, Lore copy pointing at a Stories button, "Walk this story" that only dismisses.
- **Chrome count.** The desktop map opens with more than twenty controls (PlanAstra 9). The phone opens with seven, which is fine.

## 2. Three directions

### V1. The answer card (editorial restraint)

Thesis: every surface opens with one dated answer and one action, and everything else folds. It is the current direction, finished.

| Surface | Change |
| --- | --- |
| Landing | Keep. Replace the three "Around London" photo cards with one borough strip that uses the same dated price row as the hero card. |
| Near | The first row becomes a card: pub name, price plaque, walk minutes, "Open" button. Rows two to ten stay rows. |
| Map peek | The peek row carries the newest wall photo as a 56 px square when one exists (PlanAstra 7.2). Nothing else changes. |
| Venue sheet | Overview becomes five folds, in this order: **Price** (the door, community rows, mug-check, then-and-now, Spoons value), **Tonight** (occupancy, weather tips, what's on, "I'm here"), **Getting there and home** (directions, buses, last train, handoffs, share pin), **The pub** (address, action strip, amenities, cuisine, access, hygiene once, community signals), **Your record** (diary, visit reports, save, save for a night). Only Price is open by default. Tabs renamed to what they hold: Overview, Prices, Lore, Photos, Menu. |
| Plan | Keep describe-first. Move the six templates above the fold as one horizontal chip row under the field, so the empty state teaches by example. |
| Tonight | Three cards above the rows: "Cheapest near you" (one pub), "On tonight" (one event, or the regular-night row when the store is empty), "Last train" (one time). Then the rows. |
| Today | Becomes the daytime page: work spots, coffee, lunch, a quiet pint, and the weather line. No duplicate of Tonight's picks. |
| Social | Signed out: one readable card above the sign-in door (the newest public post with a photo), when decision D2 allows. Signed in: no change. |
| Profile | The head becomes a passport cover: handle, patch, fair pint, Been count, Want-to-try count. Tabs under it. |
| Pal | Keep. Add a link to `/pal/chat` on the Pal home when voice is idle. |

Answers complaints 1, 16, 17 and the "it is long" row. Effort: M for the sheet, S for the rest. Risk: low, it is the house style.

### V2. The night table (crew first)

Thesis: a night is people, so faces and names come first wherever a plan exists, and the surfaces that run the night get big taps. Colour and type do not change; what moves is the order of things and the size of the touch targets.

| Surface | Change |
| --- | --- |
| Landing | Below the hero, one "Tonight with your lot" card for a signed-in person: who in the lot is out, the open plan, the next crew. Signed out it is the open plans count for London. |
| Map | A "your lot" layer: mutuals' logged prices and "Here" marks, mutuals only. The peek row shows "Sam paid £5.20 here on Friday". |
| Venue sheet | The head gets a face row: lot members who logged or saved this pub. One tap on a face opens their note. |
| Plan | The locked plan reads as one card that fits a phone screen (PlanAstra 7.4): cover photo of stop 1, the crew's faces in a row, three actions (Send, Who's in, Night mode). The route sits under it. |
| Night mode | Giant taps (PlanAstra U7): "We're here", "Next stop", "Last train in 42 min", each at least 64 px tall, high contrast on Night Out ink, no small text. Host mode adds "Move on in 10" and the headcount. |
| Invite page | The host's handle and a line from them at the top; the stops as a vertical timeline with prices; RSVP sticky at the bottom. |
| Messages | The plan card attachment shows the stops and the time, not just the title. Group threads formed from a plan carry the plan card pinned. |
| Tonight | "Open plans" moves above the recommended pubs. Each card shows the host's handle, the time, the meeting pub and "Ask to join". |
| Profile | The lot comes first: faces of mutuals, then your pubs. |

Answers complaints 5, 15, 18 and the hosting gap. Effort: L overall, M per surface. Risk: faces on public surfaces need the owner's decision; everything mutuals-only is inside the fence today.

### V3. The field guide (list keeping, the Beli shape)

Thesis: the profile is a passport book and the lists are the spine; the map is the index into them. This is the shape of the apps people compare PUBMAXX to.

| Surface | Change |
| --- | --- |
| Profile | A passport book in sections: Been (count, list, map toggle), Want to try, Your pubs ranked, Your taste in facts, Lists, Posts, Passport stamps. Each section is a page with its own share card. |
| Venue sheet | A fixed bottom bar with three list actions: Been (opens the diary log), Want to try (Wanted), Rank it. The sticky Share moves into the overflow. |
| Rank card | After any Been, one pairwise card: "Which did you prefer?" with two pub names and prices, "Too close to call", "Skip". Three taps maximum per visit. |
| Lists | Every list has a page and a card: title, count, cover photo, the owner's handle, the map of its pubs, Follow list. |
| Map | A list lens: "Show my Been", "Show my Want to try", "Show @sam's Cheap Pint list". Pins for the chosen list, everything else dimmed. |
| Social | The Following lane shows list activity when the owner chose to share it: "@sam added the Lamb to Want to try". |
| Near | A "Never been" toggle beside "Pints" and "Work spots". |
| Tonight | "Try one of these" row drawn from the reader's Want-to-try list that is open tonight. |

Answers the Beli parity ledger and complaints 9 and 18. Effort: L. Risk: it pulls the centre of gravity from the map to the profile; PRODUCT.md says the map is the product, so V3 ships as sections inside V1's profile, not as a new home.

## 3. Recommendation

Ship V1 for launch. It is the house style finished, it answers the loudest complaints, and it costs the least. Take two pieces from V2 before launch because they ride on work already in round 1: the plan as one card, and open plans above the fold on Tonight. Take the profile passport and the rank card from V3 as round 2, because the Beli parity ledger needs them and they fit inside V1's profile.

## 4. Micro-fixes that belong to no direction

Each is under a day and most are copy or spacing.

1. Tab names match contents (Stories, Lore).
2. Hygiene once per sheet.
3. One price-cap set across desktop chips, phone choices and the rail slider.
4. "Walk this story" does what it says or goes.
5. "Lock it in on Plan" links to Plan (round 1 builder 4).
6. The Lore empty state links to the Stories tab or loses the sentence.
7. The desktop map toolbar: search, area, drink lane, plan; the kind chips behind Filters (PlanAstra 9).
8. Reserve heights on Tonight for the weather line, the chip row and the first card (PlanAstra 10).
9. The venue sheet head: three columns with `minmax(0,1fr)` so a long standing line never overlaps "Near me" (PlanAstra 6).
10. The dock's Pub Pal face: the raised button is the one place the Pal appears in chrome; the floating create disc and the Pal button must not sit on the same edge at 390 px when the keyboard is closed. Check the overlap once on a real phone.
11. Dark theme: the peek row's grey "Unknown" under a drink lens reads below AA on Night Out ink. Use `--color-text-muted` on `--panel-raised`.
12. Empty states carry a photograph where one exists (the pub's wall photo, the crawl cover), never only text.

## 5. Mockups

The earlier explorations in this folder are static HTML at 1440 by 900. For this record the next round produces three phone-width (390 px) HTML mockups, one per direction, of the same four screens: venue sheet, Tonight, the locked plan, the profile. They use the launch tokens from `app/globals.css` by name so they can be diffed against the product, and they are checked with the em-dash law like any copy.
