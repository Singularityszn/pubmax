# Launch review and feature brainstorm, 30 October 2026

A dated record. It describes the product as it stood on main at commit `c43aac47` on 30 October 2026, read page by page, button by button. It then lists the complaints a public user will raise in week one, and the new features that answer them before anybody asks. Nothing here is accepted scope until the captain names it. Build work extends the waves in [`PLG_STRATEGY.md`](PLG_STRATEGY.md); this file does not start a parallel roadmap.

How the review was done:

- Every page under `app/` was read, with the components and routes behind it. Seven read-only sweeps covered the map and venue sheet, planning and groups, social and identity, Pub Pal, drinks and food data, first run and account, and the existing idea ledger in `docs/`.
- The live site `pubmaxxing.com` was read on 30 October 2026 (13 pages plus `/api/health` and `/api/version`, deployment `dpl_4V9F76kk…`, commit `e5da6c0`).
- A keyless local build was driven in a 390 px browser across 29 pages with screenshots. No page threw an error.
- Open GitHub issues were read: #2123, #1522, #1576, #1580, #1354, #392, #2272.

What was not verified: the contents of the production Supabase stores (community prices, posts, what's on), live page speed, and whether Pub Pal voice is switched on in production. Where a claim depends on one of those, this file says so.

Predecessor: [`PlanAstra.md`](PlanAstra.md) (September 2026) did a review of the same kind. Many of its 33 findings are fixed on main (the tilted price plaque, the streak line, the plan page FAB). The ones still open are repeated below with their original number, so nothing is proposed twice.

---

## 1. What PUBMAXX is, in one page

PUBMAXX is a London pint-price map that turns into a shared night. The record of what it knows is honest to a fault: every price names its publisher and date, colour means price band and never trust, and a thin night stays thin. On top of the map sit five things:

| Layer | What exists | Where |
| --- | --- | --- |
| Prices | 2,250 London venues, 1,012 with a pint price, 875 of those read from pint-prices.com under a captain exception. Wine prices for 312 venues and cocktails for 263 from pubs' own menus. Two-drinker corroboration before a people-logged price paints a pin. | `public/data/venues_slim.json`, `public/data/uk_prices/rows.json`, `lib/pintTrust.ts` |
| Plan | A keyless crawl planner: one sentence in, a 1 to 6 stop walking route out, locked into a page with a WhatsApp link, RSVP, presence, votes, a night mode and a recap. | `app/plan/`, `lib/planGeneration.server.ts` |
| Social | Posts with photos and reels, cheers, comments, crews for one night, DMs and groups, follows ("your lot" is mutual follows), check-ins to your lot, a photo wall, private Memories that can become a published Story. | `app/social/`, `app/messages/`, `lib/*Store.ts` |
| Pub Pal | An account-owned companion with a chosen form, name and voice. It answers from 16 read tools and proposes writes that the person confirms. Voice runs on ElevenLabs with a 30 minute monthly allowance. | `app/pal/`, `lib/ask/`, `lib/pubPal*.ts` |
| Tonight | A daily page of recommended pubs, events, cheap pints, weather, last train, open plans and historic picks. | `app/tonight/`, `app/today/` |

The product promise is right. The map is good. The planner is the best thing in the tree. The soft spots are exactly where a public crowd will push first: food, anything that is not a pint, events, meeting people you do not already know, and hosting a crawl that other people can find.

---

## 2. Page by page: what works, what a user will say

Each row names the surface, what a first-time user sees, and the complaint it will draw. "Still open from PlanAstra" means the number in that file's section 2.

### 2.1 Landing, Near, Tonight, Today

| Surface | Works | Will draw this complaint |
| --- | --- | --- |
| `/` | Answer first. "What a pint costs, pub by pub." One pub card with a dated price, three cheapest nearby, a stats block, FAQ, a 12 second film. Three doors: cheapest near me, log what you paid, what's on tonight. | The stats block says 942 priced pubs. `/pint-index` says 960 of 2,034. `/about` says "No borough league yet" while the Pint Index shows one. A journalist will notice. `lib/pricedLanding.ts`, `app/about/page.tsx`. |
| `/near` | Pints or Work spots. One coral button. Patch chips. A quiet first-run link. Walk minutes and dated prices. | Only eight patch chips. A user in Walthamstow or Croydon has no chip and no hint that the map covers them. |
| `/tonight` | Twelve recommended pubs with sourced "Why this pub" lines, cheapest pints, vibe chips, ideas, open plans, historic pubs, last train, weather, share. | On the live site the events block reads "No confirmed events listed tonight" and "The what's-on source check date is not recorded". Locally it reads "Live listings not set up yet". A page called Tonight with no events is the first thing people will screenshot. See section 3.3. |
| `/today` | Top picks, last train with a location ask, cheap ones around Soho, pub of the day. | "Pub of the day" and "Top picks" are the same five pubs as Tonight. The day view has no day-only content (lunch, coffee, work spots) even though the data exists in `/near`. |

### 2.2 Map and venue sheet

The map is one 7,419 line client component (`components/PubMap.tsx`) declared edit-locked for the decomposition. Everything below is mounted from it.

| Surface | Works | Will draw this complaint |
| --- | --- | --- |
| Map canvas | Price-banded pins, clusters, drink lanes, experience lens (All, No alcohol, Food), filters (beer garden, outdoor seating, live sport, dogs, darts, pool, open now), zones, saved only, POI layers, story bands, UK base pubs at zoom 12. Peek row "Cheapest in this view: £x at pub, N min walk". | "Open now" uses Wetherspoon hours only (`lib/openNow.ts`) while the sheet's details strip prints CityMCP open or closed. Two answers on one screen. Under a wine or cocktail lane the pins paint only from corroborated people-logged prices, so 312 venues with menu wine prices show "Unknown" on the peek. |
| Venue sheet, Overview | One price door per pub (log, confirm "Still £x?", or choose), community rows, action strip (book, menu, website, order food), occupancy, diary, visit reports, details fold (directions, hygiene, buzz, amenities, cuisine, access, weather tips), getting home (last train decision, buses, Citymapper, Uber, share pin), save to list, save for a night, I'm here, Spoons value, then-and-now, mug-check, pint needle, hygiene, community signals. | It is long. Twenty-two blocks on Overview. Hygiene appears twice (details strip and `VenueHygiene`). The getting-home fold is labelled "Last train" and lives inside Overview. Tabs are labelled Stories, Lore, Menu, Photos while the keys are `pints` and `story` (PlanAstra 8.1 "Tabs that fit" still open). |
| Pint Drop composer | Price, measure, bill photo, pint photo, story with voice dictation, "With", era, ten vibe tags, visibility. | A bill photo is mandatory for any priced write (`lib/pintDropReceipt.ts`). Expect "I just want to type £6.20" in week one. See idea F3 for the friction cut that keeps the rule. The composer still says "Public tonight. On the feed and the map" (`lib/spillPreview.ts`); `/feed` is a permanent redirect to `/social`. |
| "I'm here" | One tap presence at a pub, two hour window. | It reads a self-asserted handle from `localStorage.pubmax_handle`, posts to a public `GET /api/presence` that returns handle plus venue, and the button carries no "this is public" line. No live surface shows it since `/feed` died. Either make it mutuals-only like check-ins or print the audience. |
| Lore tab empty copy | | "Log a Pint Drop below with a passed-down story" points at a button that is on the Stories tab, not Lore. |
| Mobile planner pill | "Plan a pub crawl", "N picked · Add stops", "N-stop plan · Edit route". | `MobilePlanActivation` says "Lock it in on Plan" and renders no link to `/plan`. |
| Desktop rail | Area news. | `MapDesktopRail` is labelled "Conditions and area news"; the conditions slot is never filled. |

### 2.3 Plan, invite, crawls, rounds

| Surface | Works | Will draw this complaint |
| --- | --- | --- |
| `/plan` | Describe first ("Quiet in Clapham for 4"), 1 to 6 stops, a five step wizard, six templates (watch the match, leaving do, birthday for 10, quiz night, cheap round, client dinner), import a pub list. Keyless end to end. Grounded optimiser: legs under 1.6 km, under 3 km total, 50 minutes a stop, one pub per operator. | Any ask containing "walk" or a tube rule fails closed with "No N-stop route meets every must-have need" and no hint why (`lib/planGenerationSelection.server.ts`). "Short walk between pubs" is the most natural sentence a Londoner will type. Any dietary word (vegan, halal, gluten) refuses the whole plan instead of degrading. Only Clapham, Victoria and Canary Wharf are seeded crawl-ready in `lib/nightAreas.ts`; the other 17 areas generate at "low" confidence with warnings. Group prefs, crew constraints and the fair meeting point never feed generation; they are display only. |
| `/plan/[id]` | Privacy-safe server render, member upgrade on the client, "Send to the crew", copy invite link, rotate link, who's in with presence (In, On the way, Here, Running late), vibe vote, night crawl mode, host edit and guest propose, crew decisions panel, round starter, recap. | Two guest systems. The WhatsApp button shares `/plan/id#invite=token`; "Copy invite link" shares `/invite/token`. A WhatsApp guest is `collaborationAuthorized: false` and cannot vote, propose, add a need or check in, and is only told "Join the crew to use the invite tools". Expect "my mates can't vote". (PlanAstra 22 and 23 are fixed; this split is new.) |
| `/invite/[token]` | Going or Maybe with a name only, guest list, reactions, map prompt after RSVP. 200 cap. | The invite page reveals the plan title and every stop with its price to anyone with the token, while the plan page hides them. Fine as a capability link, but say so to the host. |
| `/crawls` | 15 fixed routes in packs with price ranges, a featured crawl, "Plan this crawl", "Start a round". User crawl stories at `/crawls/[slug]` with chaos score and share. | No date, no host, no join, no listing of user crawls, no edit after save (the PATCH exists, no UI). "Author" is a self-asserted device handle with a `TODO` in `lib/crawlStoryStore.ts`. There is no way to host a crawl that other people can find. See section 4.5. |
| `/rounds` | A bare page: handle field, start, open a code. Round page: who bought the last round, itemised spend that becomes a provisional price, add the pub you are in, live-ish by polling. | Nobody will find it. It is reached only from `/crawls` and the plan page. PlanAstra D8 (fold Rounds into the plan) is still open. `/r/[code]` is the referral redirect, not a round. |

### 2.4 Social, profile, messages, memories

| Surface | Works | Will draw this complaint |
| --- | --- | --- |
| `/social` signed out | A sign-in wall with handle search and a founders link. | PlanAstra 4 and 7.1 "London tonight lane, public" is still open and still the biggest social complaint: a stranger sees nothing. It is blocked on decision D2. **Decided by the captain on 1 November 2026** ([launch plan](LAUNCH_PLAN_2026-11-01.md), decision 7): a signed-out visitor reads a London lane, read-only. |
| `/social` signed in | Following, Nearby (area select), Across town. Composer with visibility (default mutuals), venue, 1 to 5 score with a venue, hashtags, photo tags with consent, four photos with descriptions, or one reel. Cheers, comments, saves, reports. OpenAI moderation before anyone else sees it. Rankings panel, crews panel, starter packs, people directory. | Posts never appear on a profile; the profile "Moments" tab is the Pint Drop timeline. Hashtags render as spans and are not tappable. Feature-request posts never show their status or the staff reply. Repost and quote exist in the API with no button. The Pubs & pints tab ranks "UK cities" from demo seed counts and prints "Seeded only where we've got demo data" on the live site. |
| Crews | Start a crew: name, start time, first pub, invite only or your lot can ask or anyone can ask. Join requests with accept and decline. Open crews listed on `/tonight` as "Open plans". | A crew page has no link to its own plan, no stop list and no chat. The host is told "Hand the crew to somebody else first" and there is no control for it; transfer, remove and close exist only as API routes. |
| Messages | DMs, groups of 3 to 12, photo, pub card, contact card, plan card (paste a link), poll. Realtime with a safety poll. | Any claimed handle can DM any other: no mutual requirement, no adult check and no block check in `app/api/messages/**`. Blocking someone on Social does not stop their DMs. There is no push for a DM, a follow, a comment or a crew invite. The "Document" attachment is a photo picker. Plan cards are paste-only; there is no "my plans" picker. |
| Profile `/u/[handle]` | Pint Passport, contributions, out-tonight toggle and board, Wanted list, diary, crews, saved lists, account hub, public or private account toggle, mute and block. | `docs/factory/roadmap.md` lists the public or private toggle as the next wave; it ships already. `/activity` carries four Pint-Drop-era kinds (follow, reaction, comment, crawl save) and no Social cheers or comments, which live only in the Social rail. Two inboxes. |
| Moment, Memories, Story, Recap | Private-first capture, Memory studio, a Story with per-moment contributor consent and alt text, a published recap page with an OG card. | The Moment form has a free-text "Venue reference" box that wants a raw venue id. The Story publish menu offers "Public in Stories"; there is no Stories surface. The studio never shows the recap link after publishing. |
| Founders, contributors | First hundred wall, contributor record. | Test handles on the wall (PlanAstra 17) need the owner's disposition before launch. |

### 2.5 Pub Pal

| Surface | Works | Will draw this complaint |
| --- | --- | --- |
| `/pal` | Meeting screen, five step onboarding (18+, form and name, look, voice, privacy), voice panel, night question, Year in Pints, seven boundary toggles, memory list with correct, delete and export. | The night question offers "Quiet couple", "Proper sesh" and "Absolute carnage" (2, 4 and 6 lively pubs). "Carnage" is on the CAP banned list in `docs/CAP_COPY_AUDIT_2026-07-21.md`, and six pubs as a one-tap default reads as a quantity nudge. Personality sliders are stored, have no UI and change nothing, which the copy admits. |
| `/pal/chat` | Vibe chips, cards with sources, "Use this pub", proposals with confirm. | Two Pub Pals. The map's Ask panel is titled "Ask your Pub Pal" and calls `/api/ask`, anonymous, no memory. `/pal/chat` runs the ElevenLabs agent, needs sign-in, recalls memories. They answer differently and share a name. `/pal/chat` has no nav entry. |
| Tools | 16 read tools, three confirm-gated writes (crowd report, memory, plan draft hand-off). | `find_desk` always answers "no seat data" because the London pack holds no cafe, coworking or library rows. `area_buzz` silently defaults to Westminster. The Pal cannot save a pub, log a price, lock a plan or message anyone, which is correct under ADR 0006, but the first question every user asks is "save that one". |

### 2.6 First run, account, shell

| Area | Works | Will draw this complaint |
| --- | --- | --- |
| First run | Web asks for nothing. Native first run: London, a fair pint (£5, £6, £7, no limit), location, result, pick your Pal. Handle claim modal after sign-in with optional name and date of birth. One-tap "I'm 18 or over" asked only at a contribution door. | No age gate before browsing an alcohol app. The Online Safety Act note in `docs/LEGAL_UNKNOWNS_2026-07-21.md` says a self-declared gate is not highly effective age assurance and the owner must choose Route A or B before DMs and the feed open to the public. That decision is not recorded. |
| Auth | Supabase magic link, SMS where enabled, handle and password, Google, Apple, Microsoft where flagged. | Clerk is mounted beside Supabase with no bridge; a Clerk account owns nothing (`lib/clerkIdentity.ts`). Either finish it or remove it before launch. `convex/` is dead code. |
| Settings | Night Profile (city, patch, time, group, people, budget, cap, drinks, voice, briefings), handle rename, password, weekly nudge, light or dark, analytics consent, export, delete. | Missing against any consumer app: change email, linked sign-in methods, notification preferences by kind, a blocked and muted list, follow-system theme, sessions and devices, an in-app feedback form (`/feedback` is a mailto to a personal address). |
| Notifications | In-app bell (four kinds), web push for the Thursday nudge and the one-off cheap pint ping, a night-signal broadcast to every device fired from a GET. | No push for anything social. Plan-scoped push is dormant because tokens carry no identity (`lib/pushSender.ts` `TODO(push-identity)`). Email does not exist: `lib/emailProvider.ts` throws "not implemented" even with a key. |
| Native | Capacitor remote wrap, haptics, share, camera, push registration, deep links, review prompt. | `apple-app-site-association` still reads `TEAMID`, `assetlinks.json` holds the placeholder SHA, `google-services.json` is absent. App name "PUBMAXXING" versus brand "PUBMAXX". Store work is captain-owned (#1358). |
| Admin | Queues for drops, posts, prices, comments, visit reports, reels, venue photos, avatars, covers, import notes, operator claims and proposals, added pubs. | No user ban or suspend control, though the banned state exists. Night-signal review has an API and no screen. No DM report queue. One shared token, no per-moderator identity. |

### 2.7 Data and freshness

| Fact | Consequence at launch |
| --- | --- |
| The pint dataset is re-collected by hand (`scripts/refresh_pint_price_observations.mjs`, last run 2 October). | Every price will read "2 October" at launch and a month older by Christmas. A weekly captain-run refresh needs a date in the ops checklist. |
| The public Pint Index snapshot is empty (`public/data/pint_index_snapshot.json`, `status: "empty"`), because it excludes the aggregator source. | The page says 960 pubs have a price and the borough league is empty. |
| Food prices: 2,620 dish rows across 45 venues, 4 in London; lane marked retired. "Roast" is a keyword chip on 29 venues. No kitchen hours anywhere. | "Where does food" works. "What does the roast cost" and "is the kitchen still open" do not. |
| Wine and cocktail rows: 57 of 7,986 state a serving size. | A wine price without a measure is not comparable. The measure vocabulary (`lib/drinkMeasure.ts`) is pint, half, other. |
| What's on: committed fallbacks hold 17 upcoming rows out of about 1,000. Production depends on the twice-daily cron into Supabase (unverified). Skiddle has no key. Eventbrite returns the account's own events only. Sport fixtures ended 24 August. Comedy and karaoke are folded into "event" and "music". | Tonight without events. |
| Operator rail: a verified operator can propose an event, offer, correction or response. An accepted proposal is built into a fact object and never saved or shown (`app/api/operator-proposals/route.ts`). The panel appears only on `/ledger/[id]`. | The first pub that claims its page and adds a quiz night will see nothing happen. |
| Freshness breaches on 30 October: `area_news` 46 days (budget 22), `google_places_content` 26 days (budget 16). Night signals: 0 claims, 107 days. | |
| City packs: Manchester 577 venues, Liverpool 426, Birmingham 411, Glasgow 313, Leeds 313, Bristol 274, Oxford 102, Cambridge 85, Bath 70, Llandudno 56, Durham 38. All 0 priced pins. `/places` says "London only, for now". | Fine under the London-first law. Say it on the city map itself, not only on `/places`. |
| `NEXT_PUBLIC_DEMO_CONTENT` is on unless set to `off`. Seeded drops merge into Supabase reads and the Stories tab prints a "Demo data" banner. | Must be `off` in both Vercel environments before the public build (`.env.example` says so). The live `/discover` page shows demo wording today. |

---

## 3. The week-one complaint list, ranked

These are the sentences real users will type into the mailto. Each names the fix that pre-empts it. Items marked **hygiene** are small and should ship before launch. Items marked **decision** wait on the captain.

1. **"Social is just a sign-in screen."** Public London-tonight lane on `/social` (PlanAstra 7.1). Decision D2, decided on 1 November 2026 (launch plan decision 7).
2. **"Nothing on tonight?"** See 3.3 and idea E4. Hygiene: when the store is empty, lead with pubs that have a quiz or sport flag and say "regular nights, not tonight's listing".
3. **"The price is wrong / from October / the pub shut."** Hygiene: a "That's wrong" door on every price and on the hours line (idea D6). Ops: a dated weekly refresh.
4. **"Why do I need a photo of my receipt?"** Decision: keep the rule (ADR 0010) and cut the friction with the bill reader (idea F3). Alternative decision: allow a priced write without a bill as "logged, unchecked" that never paints a pin.
5. **"My mates on WhatsApp can't vote."** Hygiene: one invite link, one guest capability. Either upgrade the classic token to `collaborationAuthorized` or stop offering two links.
6. **"I typed 'short walk' and it refused."** Hygiene: treat walk words as a preference, not a hard constraint, and name the word in the refusal.
7. **"I said vegan and it refused the whole plan."** Hygiene: degrade to "kitchens with a published menu link" plus the existing meal disclaimer, instead of a 422.
8. **"Someone I blocked is messaging me."** Hygiene: block check, adult check and a mutuals-first default in `app/api/messages/**`. This is also an Online Safety Act item.
9. **"Where did my post go?"** Hygiene: posts on the author's profile; tappable hashtags; one activity inbox.
10. **"Is this app meant to have demo pubs in it?"** Hygiene: `NEXT_PUBLIC_DEMO_CONTENT=off`, remove the city rivalry block or feed it real counts, fix `/discover` and `/drinks` titles ("Social | PUBMAXX" on a page headed "Pubs and pints").
11. **"Which Pub Pal is which?"** Hygiene: rename the map Ask panel ("Ask the map") or route it to the Pal.
12. **"Absolute carnage" and "Proper sesh".** Hygiene: CAP wording. Use the approved "Big one tonight" and "Live and loud" set.
13. **"It doesn't work outside London."** Hygiene: the city map banner "Pubs only, no prices yet, tell us your city".
14. **"I can't change my email / turn off notifications / see who I blocked."** Settings rows (section 2.6).
15. **"How do I host a crawl people can join?"** Section 4.5. This is the one big new thing worth building before launch.
16. **"Is the kitchen still open?"** Idea A1.
17. **"How much is a glass of wine?"** Ideas B1 and B2.
18. **"I want to meet people, not just my mates."** Section 4.3, inside the fences.
19. **"Tell me when it gets cheaper."** Idea D5.
20. **"The map is slow on my phone."** Not re-measured in this review. PlanAstra 2 and 32 (12 MB map, desktop LCP) need a fresh measurement on the launch head before anyone answers this.

### 3.1 Copy pointing at surfaces that no longer exist

Hygiene, one commit:

- "Public tonight. On the feed and the map." in `lib/spillPreview.ts`.
- "Public in Stories" and "Story published to Stories." in `components/profile/NightMemoryStudio.tsx`.
- "Powers the 'Your lot' feed tab" in `app/api/profiles/[handle]/lot/route.ts`.
- "server-side push SENDING is a later wave" in `app/api/push-tokens/route.ts`.
- "no auth yet" in `app/api/ratings/route.ts`.
- `docs/factory/roadmap.md`: the privacy toggle, the `/add` rewrite and the four message attachments are done.
- "Lock it in on Plan" with no link in `components/mobile/MobilePlanActivation`.

### 3.2 Numbers that disagree with each other

- 942 priced pubs (landing, about) against 960 of 2,034 (Pint Index).
- "No borough league yet" (about) against the borough list (Pint Index).
- Zone 6 reads dearer than Zone 5; the page already explains the thin sample, which is right.

Fix: one function answers "how many priced pubs", and every page reads it.

### 3.3 Tonight without events

Three things at once make Tonight empty: the committed fallback rows are dated July to October, the only quiz source (Question One) was read in July, and the operator rail never publishes. The cheapest honest fix for launch is not another scraper. It is three small moves:

1. Let the 94 "shows live sport" venues and the 83 quiz rows surface as regular nights ("Quiz on Tuesdays, per the pub's site, read July") with a dated label, separate from tonight's confirmed listings.
2. Persist and publish accepted operator proposals (event, offer, response). The route already builds the fact; it needs a store and a reader on the venue sheet and on Tonight.
3. Let a drinker add a regular night with a photo of the chalkboard (idea E4). It lands as a dated drinker report, never as a venue fact.

---

## 4. New features, by the themes the captain named

Each idea states the complaint it pre-empts, how it works, the data it needs, how it stays inside the fences, a size (S under a day, M a few days, L a week or more), and the PLG wave it extends. Fences are the ones in `AGENTS.md`, `docs/plans/PLG_STRATEGY.md`, the ADRs and `docs/VOICE.md`: no drinker pays, no referral grants, no alcohol-quantity rewards, no stranger radar, no invented facts, no aggregate scores, no scraping of closed platforms.

### 4.1 Food

**A1. "Kitchen's open till" tap.** Complaint: "Is the kitchen still open?" On the sheet's food row, one tap from a drinker who is there: "Still serving" or "Kitchen closed", with the 90 minute freshness window `lib/occupancy.ts` already uses for crowd readings. A second tap by another account inside the window confirms it, the same shape as a pint confirmation. Shows as "Kitchen open, said @handle 20 min ago", never as a venue fact. Data: none new; it is a report row. Fence: a drinker report with a date, not hours. Size S. Wave 2 (price flywheel without begging extends naturally to a kitchen flywheel).

**A2. Roast Radar.** Complaint: "Where's a Sunday roast and what does it cost?" A Sunday-only lens on the map and a Tonight card from Friday. Price comes in the same way a pint does: a dish chip "Roast" in the price entry, a figure, the bill photo, two-drinker confirmation. Pins under the lens carry the roast figure with its own colour scale that never touches the pint bands or the Pint Index. Seed from the 29 roast-tagged venues and the 31 roast rows already in the food pack. Fence: food figures stay out of pint buckets (`FIRST_PRINCIPLES_OUTINGS`), no estimate until three publishers exist. Size M. Wave 2.

**A3. Soak-up stop.** Complaint: "Plan a night with food in the middle." Today "kebab" or "food" raises a scoring boost and any dietary word refuses the plan. Change: a food need inserts one food stop (a pub with a kitchen and a published menu link, or a late-food terminal) between pints, with the existing line "Meal prices are not verified". A dietary word no longer refuses; it adds "We can't check vegan menus. These stops publish a menu link." Data: `amenities.food`, `venue_menu_enrichment.json` (119 menu links), late-food evidence. Fence: no dietary claim is ever made. Size M. Wave 1.

**A4. Menu board is a fact.** Complaint: "I'm looking at the price board, why can't I just send it?" Generalise the add-a-pub menu photo: from any venue sheet, "Photo of the board" uploads a picture of the drinks or food board. The Pal reads it and proposes line items (drink, measure, price) as cards; the person confirms each; each confirmed row lands as a dated people-logged price with the board photo as its bill. Ten prices for one photo. Fence: propose then confirm (ADR 0006), the photo is the receipt, never a scrape. Size M. Wave 2. This is the single biggest cut in time-to-first-price.

**A5. "Order food" that means something.** The action strip already offers "Order food" and "Look at the menu" links. Add "Kitchen hours" when a pub's own site states them (361 pubs have own-site hours; kitchen hours are a subset to collect under the same permission fence). Size S for the field, L for the collection.

**A6. Chip Index (later, outside London first).** The Greene King pack holds 2,530 priced dishes outside London. A "What a plate of chips costs" page is a press line waiting to happen, but London has four venues. Park until A4 fills the London gap. Size S once data exists.

### 4.2 Wine and everything that is not a pint

**B1. Glass sizes.** Complaint: "£7.50 for what, exactly?" Extend the measure set in `lib/drinkMeasure.ts` from pint, half, other to pint, half, 125 ml, 175 ml, 250 ml, bottle, single, double, other. A wine price prints its measure beside it everywhere, exactly as a half does today. Harvested rows without a stated size stay "size not stated". Fence: a measure is never scaled. Size S. Blocks B2.

**B2. House Wine Index.** Complaint: "Is wine as much of a rip-off as beer here?" Once B1 exists, one comparable figure per pub: the cheapest 175 ml of house white or red, listed or confirmed. Its own three-band scale, by city terciles, separate from the pint bands. Paints pins under the wine lane from listed menu prices with a "listed" ring, instead of only from corroborated community rows, so the 312 venues with menu wine stop reading "Unknown". A borough table on its own page, never merged into the Pint Index. Size M. Wave 2.

**B3. Guinness map.** 345 priced pubs carry a Guinness price, more than any other pint. A one-tap "Guinness" lane (the brand lane exists; promote it to the drink chip row), a "Cheapest Guinness within 15 minutes" answer on `/near`, and the existing `/drink/guinness` page linked from the map. No pour-quality rating (fenced). Size S. Wave 0 polish.

**B4. Dry round.** Complaint, due in January: "Dry January, what do I do with this app?" The "Alcohol-free first" crawl style exists. Add a "Dry round" chip on the planner and on Tonight that plans alcohol-free stops only, shows the alcohol-free price beside the pint price at every stop, and reads the 64 venues with listed alcohol-free prices first. Ship in December so it is live on 1 January. Fence: name it in words ("alcohol-free"), never "0.0". Size S. Wave 1.

**B5. Happy hour clock.** Complaint: "Which pubs have a deal on now?" The `happyHour` amenity exists in the model with no supply. Let a drinker photograph the deal sign: "2 for £12 until 7pm". It lands as a dated drinker report with an end time and expires on its own. Tonight shows "Deals people saw this week" in its own labelled block. Fence: a report, not a price; never paints a pin. Size M. Wave 2.

**B6. What's our round here?** Complaint: "What will a round cost us at each stop?" On a locked plan, each member picks a usual drink once (beer, wine 175 ml, alcohol-free, soft). Each stop prints the round from listed or confirmed prices with their dates, and "not listed" where a drink has no figure. It reuses the Rounds spend model as a forecast and makes B1 visible. Fence: a forecast of listed prices, no payment, no settlement. Size M. Wave 1.

**B7. Coffee for the morning after.** The Shoreditch coffee pilot and `/near` Work spots exist. A "morning after" card on the recap: the nearest priced flat white to the last stop. Size S.

### 4.3 Meetups, inside the fences

The product already has the only safe meetup primitive it needs: an Open Crew ("Anyone can ask to join", host accepts). Everything below builds on it. Nothing here is a stranger radar, a swipe or a feed of faces.

**C1. Open plans with a time, a cap and a line.** Complaint: "How many are coming and what's the vibe?" Add to the crew form: capacity (host picks 4 to 12), a one-line house rule ("First round's on whoever is late"), and a going count. Show the host's handle and how many nights they have hosted (a count of completed plans, which is a fact, not a score). Blocks and reports already apply. Fence: no face on a public card until the owner decides (Social Launch PRD). Size S. Wave 3.

**C2. Find each other.** Complaint: "I got there and didn't know who anyone was." Two things. In-app: a crew member who taps "Here" paints "N of the crew are inside" on the plan for the others, never for the public. Off-app: a "table card" the host can print or show on a phone, with the crew name and the PUBMAXX mark, generated from the plan. The physical token solves the awkward bit of every meetup. Size S.

**C3. Quiz team wanted.** Complaint: "I want to do a quiz and I've got two people." A what's-on quiz row gets a button "Need people for a team", which starts an Open Crew pinned to that pub and time with a cap of 6. Tonight lists them under the quiz. Size S once C1 exists. Wave 3.

**C4. Match on.** The never-built sport team picker. Pick a club, see the pubs that say they show sport, start an Open Crew for the fixture. Data: `sport_attributes.json` (94 venues) plus a fixtures feed with a permitted source (`FOOTBALL_DATA` key exists). The pub card says "shows live sport, per its site" and never "showing this match" unless the pub said so. Size M. Wave 3.

**C5. The Regular Table.** Scouted in `cursorplan.md`, never built. One fixed table a week per patch at a cheap pub, 19:00 Thursday, hosted by a founder for the first month and then by whoever volunteers. It is an Open Crew on a repeat, listed on Tonight with "Regular, every Thursday". No matching algorithm; a listing. Fence: no inferred compatibility. Size S in code, ongoing in ops.

**C6. Safety before any of it.** DM block check, adult gate on messages, "meet in a public bar, tell a mate" copy on every open crew page, and a report button on the crew itself. These are hygiene and they gate C1 to C5.

### 4.4 Trying out new pubs

**D1. "Never been" lens.** Complaint: "Show me somewhere I haven't done." For a signed-in person, hide every pub in their diary, their drops and their completed plans, within the current view. Pair it with Wanted ("Pubs to try"), which is the opposite list. Size S. Wave 2.

**D2. Pub roulette.** Complaint: "Just pick one." The never-built "Surprise us": one tap on `/near` and on the Pal, a random pub within 15 minutes' walk under the person's fair pint, with one dry line why ("Grade II, £4.80, garden") drawn only from facts on record. Spin again. Shareable as a card. Fence: random from listed, labelled as random. Size S. Delight for the cost of a lunch.

**D3. Swap what I've done.** The planner reads the diary and the drop history and avoids pubs already visited, with a chip to allow them back. Size S. Wave 1.

**D4. One line from a regular.** The twelve "Why this pub" lines on Tonight are sourced press quotes. Open the slot to people: a Passed-Down Note of under 140 characters can be marked "Why I go", shown on the sheet head with the handle and date, one per account per pub. Fence: attributed opinion, never a fact or a score. Size S.

**D5. Follow a pub.** Complaint: "Tell me when the price changes or a quiz is on." A follow on a venue, not only a person. A price change (confirmed), a new event, or a new photo at a followed pub lands in the bell, and in push for people who opted in. This reuses the cheap pint ping rails and needs push identity (the `TODO(push-identity)` in `lib/pushSender.ts`). Size M. Wave 4 (the second Friday).

**D6. "That's wrong" door.** Complaint: "This place shut in May." Every price, hours line and amenity chip gets an overflow "That's wrong", with three answers: shut down, price changed (opens the log flow), hours wrong (a free line). It lands in the admin import-notes queue that already exists. Size S. Hygiene.

**D7. Pub twins, explained.** "If you liked the Seven Stars, try the Cittie of Yorke." Only from explicit facts: same price band, same listing grade or era, same amenities, within one zone. The card prints the reasons. No inferred taste, no model. Size M. Later.

**D8. Borough bingo.** The Pint Passport already stamps a borough on a confirmed pint. Add a 33-square card on the profile and a share card at 11, 22 and 33. Breadth, never volume: the stamp is one confirmed price, and a second pint in the same borough adds nothing. Size S.

### 4.5 Hosting a pub crawl

This is the gap with the most pull and the least code. The pieces exist: a Plan with a start time and a host, an RSVP page that works without an account, Open Crews that strangers can ask to join, fixed and user crawl stories, night mode, a recap. What is missing is the noun "a crawl other people can find" and five controls.

**E1. Publish a plan as a crawl.** On a locked plan, the host taps "Open it up". The plan becomes an Open Crew with the plan's stops, start time, a capacity (4 to 20, the existing crew cap), a meeting pub and a one-line description. It appears on `/crawls` under a new first section "Crawls you can join this week", and on Tonight under "Open plans". A stranger asks to join; the host accepts; the joiner lands in the crew with the plan link, which crews today do not carry. Size M. Wave 3. This closes the crew page's three holes (no plan link, no stop list, no chat) in one move if plan chat (PlanAstra 7.4) ships beside it.

**E2. Run this crawl.** Every fixed route and every user crawl story gets "Host this on a date", which creates a plan from the story's stops with the date picker and hands over to E1. The 15 fixed routes become 15 ready-made events. Size S.

**E3. Host mode.** Night mode exists for members. For the host add: a headcount tap ("We're 9"), a "Move on in 10 minutes" line that every member sees (realtime exists; push waits on identity), a straggler link that opens the current stop as a pub card in Messages for latecomers, and "Ring the pub" when the crew passes 8 (a tel link from the venue record; the copy says "pubs often want a call for big groups"). Size M.

**E4. Add a regular night.** Complaint from hosts and landlords: "Our quiz is every Tuesday and your Tonight says nothing." From the venue sheet, "Add a regular night": kind (quiz, music, sport, comedy, karaoke, other), weekday, start time, and a photo of the board or poster as the receipt. It lands as a dated drinker report ("Quiz, Tuesdays 8pm, seen 30 Oct by @handle"), shown under the confirmed listings with its own label, and expires after 90 days unless someone taps "still on". Comedy and karaoke stop being folded into "event" and "music" (`scripts/whatson/eventsRefresh.mjs`). Fence: never a venue fact, never an invented listing. Size M. Wave 2. This fills Tonight the honest way.

**E5. Themed crawl builder.** The eight crawl styles exist. Add the silly ones people will share, each from data on record: "Grade II only" (432 listings), "Dogs welcome" (filter exists), "Alphabet crawl" (first letters A to F in order), "One line, one stop" (one pub per station on a tube line, using the station table in `lib/ask`), "River to river" (near-water flag). Every stop still passes the optimiser. Size S each.

**E6. The crawl kit.** For a locked crawl: a WhatsApp-ready itinerary message (stops, times, listed prices, last train from the final stop) and a printable one-page card. The `.ics` export exists; this is its human-readable twin. Size S.

**E7. Thank the host.** After the recap, each member can tap "Cheers to the host". It lands as a notification and a count on the host's own card. A count of thanks is a fact. No average, no rank, no leaderboard. Size S.

### 4.6 Wacky, cheap, and on voice

**F1. Pint price time machine.** `price_history/london.json` holds 103 historical observations and the sheet prints "£3.10 in June 2019. £5.40 now." Put a year slider on the map: pins that have a record for that year show it, every other pin greys out, with the line "Only pubs with a dated record light up". It is the most shareable screen the data can produce and it invents nothing. Size M.

**F2. Pub crawl bingo.** A card of nine squares for the night, none about drinking: find the oldest thing in the pub, ask the bar staff the pub's story, log one price, take a photo of the pub sign, sit in the garden, find a fireplace, spot a listed-building plaque, work out the last train, teach a stranger the mug-check. Squares tick off from actions the app already records. Fence: the PUBMAXX Promise, the life around the drink. Size S.

**F3. The bill reader (see A4).** Photograph the bill you already have to photograph. The Pal proposes the lines; you confirm. One photo, every drink logged.

**F4. Narrated crawl.** Read-aloud exists on `/ledger`. For the 15 fixed routes, generate a short narration per stop from the cited heritage facts, read by the person's chosen Pal voice, cost-capped like voice chat. "Pub crawl, narrated by your Pal." Size M, and it needs the ElevenLabs budget line.

**F5. Weather flipped it.** The generator already weights gardens by weather. On the morning of a locked plan, if the forecast turns, the host gets one line: "Rain at 8. Stop 2's garden swaps to the Blackfriar's fireplace, if you want it." The swap is a proposal in the crew decisions panel, never automatic. Needs push identity. Size M. Wave 4.

**F6. Home-time autopilot.** On "I'm heading home" the person gets their last-train card, the crew sees "@handle is heading home" (crew only), and the crew gets one "got home" tick when the person taps it. Consent on both taps. Fence: crew-scoped, never a location trail. Size S.

**F7. Pub dog of the week.** The photo wall gets a "Dog" category. Tonight gets one dog. That is the whole feature, and it is the one people will send to each other. Size S.

**F8. Mates' prices layer.** Your lot's logged prices as a map layer, mutuals only. "Sam paid £5.20 here on Friday." Fence: mutual follows, nothing public. Size S. Wave 3.

**F9. Crawl name generator.** Two words from the stops' names and the vibe vote. "Victorian Soho" becomes "The Brass Compass". Pure delight, zero risk. Size S.

**F10. Lost at the bar.** A per-pub note "left behind the bar" lane. People leave cards, coats and umbrellas in pubs every night. A note here is a drinker report with a date and the pub's phone link. Odd, useful, on brand. Size S.

### 4.7 Venue side (first revenue, no drinker pays)

ADR 0011 keeps the operator rail as preparation. Two moves make it visible without any charging:

**G1. The operator panel on the sheet.** Move `OperatorRailPanel` from `/ledger/[id]` to the venue sheet's details fold, behind "Run this pub?". Persist accepted proposals and read them on the sheet with the "operator" label. The response proposal lets a landlord answer a visit report in public, which every landlord will want on day one. Size M.

**G2. Price pledge.** A verified operator confirms today's listed price with one tap. It shows as "confirmed by the pub, today" and counts as one of the two confirmations, never both. Fence: the sponsorship policy; a pledge changes no ranking and no colour. Size S.

---

## 5. Four weeks to a public launch

A proposal, not a plan. Each week ends with `npm run verify` green and a captain decision list.

**Week 1, hygiene (section 3 items 5 to 14, 3.1, 3.2, D6).** Demo content off, titles, dead copy, one invite capability, walk and dietary words, DM block and adult gate, Pal naming and CAP wording, city map banner, "That's wrong" door, the settings rows that are a day each (change email, blocked list). Captain decisions needed: D2 (public Social lane), the Online Safety Act route, the receipt rule (keep with F3, or allow unchecked writes).

**Week 2, the honest Tonight and the crawl noun (3.3, E1, E2, E4, A1, B1, C6).** Regular nights from drinkers and operators, operator proposals persisted, publish a plan as a crawl, run a fixed route on a date, kitchen tap, glass sizes. Captain decision: capacity and visibility rules for public crawls, whether a host's handle alone is enough on a public card.

**Week 3, the things people will share (D2, F1, F7, B3, B4, B6, F3 if the model budget allows, C1, C3).** Roulette, the time machine, the dog, the Guinness lane, the dry round ahead of January, the round forecast, the bill reader, open plans with a cap, quiz teams.

**Week 4, freeze and proof.** The 60 second release metric on the launch head, a fresh map weight and LCP measurement against `perf/route-budgets.json`, the dated pint refresh, the smoke grid in `docs/SOFT_LAUNCH_RUNBOOK.md`, store placeholders if the apps ship, and the ops checklist dated.

After launch, in order: D5 and F5 (both need push identity), E3 host mode, B2 House Wine Index, A2 Roast Radar, C4 Match on, C5 the Regular Table, G1 and G2.

---

## 6. Things to decide before any of this

1. **D2.** A public, readable London lane on `/social`. Everything in 4.3 and 4.5 is louder with it and still works without it. **Decided by the captain on 1 November 2026** ([launch plan](LAUNCH_PLAN_2026-11-01.md), decision 7): signed-out visitors can read a London lane. It is read-only: posting, cheers, comments, saves, follows and DMs still need sign-in. The rule is in [`docs/rules/lib-identity-accounts-and-sessions.md`](../rules/lib-identity-accounts-and-sessions.md#a-stranger-reads-the-london-lane-and-nothing-in-it-describes-the-reader).
2. **Age assurance route.** Route A or B from `docs/LEGAL_UNKNOWNS_2026-07-21.md`, recorded before DMs and the feed open to the public.
3. **The receipt rule.** Keep (with the bill reader) or allow an unchecked write that never paints.
4. **One invite.** Which link wins, and whether a WhatsApp guest is a collaborator.
5. **Public crawl cards.** Handle only, or handle and face.
6. **The pint refresh cadence.** Who runs it, which day, and where the date is written.
7. **Clerk.** Finish the bridge or remove the mount before launch.
8. **Test handles on the founders wall.** Keep the gaps, remove the names.

---

## 7. What this review did not do

- It did not measure speed. PlanAstra items 2 and 32 stand until somebody re-measures on the launch head.
- It did not read production stores, so "Tonight is empty" is a reading of the committed fallbacks and the live page on one evening.
- It did not run the signed-in journeys in a browser. The signed-in findings come from code.
- It did not re-check the 70 rows of PlanAstra section 7. Where an idea above overlaps one of them, the PlanAstra row is the primary entry and the idea names it.
