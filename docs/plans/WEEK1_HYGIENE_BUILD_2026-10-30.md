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

## 3. Round 2 (started 30 October, 15:55 UTC, before round 1 handed back)

The captain asked for round 2 to start without waiting. The cut is by surface rather than by feature, so none of the ten concurrent builders shares a file with another. Rows 6 and 7 from the earlier plan are merged into one profile builder; "Tell your lot" rides with the rank card because both live on the diary log.

| # | Slice | Builds | Files it owns |
| --- | --- | --- | --- |
| 6 | Profile passport, rankings, overlap, taste | Passport head with Been and Want-to-try counts, Been list with a map link, "Your pubs, ranked" on the owner's profile with a top-ten share card, "Your taste, in facts", "Pubs you both rank top five" and "Pubs you both want to try" for mutuals | new `components/profile/Passport*`, `app/api/profiles/[handle]/{been,overlap,taste}`, one mount region in `ProfilePageClient.tsx` |
| 7 | Rank at the moment, tell your lot | `RankAfterVisitCard` after a diary log, a completed plan and a priced drop; "Your usual here" on the diary; a default-off "Tell your lot" toggle that makes the server post one mutuals-only card | `components/visits/DiaryLogPanel*`, `components/night/NightModeCard.tsx`, the receipt in `components/map/VenuePriceSubmit.tsx`, `app/api/diary`, `app/api/social/rankings` |
| 8 | With tags, list cards, share target | "With" as consented handle tags through the existing tag inbox; list pages with a head and an OG card; a web and native share target that pre-fills Wanted and never fetches the URL | `components/map/composer/**`, `SocialTagInbox.tsx`, `app/api/social/tags/**`, `app/u/[handle]/lists/**`, `public/manifest.webmanifest`, `lib/nativeDeepLinks.ts` |
| 9 | Sheet and map micro-fixes, one toolbar | Tab names match contents, hygiene once, one price-cap set, the sheet head overlap, the Lore empty copy, the desktop toolbar at eight controls or fewer, Tonight reserved heights, the unwired CSS import | `lib/venueInspectorTabs.ts`, `VenueInspectorHeader.tsx`, `VenueStoryTab.tsx`, the CityMCP strip, `MapToolbar.tsx`, the price-cap chips, `ControlRail.tsx`, `app/tonight/tonight.css` |
| 10 | Tonight and Today | Three answer cards above the rows; a regular-nights lane from the committed quiz, sport and music files with its read date, visibly separate from confirmed listings; open plans above the fold; Today as the daytime page | `app/tonight/*Client*.tsx`, `app/today/**`, `lib/tonight*.ts`, `lib/todayBrief.ts`, new `lib/regularNights.ts` |

Integration wiring that no builder does: if builder 6 and builder 2 both edit `ProfilePageClient.tsx`, the integrator keeps both sections. The venue sheet fold regrouping (design V1) waits for round 3, after builder 5's door lands in `VenueOverviewTab.tsx`. E4, a drinker-added regular night, also waits for round 3 because it needs a store and a migration.

The design record for rounds 2 and 3 is [`../design-explorations/2026-10-30-launch-ux-variations.md`](../design-explorations/2026-10-30-launch-ux-variations.md).

## 4. Integration record (30 October, 17:00 UTC)

All ten builder branches are merged into `claude/relaxed-wozniak-bbaih7`. The integrator's own commits are the glue: one write-surface count (166), two inventory rows, one export exclusion, one metadata typing fix, one cover tint, and three migration labels. Three builders took label 0197 in parallel; the files first read 0197 venue corrections, 0198 Pint Drop With tags, 0199 diary usual drink, each with its rollback. Other branches hold 0197 to 0202, so the five migrations now read 0203 venue corrections, 0204 Pint Drop With tags, 0205 diary usual drink, 0206 regular night reports, 0207 diary With tags.

What ran green on the merged tree: every builder's named unit tests together (439 of 441, then the two inventory rows fixed and green), the write-surface certification, the migration version and apply-list fences, the store inventories, the em-dash law, the analytics emitter fence, the coral economy, the account export fence, and typecheck. Lint was clean on each builder's own branch and is re-run on the merged tree.

What did not run here, and must run before merge: the PostgreSQL suites (`npm run test:rls`, the permission-matrix effective cases, the migration-effective tests), because PostgreSQL refuses to start as root in this container; `npm run db:types` to regenerate `types/database.ts` for `venue_corrections` and `pint_drop_with_tags` (builder 7 hand-edited the diary column); and the Playwright specs whose selectors were edited (Prices tab, Tonight answer cards, invite copy, Pal night question).

### Captain decisions collected from the builders

1. Apply migrations 0203 to 0207, in timestamp order, after `npm run db:types`.
2. One invite capability: the shared link now grants crew powers (vote, propose, add a need, check in). Say if the quieter "RSVP reads, crew acts" rule is wanted instead.
3. Should a Going RSVP form friend links with the host when the guest is signed in, as the plan-page join does? If not, the invite page line about connecting with the host must change.
4. Planner report lines ("Short walks", "Tube") exist in the response; the plan screen does not print them yet. Show them or leave them.
5. The dietary warning's second sentence wording.
6. "Quiet pint" as a Pal label: the Pal copy test now allows that one approved label and blocks carnage, sesh and session.
7. Blocks inside an existing group thread: checked at creation only, so a later block does not reveal itself. Keep, or close the thread.
8. Author posts on a profile need a signed-in Social reader; opening them to strangers is decision D2. The captain decided D2 on 1 November 2026 (launch plan decision 7): only the read-only London lane on `/social` opened to strangers, and author posts on a profile stay signed-in.
9. Account deletion removes the person's venue corrections. The other choice keeps the note and drops the owner link.
10. Secure email change must be on in Supabase Auth or the "old address gets a note" line is untrue.
11. With tags: the native share extension (iOS) and SEND intent filter (Android) are listed in builder 8's report for the native rebuild.
12. Two counts stay on purpose: 960 pubs have a pint price, the average uses 939, each page names its base.

### Round 3 (started 30 October, 17:05 UTC)

Five builders, each merged onto the integration branch before work so rounds 1 and 2 are under them.

| # | Slice | Files it owns |
| --- | --- | --- |
| 11 | Venue sheet five folds (design V1): Price open by default, then Tonight, Getting there and home, The pub, Your record | `components/map/inspector/VenueOverviewTab.tsx`, new `Overview*` split files, `components/map/venueSheet.css`, a fold table in `lib/` |
| 12 | E4, a drinker-added regular night: store, migration 0206 (first cut as 0200), write route with photo, "still on", admin tab, read merged into the regular-nights lane with its own label, add control on Tonight and the pub page | new `lib/regularNightReports*`, `app/api/regular-nights`, `app/api/admin/regular-nights`, one AdminClient tab, `components/tonight/AddRegularNight.tsx`, `lib/regularNights.ts` |
| 13 | The With line on the drop card from one batched read, retry resends tags, tags follow a rename, With tags on the diary, edit the usual | `components/map/inspector/PintDropsList.tsx`, `components/map/usePintDrops.ts`, `lib/pintDropWithTags*`, `components/diary/**`, `lib/diary*`, `app/api/diary` |
| 14 | The plan as one card (design V2), "Lock it in on Plan" links, the Pal share uses the one `/invite` URL, the invite page as a timeline | `components/plan/PlanSummary.tsx`, `MobilePlanActivation.tsx`, `app/plan/plan.css`, `components/pal/PalNightQuestion.tsx`, `app/invite/[token]/*` |
| 15 | Rules docs say what the merged code does; run the browser specs whose selectors rounds 1 and 2 edited and fix selector drift only | `docs/rules/*`, `docs/security/PERMISSION_MATRIX.md`, `e2e/*` |

The list the round was cut from:

- Show the "With" line on the drop card (`components/map/inspector/PintDropsList.tsx`), left by builder 8 because the inspector was another builder's area.
- Rules docs: the Today picks rule and the Tonight first-row rule in `docs/rules/`, the one-invite rule in `docs/security/PERMISSION_MATRIX.md`, the pubs-only line and the count module.
- "Lock it in on Plan" link in `components/plan/MobilePlanActivation.tsx` (one line).
- The venue sheet fold regrouping (design V1) now that the correction door is in.
- E4, a drinker-added regular night, with its store and migration.
- The diary edit form for the usual drink; With tags on the diary.

### Round 3 integration record (30 October, 18:15 UTC)

All five round 3 branches are merged. Builder 15 (rules docs and browser specs) merged last with no conflict: seven rule files and the permission matrix now describe rounds 1 and 2, one spec asked for an incomplete plan with a walk word that round 1 stopped refusing and now asks for step-free instead, and two specs fail on time alone on a loaded machine (spill-composer-keyless at its 30 second limit, food-menu-discovery at 1440px) and must be rerun on a quiet one. Main was merged in at 1166a118 (Sun Chaser and the Pint compass); its one conflict was the Sun Chaser line, which main put under the address and the five folds had moved into The pub fold, so the line now sits above every fold. Two more fences broke on the merged tree and are fixed: the correction door and the regular-night form read the session seam, the rank card lets a refused body go, six raw CSS values moved to tokens, and the two regular-night direct reads are declared in the surface read fence. The integrator's glue this round: migration labels 0206 (regular night reports) and 0207 (diary With tags); the 0174 diary rollback now drops the 0207 link first; the rank card's bands are a wrapping row; the write-surface count is 169; one effective-RLS assertion reads a boolean as the harness prints it ("true"); the correction door and the regular-night form read the session seam; the rank card lets a refused body go; six new raw font sizes, corners and fallbacks moved to tokens.

Captain decisions from round 3: a board photo is moderator-only until approved; the reporter's handle is read live, never stored; "still on" adds 90 days and only another account may tap it; diary With tags are not editable after save (round 4 fixes this); `types/database.ts` does not know the new tables until `npm run db:types` runs; `docs/security/PERMISSION_MATRIX.md` has no rows for 0204 to 0207 yet (builder 15); the Pal share said "tap I'm in" while the invite page says "Going" (round 4 unifies); the invite timeline numbers stops from the meeting pub and the plan card from the first stop (round 4 aligns them); the address, "I'm here" and save controls are hidden until their fold opens (design V1, confirm).

### Round 4 (started 30 October, 17:55 UTC)

Week 2 of the review: the honest Tonight, the crawl noun, kitchen and glass, with a design pass. Five builders, each merged onto the integration head (034db7e6) before work. Nobody touches `e2e/`, `docs/rules/` or `docs/security/PERMISSION_MATRIX.md` while builder 15 holds them. Labels: other branches hold 0197 to 0202 and rounds 1 to 3 moved to 0203 to 0207, so round 4 takes 0208 to 0211.

| # | Slice | Files it owns | Label |
| --- | --- | --- | --- |
| 16 | E1 "Open it up": a locked plan becomes an open crew that carries the plan; `/crawls` opens with "Crawls you can join this week"; E2 "Host this on a date" on every fixed route and crawl story | the open crew model and routes, `app/crawls/**`, one mount line in `PlanCard.tsx` | 0208 if the crew table needs columns |
| 17 | A1 "Kitchen's open till" tap in The pub fold with a 90 minute window and one confirmer; the "Still on" button on drinker-added regular nights; the journey fold opens by an explicit prop | new `lib/kitchenReports*`, `app/api/kitchen-reports`, `components/map/inspector/**` | 0209 |
| 18 | B1 glass sizes in `lib/drinkMeasure.ts` (125 ml, 175 ml, 250 ml, bottle, single, double), never scaled; B6 "What's our round here?" on the locked plan from listed prices with dates; the planner report lines print on the card | `lib/drinkMeasure.ts`, the composer measure chips, `components/plan/**`, `app/plan/**` | 0210 and 0211 only if a constraint or column must change |
| 19 | D8 borough bingo on the owner's profile (33 squares, breadth only, share card at 11, 22, 33); diary With tags editable after save; tag checks follow a rename by account id; invite copy says "Going" everywhere and numbers stops as the plan card does | `components/profile/BoroughBingo*`, `lib/boroughBingo.ts`, `components/diary/**`, `app/api/diary`, `lib/pintDropWithTags*`, `app/invite/**`, the Pal share copy | none |
| 20 | Three 390 px HTML mockups (V1, V2, V3) of the sheet, Tonight, the locked plan and the profile; the peek row's dark "Unknown" moved to a token that measures AA; a measured contrast sweep of every stylesheet rounds 1 to 3 added; the dock overlap measured, not changed | `docs/design-explorations/2026-10-30-phone-mockups/**`, CSS token swaps only | none |

Held for round 5, after builder 15 lands: the five-fold rule and the kitchen and bingo rules in `docs/rules/`, the PERMISSION_MATRIX rows for 0204 to 0211, and the browser specs for the folds, the kitchen tap and the open crawl section.

### Round 4 integration record (30 October, 18:35 UTC)

All five round 4 branches are merged, in the order 20, 16, 19, 17, 18. Migrations on the branch after this round, each with its rollback twin: 0203 to 0207 from rounds 1 to 3, 0208 open crew plan, 0209 kitchen reports, 0210 drink measure sizes, 0211 plan crew usual drink. The write-surface count is 172 (open crew, kitchen reports, usual drink). The integrator's glue: the Sun Chaser line from main sits above the five folds; the two regular-night direct reads are declared in the surface read fence; the invite scroll stop reserves the chrome once; the Pal browser spec reads "Going"; the plan card mounts "Open it up" and the round forecast side by side; the matrix test imports both new routes.

Two independent reviews of fc6f70d3 (product and security, via the Codex coordinator) raised seven findings. They are being reproduced and fixed in a separate pass that lands after the frozen head is reviewed: the fair pint read from the night budget, venue aliases in the passport counts and overlap, the hygiene match cache hiding a current answer, the rail cap label against its value, monthly music parsed as a weekly night, the diary share comparing two account id domains, and the regular-night reporter handle after a suspension or ban.

Captain decisions from round 4:

1. Apply 0208 to 0211 in timestamp order, then `npm run db:types` (three builders hand-edited `types/database.ts`).
2. Opening a plan up uses the crew rules: the plan moves to the crew page, seat tokens rotate and the open invite link stops working; guests who joined by the old link must ask to join the crew. Keep, or keep those guests.
3. `/plan/[id]` cannot show a crew-held plan, so the crew page is the plan's link for an open crawl.
4. The host's one line refuses carnage, sesh, session, wasted, smashed, hammered, blackout and bottomless, plus links, emails, phone numbers and handles.
5. Open crews made before 0208 keep showing on Tonight and do not show on `/crawls`.
6. Kitchen taps show only on pubs with a food row. A matching tap after a confirmation changes nothing.
7. The Tonight drinker-night read now carries the session token so the reporter's own rows can hide the "Still on" button; say if anonymous reads must stay strictly anonymous.
8. The round forecast reads the listed pint price only; a drinker-confirmed pint is not read yet. The planner report line lives on the device that built the route.
9. The one-tap beer price door now offers the wine and spirit sizes because it shares the chips. A wine price from the venue price door still carries no size until B2.
10. A bingo square fills from any visible Pint Drop in the borough, not only a priced one. Say if a confirmed price is required.
11. Mockups show initials, not photographs, for faces on public surfaces (V2) until decided. The dock and the create disc were measured 133 px apart at 390 px, so micro-fix 10 is optional.
12. After a rename, the drop store's author reads still filter on the current handle text, so older drops leave the passport geography and the bingo count; the fix belongs in `lib/pintDropsStore.ts`.

Held for round 5: the rules docs rows and the PERMISSION_MATRIX rows each builder wrote in its handback (open crawl, kitchen tap, usual drink, bingo, diary tag edits), the `docs/WRITE_SURFACE_CERTIFICATION.md` header count, the plan page line that still says "Mates tap I'm in", the browser specs for the folds, the kitchen tap, the open crawl section and the round forecast, and the drop store rename read.
