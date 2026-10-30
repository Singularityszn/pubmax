# Week 1 hygiene build, 30 October 2026

A dated record of the first build round after [`LAUNCH_REVIEW_2026-10-30.md`](LAUNCH_REVIEW_2026-10-30.md). Fable 5.1 plans and integrates; Opus 5.5 at medium effort builds, five builders at a time, each in its own git worktree on a disjoint set of files. Nothing merges without `npm run verify` green on the integration branch. The captain applies migrations and decides the deploy.

## 1. Round 1: the hygiene list

Each row is one builder. "Proof" is what the builder runs before it hands back. The integration order is the row order; it goes from the least shared files to the most.

| # | Slice | Files owned | Done when | Proof |
| --- | --- | --- | --- | --- |
| 1 | Planner honesty and Pal copy | `lib/nightPlanning.ts`, `lib/planGenerationSelection.server.ts`, `lib/planGeneration.server.ts`, `app/api/plans/generate`, `components/pal/PalNightQuestion.tsx`, `lib/palNightQuestion.ts`, `components/map/MapConciergeAsk.tsx` | "short walk" and "near a station" never refuse a plan and leave a report line; vegan and halal degrade with a warning and a menu-link preference; meal price words still refuse; the Pal offers "Quiet pint", "Big one tonight", "Live and loud" and never six pubs; the map panel is "Ask the map" | planner and Pal unit tests, em-dash law, lint, typecheck |
| 2 | DM safety, posts on profile, hashtags | `app/api/messages/**`, `lib/messagesStore.ts`, `app/api/social/posts/route.ts`, `components/social/SocialPostCard.tsx`, `app/u/[handle]/ProfilePageClient.tsx` (one new section), `app/social/SocialPageClient.tsx` | a blocked pair cannot open or send; sending needs the adult answer; a profile shows its author's posts with the visibility matrix; hidden-name posts never show on a profile except to the owner; a hashtag is a link and the public lane filters by tag | route tests for both block directions and the adult gate, a visibility matrix test, friction voice, em-dash law, lint, typecheck |
| 3 | One invite capability | `app/api/plans/[id]/join`, `app/api/plans/[id]/invites/**`, `app/api/invite/[token]/**`, `lib/planCollaborationStore.ts`, `components/plan/**`, `app/invite/**` | a guest who joins through the shared token can vote, propose, add a need and check in; the host alone saves routes, accepts, rotates, removes and completes; a bare plan id is still 403; both share buttons send one absolute `/invite/<token>` URL; a Going RSVP lands in the crew | collaboration and invite tests, analytics emitter fence, em-dash law, lint, typecheck |
| 4 | Copy and numbers | `lib/spillPreview.ts`, `components/profile/NightMemoryStudio.tsx`, three route comments, `components/mobile/MobilePlanActivation*`, `lib/pintDropComposerConfig.ts`, `docs/factory/roadmap.md`, the priced-pub count module and its readers, `app/social/page.tsx` metadata, `lib/cityRivalry.ts` and its block, the non-London city map line | no copy names `/feed` or Stories; one function answers the priced-pub count and every page reads it; the Pubs & pints tab has its own title; the city table renders nothing on demo or zero counts; a non-London city map says "Pubs only here, no prices yet" | copy fences, agentsMdTree, lint, typecheck |
| 5 | "That's wrong" door and settings rows | new `lib/venueCorrectionsStore.ts`, `app/api/venue-corrections`, `app/api/admin/venue-corrections`, one migration with its rollback, `app/admin/AdminClient.tsx` (one tab), `components/map/inspector/VenuePriceSummary.tsx`, `components/map/inspector/VenueOverviewTab.tsx`, new `components/profile/ChangeEmailCard.tsx` and `BlockedAccountsCard.tsx`, `components/profile/PubmaxxAccountHub.tsx` | a signed-in person can say a pub is shut, its hours are wrong or something else, and a moderator can resolve it; "price changed" opens the log flow; change email and the blocked list live under Account settings | store, route denial and rate-limit tests, the permission matrix extended, lint, typecheck, db types check |

Shared rules every builder carries: no edit to `components/PubMap.tsx` (edit-locked), no new analytics event, house voice (no em dash, no exclamation mark, British spelling, the banned words in `docs/VOICE.md`), a commit with no agent trailer, no push.

### Conflict map

Builders 2 and 5 both touch the mute and block store. Builder 5 adds new exports only; builder 2 imports the existing ones. Builder 4 edits one file under `components/profile` (the studio); builder 5 edits the hub and two new cards. No other file is shared. If two builders still collide, the integration keeps the later builder's version of the shared line and re-runs that builder's tests.

### Integration

1. Fetch each worktree branch into the main checkout and merge it into `claude/relaxed-wozniak-bbaih7` in row order.
2. After each merge run that builder's named tests. After the last merge run `npm run verify` (the merge bar). Where a gate cannot run in this container (the PostgreSQL harness, the browser suite), say so in the pull request and leave the row for CI.
3. Push and update [Singularityszn/pubmax#2402](https://github.com/Singularityszn/pubmax/pull/2402), or open a second draft pull request if the captain wants the review separate from the build.
4. Builder 5's migration waits for the captain. Until it is applied, the correction route answers 503 in production by the store seam's own rule, and the pull request says so.

### Decisions this round needs from the captain

1. The migration for venue corrections: apply or hold.
2. The one-invite rule: a shared token now grants crew powers to anyone who holds it. If the captain wants a quieter default, the alternative is "RSVP guests read, crew members act", and builder 3's work becomes a toggle on the plan.
3. Demo content: set `NEXT_PUBLIC_DEMO_CONTENT=off` in Vercel Preview and Production before the public build. This is an environment change, not code.

## 2. Beli parity ledger

The captain asked that nothing a person expects from an app like Beli is missing at launch. Beli is a restaurant list-keeping app: Been and Want-to-try lists on a map, a pairwise ranking after each visit, notes and favourite dishes, tags, a friends feed of visits, a taste profile, a match score with friends, two scores per place (predicted for you, your friends' average), recommendations, city and platform leaderboards by number of places ranked, streaks, invite-unlocked features, paste from TikTok and Instagram into Want-to-try, reservation links, public or private profiles, tagging who you went with.

Each row below says what PUBMAXX has, which fence applies, and what round 2 does.

| Beli has | PUBMAXX today | Fence | Round 2 action |
| --- | --- | --- | --- |
| Been list on a map | Diary (`/api/diary`), Pint Drop timeline, completed plans, each in its own place | none | One "Been" count and list on the profile head, with a map toggle. Reads diary, drops and completed plans. |
| Want to try | Wanted (`/api/wanted`, "Pubs to try") with paste of a name or link | A pasted link is never fetched (CONTEXT.md) | Keep. Add "Pubs you both want to try" on a mate's profile (explicit overlap, see below). |
| Pairwise ranking after a visit | `ComparePubFlow`, `PubRankingPanel`, `RankThisPub`; private; reached from the Social rail and the pub page | none | Offer the rank at the moment of the visit: after a diary log, after a plan completes, after a priced drop. One "Which did you prefer?" card, skippable. Show "Your pubs, ranked" on the owner's profile. |
| Notes and favourite dishes | Diary one-liner, Pint Drop story, drink on a drop | none | "Your usual here" on the diary entry (a drink name, free text, private). |
| Tags and labels | Saved lists (Want to Visit, Cheap Pint, Coding Pint, Historic, Date Night, Crawl Stop, Local Legend) plus custom lists | none | Keep. Make a list page shareable with an OG card (route exists at `/u/[handle]/lists/[listType]`; it needs the card). |
| Friends feed of visits | Social Following lane shows posts; a diary log or a rank posts nothing | Consent: a private log stays private | A "Tell your lot" toggle on the diary log and the rank card, default off, posts a mutuals-only card ("@x ranked the Seven Stars above the Cittie of Yorke"). |
| Taste profile | Pub Pal taste read, private to the Pal | No inferred personality or sensitive inference (ADR 0006, Social Night OS) | A "Your taste, in facts" card on the owner's profile: most-logged drink, the borough you rank highest, the era of the pubs in your top five, your fair pint. Every line is a stored fact with a date. |
| Match score with friends | none | No inferred compatibility | Explicit overlap only: "Pubs you both rank in your top five" and "Pubs you both want to try" on a mate's profile. No percentage. |
| Two scores per place | Mutuals-only "your lot's" average on the pub page (`PubLotReviews`); no predicted score | No aggregate score, no venue average on the map, no "top rated" (ADR 0017) | Keep the mutuals read. Do not build a predicted score. |
| Recommendations | Suggested venues from conditions and the planner | Only from explicit facts; label the reason | Pub twins (idea D7): same price band, same era, same amenities, within a zone, with the reasons printed. |
| Leaderboards by count | Contributor record (prices logged, visits written, recommendations) | No consumption leaderboard, no "most places" board (MASTER_PRD, #1522) | Do not build. Borough bingo (idea D8) is breadth, not volume, and stays on the owner's own card. |
| Streaks | none | Refused (VOICE.md, MASTER_PRD) | Do not build. |
| Invite unlocks | Referral mark on the owner's card | A referral is a mark of honour, never a feature | Do not build. |
| Paste from TikTok and Instagram | Wanted paste of a name or link | No scraping or oEmbed fetch of closed platforms | Keep paste. Add the native share target so a shared link lands in Wanted (PlanAstra 8.4). |
| Reservations | Booking deep links on the sheet | No in-app booking this horizon | Keep. |
| Public or private profile | Ships (`lib/accountVisibility.ts`) | none | Keep. Correct the roadmap (builder 4). |
| Tag who you went with | "With" free text on a Pint Drop; photo tags with consent on posts | Consent before a handle appears | "With" becomes handle tags with the same consent inbox the photo tags use, on the diary and the drop. |
| Categories | Venue kinds: pub, bar, club, late food, restaurant, cafe, coworking, library, hotel bar | none | Keep. |
| Filters by price, place, cuisine | Price caps, zones, areas, cuisine chips, amenities | none | Keep. Unify the three price-cap sets (desktop, phone, rail). |
| Photos per visit | Pint photo, venue photo, wall, posts | Image rights: own, community, Wikimedia | Keep. |
| Group competitions | none | No volume competition | Borough bingo as a crew card: the crew's shared boroughs with a confirmed pint. Breadth only. |

## 3. Round 2 plan (five builders, after round 1 integrates)

| # | Slice | Builds | Needs first |
| --- | --- | --- | --- |
| 6 | Been, rank at the moment, rankings on profile | Been count and list, the rank card after diary log and plan completion, "Your pubs, ranked" on the owner's profile, share your top ten as a card | round 1 merged |
| 7 | Explicit overlap and the taste-in-facts card | "Pubs you both rank top five", "Pubs you both want to try", "Your taste, in facts" | 6 |
| 8 | Tell your lot | Consent toggle on the diary log and the rank card that posts a mutuals-only card; "With" as consented handle tags | round 1 builder 2 merged |
| 9 | Venue sheet triage (design V1, see the design record) | Overview grouped into five folds, one hygiene block, tab names that match their contents, one price-cap set | round 1 builder 5 merged |
| 10 | Tonight and Today without events (design V1) | Regular nights lane from the flagged venues, Tonight lede by time of day, Today as the daytime page | round 1 builder 4 merged |

The design record for rounds 2 and 3 is [`../design-explorations/2026-10-30-launch-ux-variations.md`](../design-explorations/2026-10-30-launch-ux-variations.md).
