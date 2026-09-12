# PlanAstra: the next PUBMAXX features

Canonical plan for [#1581](https://github.com/Singularityszn/pubmax/issues/1581), within
[#1576](https://github.com/Singularityszn/pubmax/issues/1576). Reconciled 7 September 2026.
The deliverable is this plan. Feature implementation requires the captain's scope decisions.
Research children [#1577](https://github.com/Singularityszn/pubmax/issues/1577),
[#1578](https://github.com/Singularityszn/pubmax/issues/1578), and
[#1579](https://github.com/Singularityszn/pubmax/issues/1579) are closed.
The decision interview remains [#1580](https://github.com/Singularityszn/pubmax/issues/1580).

## Closeout checkpoint

Rechecked against GitHub issue bodies and comments on 7 September 2026.
The relationships below are written in issue bodies; GitHub's subissue list for #1576 currently returns no entries.

- [x] #1577 research delivered and closed: report section 1, 312 screenshots, four viewport sizes, signed-in and signed-out journeys.
- [x] #1578 research delivered and closed: report section 2, three-run route medians and source-level outage review.
- [x] #1579 research delivered and closed: report section 3, 21 social families, reachability and category comparison.
- [x] #1581 canonical draft recorded: 70 feature rows; 38 previously empty acceptance cells now state criteria or explicit blockers.
- [ ] #1580 interview: record the remaining scope decisions. Its three research prerequisites are complete, not still blocked.
- [ ] #1576 owner review and remaining child disposition. A completed planning artifact does not prove its proposed features work.

The research checks mean the research was delivered, not that every reported defect is fixed.
Store inventory verification belongs to #727. It does not establish product acceptance.

## Evidence and status

This document preserves the fleet draft dated 6 September 2026, updated at 17:10 BST.
Its source is `~/karan-agent-workspace/data/reports/PlanAstra.md`, also posted in #1581.
The original author was the plan-astra scout on Fable 5.1.
The source reviewed production `1d676d930` and main `5bf044f55`.

Fleet evidence paths remain relative to `~/karan-agent-workspace`, not this repository:

- `data/plan-astra/report.md` and `data/plan-astra/shots/`: route, journey, social and performance evidence.
- `data/astra-delta-plan/report.md`: verification of Astra findings F01 to F12 and the original change map.
- `data/audits/2026-09-06-astra-delta-audit.md`: the underlying delta audit.
- `data/review-*`: the three reviews of 5 September; [Astra.md](../../Astra.md) records their context.

The fleet evidence is referenced, not copied or asserted to exist in Git.
Historical screenshots and measurements do not describe every current route.

The reconciliation source baseline is `6a759e0ac191d99f10c5e658bc8f2c3a6d3dd419`.
Production `/api/version` verified this commit and deployment `dpl_88fiZ7i4Cgdfrmu5u1wjnRYCnzYq`, built at `2026-09-07T21:27:03.621Z`.
The feature stack through #1632 is deployed. Deployment alone does not prove acceptance.
The main audit owner is preparing the final browser run after #1631 and #1632 integration.
This document does not claim that run passed.

Sections 2 and 6 retain historical findings and proposed targets.
Sections 7 and 8 retain the feature inventory, with acceptance criteria completed from existing specifications.
A criterion is a future check, not a result. A proposed feature is not accepted scope.
Historical file references can name planned files or older source locations.

## 1. Decisions and current contracts

### 1.1 Settled constraints

| Subject | Contract and evidence | Effect on this plan |
|---|---|---|
| D1 landing | [#1628](https://github.com/Singularityszn/pubmax/pull/1628) implements an answer-first landing and `/near?locate=1`, with a London fallback. | The question-first `/` proposal is superseded. D4 remains separate. |
| D3 landing images | The captain requested London pictures on 6 September. [#1588](https://github.com/Singularityszn/pubmax/pull/1588) and #1628 provide subsequent work. | Keep source credits and honest imagery. Per-pub Google licensing remains D3b. |
| New prices | [pintDropReceipt.ts](../../lib/pintDropReceipt.ts), [#1630](https://github.com/Singularityszn/pubmax/pull/1630): every new priced write requires a bill photo. | A pint or pub photo remains optional. A note without a price requires no bill. |
| Price evidence | [pintDropAgreement.ts](../../lib/pintDropAgreement.ts), [pintDropConfirmation.ts](../../lib/pintDropConfirmation.ts), [pintDropSecondDrinker.ts](../../lib/pintDropSecondDrinker.ts). | Confirmation requires independent verified authority, agreement on the exact price and drink, and the valid measure/window. Self-rechecks and anonymous observations cannot supply independence. |
| Founding Member numbers | [CONTEXT.md](../../CONTEXT.md) and [foundingMembers.ts](../../lib/foundingMembers.ts). | Numbers are never recycled. Removing test accounts leaves gaps. Reclaiming 9, 11 or 12 is not an option. |
| Identity and age | [CONTEXT.md](../../CONTEXT.md), [contributionIdentity.server.ts](../../lib/contributionIdentity.server.ts), [socialLaunch.ts](../../lib/socialLaunch.ts). | Preserve each route's existing authority and adult rules. A plan document cannot waive them. |
| Measurement | #1576 explicitly adopts weekly groups that complete and repeat. The draft defines the 28-day window. [METRICS.md](../analytics/METRICS.md) documents the available proxy. | The group outcome is accepted. Its aggregate implementation and evidence remain missing; the weekly device proxy does not replace it. See 8.9. |
| London first | [#1576](https://github.com/Singularityszn/pubmax/issues/1576) excludes new-city implementation. | Existing four-city supply belongs to #1522. Its reference below does not widen this plan. |
| D10 Pint Index | The captain kept the hold on 10 September 2026. `pintIndexMeetsAdmissionFloor` in [pintIndexArchive.ts](../../lib/pintIndexArchive.ts) is the rule, and [lib/AGENTS.md](../../lib/AGENTS.md) records it. | Main's bounded interpretation admits any single UTC month represented in the validated snapshot. One borough must reach the monthly target through unique pubs. Counts never pool across months; no freshness condition applies. The hold covers the sitemap row and the hub's `robots` index directive alone; the route, its links and the dated editions stay. |

The bill requirement does not prove production receipt persistence.
The parent verified migration [0153](../../supabase/migrations/20260907120000_0153_pint_drop_receipt_photo.sql) through read-only production inspection.
The applied ledger entry is `20260907215709`; all three photo columns are present as nullable `text`.
This records schema availability, not a successful end-to-end receipt write and later read.
Durable end-to-end receipt proof remains pending. The availability-exception owner question remains pending too.
A bill is evidence about a price, not a public wall photo or an independent reporter.

### 1.2 Remaining decisions for the interview owner

These are unresolved choices, not requests to repeat the interview here.
Recommendations from the original draft remain proposals.

| ID | Decision still needed | Existing recommendation or boundary |
|---|---|---|
| D2 | Choose the v1 social families and list each surface to keep, hide or retire. Set permitted public visibility for the proposed social lane and invite cards. | The draft recommends public activity, Pint Drops, follows, DMs, Plans and open Crews. No retirement or store deletion is accepted. |
| D3b | Approve permitted per-pub image sources, including Google Places licensing, attribution and caching terms. | Prefer community and authorised first-party images. London landing imagery does not grant per-pub source rights. |
| D4 | Choose progressive city/area/constraints/companion/Plan onboarding or the existing tap-through. | Preserve the accepted answer-first landing. Decide where a progressive flow starts and which actions resume after sign-in. |
| D5 | Choose push, email or shares for return visits; approve cadence, timezone and opt-in timing. | Original proposal: Friday 17:00 digest, email fallback, plus a weekly price recheck. Resolve their combined frequency before scheduling. |
| D6 | Set the acceptable firewall posture and shared-Wi-Fi rate limits. | Proposed document-only challenges need dashboard inspection. Numeric account/IP limits are not accepted by this draft. |
| D8 | Keep Rounds separate, fold it into a Planned Night spend diary, or retire its surface. | Original preference: fold it. Never introduce debt settlement or remove stored history implicitly. |
| D9 | Select the canonical city picker and redirect policy. | Original preference: `/places`, with `/choose-city` redirecting there. No redirect approval is inferred. |
| P1 | Define the native contact-matching privacy contract before accepting that feature. | Hashing contact data alone is not permission. Decide consent, matching visibility, retention and deletion. |
| P2 | Define the unspecified `/r/<code>` face proposal, or remove it from scope. | Name the destination, consent and public fields. No acceptance behaviour can be inferred from a title alone. |
| P3 | Set any Product Hunt or press campaign scope, launch date, approved copy and destination. | This remains outside the tree; a plan is not permission to publish or contact anyone. |

M1 is an implementation and evidence gap, not a request to reselect the north star.
The 6 September 17:15 comment on #1576 already adopted the group outcome and its store-side roll-up.
Reconcile the canonical metrics documentation, implement the approved aggregate against real schema, and prove qualifying and excluded cohorts.
A decision to replace that goal would need explicit approval; replacing it is not required for routine closeout.
The supplemental median interval still needs a stated calculation rule before it can be reported.

D7 is engineering work: remove avoidable whole-city payloads through the existing venue boundary.
The draft prefers per-venue reads over compressed whole-city reads.
It needs measured regression evidence, not a new product interview or a raised performance ceiling.

Store enrollment is a separate owner dependency under [#1358](https://github.com/Singularityszn/pubmax/issues/1358).
[#390](https://github.com/Singularityszn/pubmax/issues/390) was consolidated there as a duplicate, not completed enrollment.
The parent already requested verified Apple/Google enrollment, account names and credential-storage locations, without secrets.
That answer remains pending. This plan neither repeats the request nor marks enrollment complete.

### 1.3 Delivery evidence, without blanket clearance

| Work | Current evidence | Remaining proof or limit |
|---|---|---|
| Landing | #1628: answer-first `/near?locate=1` door, London illustration and fallback. | Keep existing performance ceilings; progressive onboarding remains D4. |
| Historic defect fixes | #1591: price display, stamp, leaderboard and streak work. #1594: sheet, consent and Plan chrome. #1587: transport copy, quiet intent and Plan metadata. #1590: venue truth and freshness. | These map to historical rows below. A merge title alone does not close every row or failure path. |
| Attribution and RLS | #1583 supplies release attribution; #1586 supplies RLS tests. | Dashboard leaked-password protection needs separate owner evidence. |
| Receipt and confirmation | #1630 supplies receipt requirements and exact agreement. | Migration 0153 is verified applied. Prove durable end-to-end receipt recovery; the availability-exception owner question remains pending. Keep independent-account refusals. |
| Native first run | [#1632](https://github.com/Singularityszn/pubmax/pull/1632), [mobile proof](../proof/mobile-app-design/README.md). | First launch measured 3,848 ms; later run 1,888 ms. Android flash and final integrated browser/native behaviour need owner evidence. |
| Map and route polish | [#1631](https://github.com/Singularityszn/pubmax/pull/1631), [walk proof](../proof/walk-bugs-one-liners/README.md). | Do not equate individual fixes with the final integrated browser gate. |

---

## 2. Historical findings, ranked, with the proposed fix

This is the 6 September finding ledger, preserved for traceability. It is not a current open-defect count.
Later decisions in section 1 override conflicting remedies below.
Ranked by what it costs a stranger's first sixty seconds and a share. Each names the module. Evidence is in `data/plan-astra/report.md` (section in brackets).

| # | Wrong | Fix | Files | Size |
|---|---|---|---|---|
| 1 | **The price plaque is the "weird shape":** 6 px radius, bevel, top shine, rotated -1.5 deg, JetBrains Mono 800, right-aligned in a 71 px minimum box, beside 14 px and pill buttons (1.3) | drop `ink-stamp--tilt`, the two inset shadows and `min-inline-size`; radius `--control-radius`; body face 700 with `tabular-nums`; left-align; keep band surface, border and ink | `components/PriceBadge.tsx`, `components/PriceBadge.module.css`, `app/globals.css:508-525, 437-460`; pins `__tests__/priceBandSurfaces.test.ts`, `e2e/price-colour-law.spec.ts` | S |
| 2 | **First pin at 8.5 s cold, 9.4 s with a selected pub; `/map` 11 MB, `/map?sel=` 18 MB** (2.1) | stop fetching `/data/wetherspoons/pubs.json` (2.1 MB), `drink_price_updates/latest.json` (1.9 MB) and `food_price_updates/latest.json` (1.5 MB) on the map; serve per-venue from `/api/venue/[id]`; fetch `maplibre-gl-shared.mjs` once; `/plan` and `/pal/chat` stop pulling the 911 KB `venues_slim.json` (twice on `/plan`) | `components/PubMap.tsx`, `components/map/usePintDrops.ts`, `lib/venueMenuEnrichment.ts`, `components/plan/PlanComposer.tsx`, `lib/mapFirstPinStreams.ts`, `perf/route-budgets.json` | M |
| 3 | **"No photo yet" on six pubs in ten**, and the photograph that does show is credited "pub website" whatever its source (a Google Places photo on the Blackfriar) (1.4) | a photograph for every priced pub from the sources in section 5, in preference order; the credit names the real source; alt text from the pub name; `srcset` at 400 and 800; the placeholder tinted by kind | `lib/venueImages.ts`, `components/media/VenueImage.tsx`, `components/map/inspector/VenueInspectorHeader.tsx`, `lib/venues.ts:462`, `scripts/build_app_dataset.mjs` (the image column) | M |
| 4 | **Social signed out is a sign-in wall with 8 accounts** (1.2, 3.4) | a public "London tonight" lane: recent public Pint Drops with photos, open crews, historic picks; sign-in only on the first write | `app/social/SocialPageClient.tsx`, `lib/socialShell.ts`, `lib/socialFeed.ts` | M |
| 5 | **Tonight stamp "Checked 22 Aug" on the phone** while the API says 6 Sep (1.2) | print the stamp only from the live read's `kindObservedAt`; never from the editorial snapshot's date | `app/tonight/TonightClient.tsx:396`, `lib/tonightOutListings.ts:547`, `lib/picksState.ts:208-227` | S |
| 6 | **Venue sheet head overlaps** ("Near m" under `Plan stop`) when the standing line is long (1.2) | three-column head with `minmax(0,1fr)` on the middle cell, `Near me` in body size, standing line wraps under the plaque | `components/map/inspector/VenueInspectorHeader.tsx`, `components/map/venueSheet.css` | S |
| 7 | **`Lock it in` under the tab bar and FAB on `/plan` at 390; two painted primaries; skip link in flow** (1.2) | pin `Lock it in` as the sticky bar; hide `Make a plan` once a route exists; skip link `sr-only` until focus | `components/plan/PlanComposer.tsx`, `app/plan/plan.css`, `components/nav/createFab.css` | S |
| 8 | **Pub Pal "cheapest pint near Soho" answers the fallback** (1.2) | resolve `near <alias>` through `nightAreas` aliases before the pub name match; add the case to the router tests | `lib/ask/router.ts:80-91`, `lib/ask/conciergeTools.server.ts:226`, `__tests__/askRouter.test.ts` | S |
| 9 | **Map chrome at 768 and 1440: 20 to 24 controls on first load** (1.2) | one toolbar: search, area, drink lane, plan; kind chips behind `Filters`; banners stack one at a time; first-visit card replaces the Pub Pal chip while open | `components/map/MapToolbar.tsx`, `components/map/mapToolbar.css`, `components/map/mapBannerStaging.css` | M |
| 10 | **Tonight CLS 0.20, `/map?sel=` CLS 0.32** (2.1) | reserve the weather line, chip row and first card heights; reserve the sheet's tab row and price row | `app/tonight/tonight.css`, `components/map/venueSheet.css` | S |
| 11 | **Cheap Pint Leaderboard shows seven £1.99 Bud Light rows** (1.2) | the board reads corroborated pint rows only, one row per pub, never a chain promotion price | `lib/contributorLeaderboard.ts`, `app/social/DiscoverBody` | S |
| 12 | **Two consent controls on `/u/you`; the card over the fold at 320 and 360** | one control (the card); the You panel links to it; the card docks under the tab bar on phones | `components/analytics/*Consent*`, `components/profile/PubmaxxAccountHub.tsx`, `e2e/ux-consent-chrome.spec.ts` (sweep four heights) | S |
| 13 | **Three mis-worded absences:** `/plan/[id]` "closed" on a store error, `/near` "not mapped" on a shard failure, the 4.5 MB 413 "Could not save that drop" with a 5 MB client gate (2.4) | `unavailable` state on the plan page with Retry; `/near` reads `status: "unavailable"` and says so; client gate reads `lib/uploadBodyLimit.ts` | `lib/planStore.ts:304-313`, `app/plan/[id]/page.tsx`, `components/nearme/NearMeNow.tsx:371-378`, `components/map/usePintDrops.ts:86,414`, `components/map/VenuePriceSubmit.tsx:370` | S |
| 14 | **Realtime degradation invisible** (2.4) | consume `onStatus`; a thread on the poll shows "Updates every few seconds" under the composer | `components/messages/MessageThread.tsx:434`, `app/messages/MessagesInboxClient.tsx:255` | S |
| 15 | **Vercel challenge on `/api/*` and `/auth/callback`** (2.5) | captain-side firewall rule; then a document-only challenge and a rate that survives a pub's Wi-Fi | Vercel dashboard; `docs/DEPLOYMENT.md` | S |
| 16 | **Fifteen button style families; painted primary that cannot work (`New message` signed out); duplicated doors (`Open the map` twice on `/out`; `Send` at the top of `/pal/chat`)** (1.5) | every button reads the `--control-*` row; a signed-out primary is the sign-in door; one door per screen | `components/ui/button.css`, `app/messages/page.tsx`, `app/out/OutClient.tsx`, `components/pal/PalChat.tsx` | M |
| 17 | **Two city pickers, `/drink/pravha` 404, Lore copy "menu linked from first-party site" with an em dash, `/we-are-out` dark, `/rounds` stub, test handles on the founders wall** | one picker; a drink page for every brand the landing can name; rewrite the Lore line; hide or fold the two routes; test-account disposition preserves permanent founding-number gaps | `app/choose-city`, `lib/pricedLanding.ts`, `lib/venueMenuEnrichment.ts`, `app/we-are-out`, `app/rounds`, `lib/foundingMembers.ts` | S |
| 18 | **Share on Tonight prints "Could not share tonight"** in headless; the sheet Share opens a safety panel | verify on a phone; fall back to copy-link with a "Link copied" line; the sheet's Share is a share sheet, the safety panel is its own control | `app/tonight/TonightClient.tsx`, `components/map/inspector/*Share*`, `lib/nativeShare.ts` | S |
| 19 | **The Pint Drop receipt prints internal vocabulary:** "The Golden Thread", "BASELINE ON RECORD", "ANECDOTE → COMMUNITY TONIGHT", "inflation revalued via UK CPI", with an arrow glyph, on the Stories tab after `Log it` (report 5, `signed-11-after-logit-390.png`) | one receipt line ("Logged. A second drinker makes it confirmed.") and the drop row; the then-and-now block becomes the existing `VenuePriceThen` line | `components/map/inspector/VenueStoryTab.tsx`, `components/map/PintDropComposer.tsx` | S |
| 20 | **The Pint Drop lane asks no age question** while the price-submit lane does: a fresh account with no date of birth and no adult tap posted a priced drop through `POST /api/pint-drops` (report 5) | one rule at both doors, or a written decision that the Pint Drop lane is exempt; `contributionAdultRefusal` already exists | `app/api/pint-drops/route.ts`, `lib/contributionIdentity.server.ts`, `__tests__/contributionAgeAnswer.test.ts` | S |
| 21 | **Social signed in with a claimed handle prints "Checking Social access…" and `Claim a handle to invite`** with the `Post` primary disabled (report 5, `signed-80-social-signedin-390.png`), observed while the session route was answering 429 | the access probe re-asks after a failed read and the invite door reads the live handle | `lib/socialAccess.ts`, `app/social/SocialPageClient.tsx`, `components/social/FindYourLot.tsx` | S |
| 22 | **The WhatsApp share text carries a relative plan link** (`/plan/<id>#invite=<token>`, no host), so the one share a plan is built around does not linkify in WhatsApp (report 5.1) | build the share text from `NEXT_PUBLIC_SITE_URL` and the invite path; a test asserts the text contains `https://pubmaxxing.com/` | `components/plan/PlanInviteNextStep.tsx`, `lib/planInvite*.ts` | S |
| 23 | **`Copy invite link` on the locked plan is obscured by the floating `+`** at 390 (report 5.1) | the plan page hides the create FAB (`pageHidesCreateFab`, as the thread page does) | `app/plan/[id]/page.tsx`, `components/nav/CreateFab.tsx` | S |
| 24 | **A locked plan outlives its deleted host** and nothing removes it (report 5.2) | the tombstone closes the host's open plans and the preview says the plan has closed | `supabase/migrations` (tombstone trigger), `lib/accountDeletion.server.ts` | S |
| 25 | **The You card prints "1-day mapping streak"** while the product's own law refuses streaks (report 5.1) | drop the streak line; keep the badge | `components/profile/YourContributionsCard.tsx` | S |

Items 26 to 33 are Astra's 6 September findings, verified open on production `1d676d930` and origin/main `5bf044f55` (`data/astra-delta-plan/report.md` section 2). Each names the lane spawned on 6 September that owns it; none is proposed twice.

| # | Wrong | Fix | Files | Size |
|---|---|---|---|---|
| 26 | **The venue API ships the raw dataset row**: `phone_number` holds `"🌐 https://…"`, every amenity is a boolean so a blank cell reads `false`, and `getIn` answers `likely` while `isOpen` is `unknown` and no report exists (Astra F03; measured on `venue-p7p18j`) | a typed contact block (a URL is a `website`, never a phone); amenities answer `true`, `false` or `"unknown"`; `getIn` answers `unknown` until hours or a report say otherwise; the raw price rows leave the wire. Lane `venue-truth-contract` | `lib/venues.ts:447-458`, `lib/venues.ts:69`, `app/api/venue/[id]/route.ts:77`, `lib/busyness.ts:202-238`, `__tests__/venueRoute.test.ts` | M |
| 27 | **Today's Getting home card says the location "stays on this page"** while `/privacy` says the rounded point is sent to `/api/last-train` and on to TfL; the code does the second (Astra F01) | one sentence that matches the privacy page, read from one module by both | `app/today/TodayGetThereStrip.tsx:67, 139-140`, `app/privacy` | S |
| 28 | **"Quiet pints near you" on Today links to plain `/near`**, which is price-first and reads no quiet intent (Astra F02) | the door carries `?intent=quiet` and `/near` leads with the occupancy `quiet` lane; failing that, the label stops promising quiet. Lane `today-intent-and-plan-metadata` | `lib/picksState.ts:197`, `components/nearme/NearMeNow.tsx`, `lib/occupancy.ts` | S |
| 29 | **Pub of the day headlines a Wikidata description** ("Sun Inn: pub in Barnes, London, UK") because any featured source passes the pick (Astra F08) | a fact must be a sentence (a verb, a date, or a name beyond the pub's own); extend `heritageLanguageGate` and run it in the pick and in the index build. Lane `today-intent-and-plan-metadata` | `lib/todayBrief.ts:365-397`, `lib/heritageLanguageGate.mjs`, `scripts/build_historic_index.mjs`, `public/data/heritage_cache.json` | S |
| 30 | **`/plan` unfurls as the homepage**: `og:url` is `https://pubmaxxing.com`, `og:title` is the site line, no canonical (Astra F09) | `alternates.canonical: "/plan"` and the page's own `openGraph`; a metadata test in the `socialPageMetadata` shape. Lane `today-intent-and-plan-metadata` | `app/plan/page.tsx:8-11`, `app/layout.tsx:183-192` | S |
| 31 | **Product events carry no `$host`, environment or release**, so a preview's `plan_created` and production's are one bucket (Astra F06, E13) | `$host`, `environment` (one of `production`, `preview`, `development`) and `release` (the build SHA from `lib/buildInfo.mjs`) on every server capture; registered in the event contract; no new event, no new identity. Lane `analytics-env-attribution` | `lib/posthogServer.ts:36-57`, `lib/analyticsEvents.ts`, `docs/analytics/TRACKING_PLAN.md` | S |
| 32 | **Desktop p75 LCP 3,686 ms and CLS 0.115 in the field** (`/pal` 5,904 ms, `/map` 3,686 ms, `/` 3,344 ms; PostHog, week to 6 Sep, 27 samples), and the recorded baseline holds no desktop row at all (Astra F05) | record `/`, `/map`, `/pal` desktop rows under `npm run perf:cwv-record`; `/pal`'s hero photograph gets explicit dimensions, `fetchpriority="high"` and a 1440 rendition; the landing photographs (D3) ship with reserved boxes so they add no CLS | `perf/cwv-baseline.json`, `e2e/cwv-baseline.spec.ts`, `app/pal/page.tsx`, `components/pal/PalPortrait.tsx` | M |
| 33 | **The freshness registry prose for `price_updates` names July** while the file's `generatedAt` is 4 September with zero rows, the exact shape the sentence forbids (Astra F12); and 40 RLS-enabled tables have no policy and no behavioural test that a browser role reads nothing (Astra F07, Supabase advisors 6 Sep 16:00 UTC) | the prose reads the stamp and names the rule (an empty `updates` list is no reviewed rows, not a fresh publish), held by `dataFreshness.test.ts` (lane `venue-truth-contract`); the permission matrix walks the 40 tables for anon and authenticated reads and writes (lane `authz-matrix-tests`); the captain flips leaked-password protection in the Supabase dashboard (section 8.8) | `data/freshness_registry.json`, `__tests__/dataFreshness.test.ts`, `__tests__/permissionMatrixEffective.test.ts`, `docs/security/PERMISSION_MATRIX.md` | M |

Two of Astra's twelve are not rows here: F10 (the social loop, mobile layout and buttons) is what this plan's own review measured with screenshots, and its fixes are items 6, 7, 12 and 19 to 25; F11 (one deployment id read as two SHAs) resolved against Astra's early read, since `c9dc9f2` is in no commit and no Vercel record and the "corrected" venue fields exist on no deployment (report section 2, F11). F04 (the enrichment 502) is real, the code path is the designed outage answer from #1500, and what it lacks is proof over successive nights; that is the `enrichment-retry-proof` lane and section 8.8.

---

## 3. Arrival and the first sixty seconds

The accepted public landing gives an answer before asking for a contribution.
Its primary opens `/near?locate=1`; a refused location request keeps the London fallback usable.
The old question-first home screen is superseded by #1628.

The following progressive sequence remains a D4 proposal, not a replacement already approved for `/`.
The original 0-5, 5-15, 15-30, 30-45 and 45-60 second bands are design targets, not measured results.

| Beat | Proposed behaviour after the accepted landing | Acceptance |
|---|---|---|
| Area and constraints | Collect city, area, constraints and companions only within the accepted D4 flow. | A skipped or refused location step leaves manual choice usable. A failed area read offers retry. |
| Answer | Show grounded nearby choices with price, source and age. | Empty coverage and failed reads have different states. No invented price, walking time or location claim. |
| Map | Open the selected pub with price standing, available photograph and Plan action. | The selected pin and sheet agree. Consent and map controls do not obscure the primary. |
| Kept action | Preserve the selected stop, Wanted or contribution through any required sign-in. | The server authorises writes. Cancellation preserves browsing; retries do not duplicate the saved outcome. |
| Return | Resume the permitted held action after login and any required identity step. | An existing handle does not receive another claim form. Failed identity reads remain unresolved. |

Use the existing `/login` return path and `AccountOnboarding` contract.
Do not replace the current identity fields with the old draft's handle-only, optional-birth-date proposal.
Anonymous contribution availability and independent confirmation are separate policies.
A new priced submission still requires a bill, including a held submission after sign-in.

Native entry has its own first-run route and return-intent rules.
Verify a fresh shell launch, returning launch and deep link separately after integration.
The final audit owner holds that proof; this document does not authorise another heavy suite.

Acceptance targets: 320, 360, 390 and 430 pixel widths, answer visible, usable primary, and no covering consent panel.
Extend existing arrival tests where suitable. The original `first-sixty-seconds` test name is a proposal, not an existing proof.

---

## 4. Journeys end to end

Each step names the surface, the state the reader sees, and the failure copy. Surfaces are today's routes unless marked (new).

### 4.1 Reader (signed out, wants a cheap pint tonight)

| Step | Surface | State | Failure copy |
|---|---|---|---|
| 1 | `/` | answer-first landing and `Cheapest pint near me` | `We could not load the areas. Try again.` |
| 2 | `/near?locate=1` | nearby answers with bands and publisher; London fallback when location is refused | `No priced pubs in {area} yet.` + `Change area` |
| 3 | `/map?sel=` | sheet open, photo, price, standing, walk time if located | `We could not read this pub's logged prices.` (exists) |
| 4 | sheet Train tab | last train from the nearest station | `Can't check TfL right now` (exists) |
| 5 | share | OS share sheet in the shell, copy-link on the web with `Link copied` | `Could not copy the link. Long-press the address bar.` |
| 6 | `/tonight` | listings or the quiet-night sentence with a correct stamp | `We could not reach tonight's listings just now.` + Retry (exists) |

### 4.2 Contributor (signed in, logs and confirms)

| Step | Surface | State | Failure copy |
|---|---|---|---|
| 1 | sheet Overview, `Still £4.50?` or `Log a price` | composer seeded, measure asked | `You've already logged a price here today.` (exists) |
| 2 | composer: bill, optional pint photo, price, measure, drink | bill required for a new price; separate optional pint photo with explicit wall choice | the size refusal from `lib/uploadBodyLimit.ts`; do not duplicate a fixed cap |
| 3 | the age tap | one line, one button, resumes the held action | `We could not record that. Try again.` |
| 4 | receipt | `Logged. A second drinker makes it confirmed.` and the row on the sheet | `Pint Drop storage is unavailable.` with in-card retry (exists) |
| 5 | second drinker's door on the pin (new) | `Still £4.50?` on the map pin's peek, not only the sheet | as step 1 |
| 6 | confirmation | `Confirmed by two drinkers` on the sheet and the pin ring | same-reporter, disagreement and expired-evidence refusals from the current confirmation policy |
| 7 | weekly ask (new) | D5 proposal: recheck the exact drink and price; a same-author reply never confirms itself | none; a missed push is silent |

### 4.3 Planner (signed out to signed in, plans a night)

| Step | Surface | State | Failure copy |
|---|---|---|---|
| 1 | `/plan` describe-first | one field, chips, stop count 1 to 6 | `The concierge could not sort this one.` (exists) |
| 2 | route preview | three stops as cards (name, price, walk), `Swap`, `Remove` inline | `That route could not be verified. Give it another go.` (exists) |
| 3 | `Lock it in` (sticky, above the tab bar) | sign-in ask inline if signed out | `Could not create the Plan.` (exists) |
| 4 | `/plan/[id]` | the card: stops, times, `Send on WhatsApp`, `Copy invite link` | `unavailable` state with Retry (new; today says "closed") |
| 5 | plan chat (new) | the DM thread attached to the plan | `This conversation won't open right now.` (exists) |
| 6 | night mode | `NightModeCard` with the next stop and the last train | exists |
| 7 | recap | the recap card, share-first | exists |

### 4.4 Crew member (receives an invite)

| Step | Surface | State | Failure copy |
|---|---|---|---|
| 1 | `/invite/[token]` | preview: host handle, stops, time, `I'm in` | `This invite has expired. Ask {host} for a fresh link.` (exists as not-found) |
| 2 | `I'm in` | the existing invite route determines permitted guest access and any required sign-in | `That seat could not be taken. Try again.` |
| 3 | `/plan/[id]` as a member | route, crew, RSVP, reactions, proposals | exists |
| 4 | plan chat (new) | same thread | as above |
| 5 | `Out tonight` on You and the map (new placement) | area-level presence to the lot | `Could not mark you out. Try again.` |

### 4.5 Host (runs the night)

| Step | Surface | State | Failure copy |
|---|---|---|---|
| 1 | lock the plan | as 4.3 | the create failure from 4.3; preserve the held route |
| 2 | invite | WhatsApp first, copy second, rotate on the page | `Could not rotate the link. The old one still works.` (F-31 fixed) |
| 3 | open the plan to strangers (new: an open crew is a plan with `visibility: open`) | the plan appears on Out and on the map for tonight | `Could not open this plan. Try again.` |
| 4 | accept join requests | crew panel | exists |
| 5 | edit route | the editor opens on the stored route (exists) | 409 handled (exists) |
| 6 | night mode, recap, share | existing flows | preserve the saved ending if sharing fails; offer the existing retry |

---

## 5. Images

London landing imagery is accepted. Per-pub Google licensing remains D3b.
The original inventory counted 405 usable photos across 1,617 pubs, including 403 Google-hosted rows.
Other source counts were 245 Mitchells & Butlers, 160 Wetherspoon, 21 WhatPub and 23 Flickr assets.
These are historical source counts, not disjoint coverage totals or proof of permission.

Proposed preference: community, authorised first-party chain, approved Google Places, then licensed Wikimedia images for relevant places.
A source URL alone does not establish reuse rights. Record attribution and per-image permissions where required.
Never use stock or generated pictures as evidence of a real pub.

Reuse `lib/venueImages.ts` and existing media components for sheet, list, Plan, share and landing images.
The preferred source order needs a focused implementation review; this plan does not claim it already runs everywhere.
Retain source credits, meaningful alt text and explicit image dimensions.
Below-fold images load lazily; responsive variants use widths supported by the existing image pipeline.
The original 96/400/800 width proposal is not a claim about accepted proxy parameters.
Use the shared upload limit, not a second hard-coded 4 MB rule.

A required bill photo stays distinct from an optional pint/pub photo.
Never treat uploading the bill as consent to publish it on a wall.
Cross-post only the optional photograph through the existing consent and moderation path.
Retain advisory scanning and moderator actions from `lib/uploadedImageScan.server.ts`.
A report enters the moderation process; do not claim every report automatically removes the image.

When no permitted image exists, show an honest placeholder and the existing add-photo door.
A failed source falls through without claiming another source supplied its image.
Profile media retains five covers, one avatar and the existing cropper.

Acceptance: correct source/credit, permitted rendition, reserved dimensions, honest missing-image state, and consented optional-photo cross-posting.
Verify these on each affected surface. A representative photo does not prove full catalogue coverage.

---

## 6. Historical performance evidence and proposed targets

These measurements describe production `1d676d930` on 6 September. They do not describe the deployed baseline in section 1.
Targets are original proposals, not permission to replace or raise the existing budget.
Current verification rules live in [PERFORMANCE_BUDGETS.md](../PERFORMANCE_BUDGETS.md) and `perf/route-budgets.json`.

**Original targets (Slow 4G, 4x CPU, 390x844, production, cold):**

| Route | Historical LCP | Target | Historical CLS | Target | Historical first pin | Target | Historical decoded KB | Target |
|---|---|---|---|---|---|---|---|---|
| `/` | 1,500 | 1,500 | 0.004 | 0.01 | | | 1,546 | 1,000 |
| `/tonight` | 3,812 | 2,000 | 0.205 | 0.05 | | | 1,832 | 1,200 |
| `/map` | 4,864 | 3,000 | 0.002 | 0.01 | 8,550 | 5,000 | 11,075 | 4,000 |
| `/map?sel=` | 6,328 | 3,500 | 0.316 | 0.05 | 9,418 | 5,500 | 18,216 | 4,500 |
| `/messages` | 3,916 | 2,000 | 0.002 | 0.01 | | | 1,503 | 1,000 |
| every other route | 1,200 to 1,450 | hold | 0 to 0.03 | hold | | | 1,500 to 1,800 | 1,000 |

**Desktop, from the field (PostHog `$web_vitals`, consented readers, week to 6 September, Astra F05):** p75 LCP 3,686 ms over 27 samples, CLS 0.1155; by route `/pal` 5,904 ms (5), `/map` 3,686 ms (11), `/` 3,344 ms (4), `/u/[handle]` 1,312 ms (3). Target: LCP 2,500 ms and CLS 0.05 on every desktop route. At the historical audit, the recorded baseline (`perf/cwv-baseline.json`) held no desktop row, so the first piece of work is the measurement itself (section 2, item 32); at that time the field figure was the only desktop figure recorded here, and it cannot be attributed to a release (item 31).

**Original engineering work, ordered by payload reduction. Recheck against current source before assigning a new lane.**
1. Take the three whole-city bundles off the map and the sheet (section 2, item 2): saves 5.4 MB on `/map` and 12 MB on `/map?sel=`.
2. Fetch `maplibre-gl-shared.mjs` once (three fetches of 478 KB today).
3. `/plan` and `/pal/chat`: stop pulling `venues_slim.json` (911 KB, twice on `/plan`); use the shard the composer needs.
4. Split the 1.1 MB shell: `/login` and `/messages` do not need the landing, the plan composer or the map's lens vocabulary. Target 600 KB of JS on a text route.
5. Reserve heights on Tonight and the sheet (CLS).
6. `/tonight`: the editorial snapshot (128 KB) after paint, and the stamp from the live read.
7. Run `npm run perf:cwv-sweep` on the merge bar for any change under `components/map`, and record the Slow 4G production table above in `perf/cwv-baseline.json` beside the local one.

**Reliability acceptance backlog. Numeric limit changes remain D6 proposals.**
1. The three mis-worded absences (section 2, item 13).
2. Realtime status line (item 14).
3. The Vercel challenge rule (item 15) and a written note of the threshold in `docs/DEPLOYMENT.md`.
4. Confirm participant access after the `profiles.user_id` backfill. Astra reports migration 0152 applied; its old in-flight label is stale.
5. Per-IP limits that a pub's shared Wi-Fi can survive: `/api/ask` 10 per minute per IP becomes 10 per minute per account with a 60 per minute IP ceiling; the same shape for `/api/out` and `/api/whats-on`.
6. `check:freshness` on the merge bar with the store-backed weather row (thermo P1-5 done; keep it green).
7. Offline: precache the reader's chosen area's shard on first pins so a pub with no signal still has its pins.

---

## 7. Social feature inventory and acceptance criteria

Grouped by loop: each feature has one primary entry. References in section 8 do not create duplicate work.
All unshipped scope remains proposed and subject to section 1. Existing routes retain their authority and privacy rules. Each row: spec, acceptance, effort (S under a day, M a few days, L a week or more), risk, dependencies. **Bold** rows retain the original priorities for participation and return visits.

### 7.1 Arrive (a stranger becomes someone with a handle and a lot)

| Feature | Spec | Acceptance | Effort | Risk | Depends on |
|---|---|---|---|---|---|
| **London tonight lane, public** | `/social` opens signed out on a readable lane: the newest public Pint Drops with photos, open crews for tonight, who is out by area (counts, no names), three historic picks. Sign-in only on the first write. Files: `app/social/SocialPageClient.tsx`, `lib/socialFeed.ts`, `lib/socialShell.ts`. | Blocked on D2. a stranger at 390 sees at least one card with a photograph in the first screen; no sign-in wall; `e2e/social-open.spec.ts` extended | M | public visibility and moderation; preserve the current gate until D2 changes it | D2 and item 3 (photos) |
| Handle claim inside the first kept action | the claim card appears after `Plan stop`, `Still £X?` or `Save for tonight`, never before. Files: `components/identity/AccountOnboarding.tsx`, `lib/accountClaimReturnTo.ts`. | Blocked on D4. the held action resumes after the claim in `e2e/arrival-journey.spec.ts` | S | none | section 3 |
| Find your lot by contacts (native) | on the shell, match phone contacts by hashed email to handles; web keeps handle search. Files: `components/social/FindYourLot.tsx`, `lib/nativePlatform.ts`, new `lib/contactMatch.server.ts`. | After P1 approval, only consented matching data follows the approved contract. A permitted match shows Follow; refusal leaves handle search usable. | M | contact privacy | P1 and native distribution |
| One starter pack per area | packs are built from `homeCity` matches (exists); add one per London patch once the existing `starterPacks` member floor is met. Files: `lib/starterPacks.ts`. | A pack meets `STARTER_PACK_MEMBER_FLOOR` using eligible real accounts; no inferred borough membership. | S | none | accounts |
| Profile as a card worth sharing | `/u/[handle]` OG card with the face, the cover, the number of pints logged and the home patch. Files: `app/u/[handle]/opengraph-image.tsx` (new), `lib/ogBrand.tsx`. | the unfurl shows the face and the patch | S | none | none |
| Invite link with a face | `/add/[handle]` shows the inviter's face and one line, then `Follow back`. Show the existing public profile face. A last-pub disclosure needs D2 approval and an existing public source; do not expose private presence. | The public inviter face matches the handle. A failed profile read exposes no cached account or private last-pub data. | S | none | none |
| Retire: creator lists, referral marks on the card, starter packs beyond one, `/founders` test handles | hide the nav entries; keep the stores | After D2 approval, each named retired route uses its approved redirect; history remains stored. Test-account removal never recycles numbers. | S | retention and redirects | D2 |

### 7.2 Contribute (a person adds what they saw)

| Feature | Spec | Acceptance | Effort | Risk | Depends on |
|---|---|---|---|---|---|
| **Bill-first priced Pint Drop** | the composer requests the bill for a new price, then offers an optional pint/pub photo. Keep price, measure and drink explicit. Never cross-post a bill to the wall. Files: `components/map/PintDropComposer.tsx`, `components/map/composer/*`, `lib/venuePhotoCrosspost.server.ts`. | A priced write without a bill is refused; a bill without a second photo succeeds. Only a separately consented pub/pint photo enters the wall. Verify durable receipt recovery. | M | moderation and shared upload limit | none |
| "I'm here" on the sheet and the pin | the presence toggle that lives on You moves to the sheet head (`Out here tonight`) and paints a small mark on the pin for the lot. Files: `components/map/inspector/VenueInspectorHeader.tsx`, `lib/presenceStore.ts`, `components/map/canvas/geojson.ts`. | the lot sees the mark; strangers see a count per area, never a name | S | privacy; area-level only | none |
| Visit Report in one tap | `Quiet / Steady / Rammed` and `Seats / No seats` as chips on the sheet, the written report folded. Files: `components/visits/VisitReportPanel.tsx`, `lib/occupancy.ts`. | a report lands in two taps | S | none | none |
| Photo wall on the map peek | the peek shows the newest wall photo. Files: `components/mobile/MobileSharedSheet.tsx`, `lib/pubMap.ts`. | The newest eligible public wall photo appears; empty or unavailable walls keep the peek usable. | S | none | photos |
| Moment with a place | `/moment` gets the venue picker first (`Venue reference` exists as optional); a Moment at a pub is offered to the wall. Files: `components/moment/MomentCapture.tsx`. | The selected venue remains attached after save. Wall publication follows the separate consent choice. | S | consent copy | none |
| Drink of the night (retire the demo menu) | `Add what you're drinking` becomes one chip row under the price, not a second primary. Files: `components/map/VenueDrinkPrices.tsx`, `components/map/inspector/VenueDrinksTab.tsx`. | one painted primary on the Drinks tab | S | none | none |

### 7.3 Corroborate (an independent account confirms the same observation)

| Feature | Spec | Acceptance | Effort | Risk | Depends on |
|---|---|---|---|---|---|
| **Second-drinker door on the pin** | the `Still £4.50?` door rides the pin's peek and the near list row, not only the Overview. Files: `lib/pubMap.ts` (`peekPriceChip`), `components/nearme/NearMeNow.tsx`, `lib/pintDropSecondDrinker.ts`. | a logged-once pub shows the door in the list and the peek | S | none | none |
| Weekly "still £X?" ask | for every pub a reader logged, one push or email a week later with `Yes` / `It's changed`. Files: `lib/stepOutNudgeSelect.server.ts` idiom, new `lib/priceRecheckPing.server.ts`, cron. | one message per pub per week within D5 consent limits; a reply confirms only through independent authority and exact agreement. A changed price follows the bill requirement | S | push opt-in | D5 |
| Confirmed mark on the wall photo | a wall photo on a confirmed pub carries the ring. Files: `components/venue/VenuePhotoWall.tsx`. | The mark reads the venue's live confirmation. Expired, disputed or unconfirmed prices do not receive it. | S | none | photos |
| Contributor record with content | the board shows the top ten by confirmed pints, with faces, and the reader's own row. Files: `lib/contributorLeaderboard.ts`, `app/contributors/page.tsx`. | the board is never empty when one confirmed drop exists | S | none | none |
| Report and hide, one tap | every drop, photo, comment and post carries `Report` in its overflow; the moderator queue is `/admin`. Exists; make the overflow consistent. | Each listed surface exposes the existing report action. Moderator removal obeys existing access rules and reaches its public reader. | S | none | none |
| Retire: Pint Drop reactions and cheers as separate stores | fold into one `cheer` on a drop | After D2 approval, the chosen cheer action preserves ownership and existing records; no silent deletion or duplicate counts. | S | migration | D2 |

### 7.4 Plan together (a night with other people)

| Feature | Spec | Acceptance | Effort | Risk | Depends on |
|---|---|---|---|---|---|
| **Plan chat** | the DM thread attached to a plan: every member, the plan card pinned at the top, the route changes announced as system lines. Files: `lib/messagesStore.ts` (conversation kind `plan`), `app/plan/[id]/page.tsx`, `components/messages/MessageThread.tsx`, migration for `conversations.plan_id`. | a message in the plan reaches every member on the private channel | M | verify realtime policy for the proposed topic; do not assume 0148 covers it | D2 and verified participant binding |
| **Open crews on the map** | an open plan for tonight paints a pin badge and a card in the peek: host face, time, stops, `Ask to join`. Files: `lib/openSocialCrew.server.ts`, `components/map/canvas/geojson.ts`, `components/out/OutOpenPlanCard.tsx`. | an eligible signed-in stranger can request; the host accepts; 18+ and block/report rules hold | M | safety; the adult gate | none |
| The plan as a card | `/plan/[id]` reads as one card: cover (the first stop's photo), stops, times, crew faces, three actions. Files: `components/plan/PlanSummary.tsx`, `app/plan/plan.css`. | the card fits one phone screen before the route | M | none | photos |
| Round as the plan's spend diary | fold Rounds into the plan: `Who's buying` on the plan, the diary rows, never debt. Files: `lib/rounds.ts`, `components/plan/PlanSummary.tsx`, retire `/rounds`. | After D8 approval, stored diary entries remain reachable from their Plan. No debt or settlement balance appears. | M | migration | D8 |
| Vote on the next stop | the proposals and votes that exist surface as one `Where next?` control in night mode. Files: `components/night/NightModeCard.tsx`, `lib/planCollaborationStore.ts`. | Eligible Plan members can propose and vote through the existing collaboration rules; non-members cannot write. | S | none | none |
| Wanted into a plan | `WantedPlanChips` exists; add `Plan around it` on the Wanted row. Files: `components/wanted/WantedList.tsx`. | The selected Wanted becomes a grounded proposed stop. Failed resolution preserves the Wanted and offers correction. | S | none | none |
| Getting home for the crew | the last train per member's home station, from the plan's last stop. Files: `lib/lastRideRoute.ts`, `components/plan/*`. | Each consenting member can read their own last-train result. A private home station stays private; failed TfL reads say unavailable. | M | TfL | home station on the profile (new private field) |

### 7.5 Keep coming back (the second Friday)

| Feature | Spec | Acceptance | Effort | Risk | Depends on |
|---|---|---|---|---|---|
| **Friday 17:00 digest** | one push (or email) per week, opt-in at the first kept action: the cheapest pint near the reader's patch, who of the lot is out, one open crew tonight. Files: `lib/stepOutNudge*.ts`, `lib/cheapPintPing*.ts` folded into one `lib/fridayDigest.server.ts`, cron. | Blocked on D5. one message per week; nothing when the reader has no patch | M | push consent; email needs a sender | D5 |
| Activity that is activity | the bell shows follows, cheers, plan invites, confirmations of your drops, replies. Files: `lib/notificationsStore.ts`, `app/activity`. | a confirmation of your drop is a notification | S | none | none |
| Recap card, share-first | after every locked plan ends, the recap card is the first thing the host sees, with `Share` painted. Files: `components/plan/RecapShareButton.tsx`, `app/recap/[storyId]` (linked from the plan). | `/recap/[storyId]` is reachable from the plan | S | consent flow exists | none |
| Year in pints (free forever) | the wrap: pints logged, cheapest, dearest, patches, the lot. Files: new `app/u/[handle]/year`, `lib/pintPassport.ts`. | The wrap derives each figure from stored evidence and remains free. Empty history produces no invented totals. | M | none | drops |
| Passport stamps | the Pint Passport exists; a stamp per borough with one confirmed pint, shown on the profile. Files: `components/profile/PintPassport.tsx`. | A borough stamp requires a qualifying confirmed pint under the existing Passport policy; a lone observation does not qualify. | S | none | none |
| DM typing and read state | typing indicator on the private channel; Seen exists. Files: `lib/messagesRealtime.ts`. | Only conversation members receive typing/read state. Disconnection does not imply a message was read. | S | none | 0148 |
| Group DM | a conversation with up to eight handles; the plan chat is the first use. Files: `lib/messagesStore.ts`, migration. | Up to eight permitted handles can participate under the approved membership policy; outsiders cannot read or write. | M | policy | plan chat |
| Retire: `/we-are-out` as a page, night signals as a family, the legacy feed and discover clients | 308 and delete the compiled shells | After D2 approval, named routes have approved destinations and removed navigation. Preserve history and the durable night-signal review pipeline from #1527. | S | none | D2 |

**Original prioritisation:** the highlighted proposals focus on a second person and a return visit. A public lane a stranger can read (someone else's photo, someone else's price), a priced drop with an optional public pint photograph, the second-drinker door where the reader already is, plan chat and open crews on the map (a second person in the plan), and the Friday digest (a reason to return that names the lot). This ordering is a recommendation, not approval of every highlighted feature.

---

## 8. Other proposed work and cross-references

### 8.1 Map

| Feature | Spec | Acceptance | Effort | Risk | Depends on |
|---|---|---|---|---|---|
| One toolbar | search, area, drink lane, plan; kind chips behind Filters; banners one at a time. Files: `components/map/MapToolbar.tsx`, `mapToolbar.css`, `mapBannerStaging.css`. | 8 controls or fewer on first load at 768 and 1440 | M | none | none |
| Per-venue bundles | section 2 item 2 | 4 MB decoded on `/map` | M | none | none |
| Photograph on the pin peek | section 7.2 | Use the acceptance criteria in 7.2; this is the same work item. | S | none | photos |
| Hours on the sheet | OSM `opening_hours` for the priced pubs (the desk pack has them), `Open until 23:00` on the head. Files: `scripts/build_slim_index.mjs` (one field), `lib/venues.ts`, `components/map/inspector/VenueInspectorHeader.tsx`. | a pub with hours prints them | M | data freshness | none |
| Unknown `sel` says so | `/map?sel=venue-doesnotexist` shows one line `That pub is not on the map` with Search. Files: `components/PubMap.tsx`, `lib/mapDocumentTwin.ts`. | An unknown venue selection shows the stated message and working Search, without a false selected pub. | S | none | none |
| Tabs that fit | five tabs on the sheet (Overview, Photos, Drinks, Story, Getting home); Ask becomes the Pub Pal chip. Files: `lib/venueInspectorTabs.ts`. | one row at 390 | S | none | none |
| Desk lane on the map | the `/near` Desk mode as a map lens. Files: `lib/drinkLanes.ts`, `lib/nearDesk.ts`. | The lens uses the existing Desk eligibility and evidence rules; changing it does not relabel unknown amenities as present. | M | none | none |

### 8.2 Pint Index and prices

| Feature | Spec | Acceptance | Effort | Risk | Depends on |
|---|---|---|---|---|---|
| Advertise only with figures (D10, settled) | `pintIndexMeetsAdmissionFloor` in [pintIndexArchive.ts](../../lib/pintIndexArchive.ts) owns the rule and the figure behind it | Delivered. The sitemap row and the hub's `robots` index directive stand down below the floor. No empty or listed-price month is called confirmed. | S | none | none |
| Drink pages for every landing brand | `/drink/pravha` and every brand the answer card can name | no 404 from the landing | S | none | none |
| Price history on every sheet | the then-line exists on 50 pubs; grow the curated file | Every added then-line cites a curated dated source. Missing history remains absent rather than interpolated. | M | curation | none |
| Estimates for four cities | supply, not a switch (AGENTS.md) | Track supply and coverage under #1522. Estimates stay labelled and never gain confirmation from being seeded. | L | evidence | harvest |
| The Cheap Pint Leaderboard reads confirmed rows | section 2 item 11 | Only qualifying confirmed pint rows appear, once per pub; chain promotion rows do not qualify alone. | S | none | none |

### 8.3 Heritage

| Feature | Spec | Acceptance | Effort | Risk | Depends on |
|---|---|---|---|---|---|
| Historic index as a walk | `/historic` becomes ten routes, not a 9,882 px list; borough rows with 0 pubs hidden | If accepted, ten grounded routes replace the long list. Empty boroughs stay hidden; route stops remain valid. | M | none | none |
| Landmark photos on every historic entry | Wikimedia through the existing path | 342 entries with a photo or the placeholder | M | licensing per file | none |
| Lore card copy | rewrite "menu linked from first-party site" and the "Historic pub in London" stub | Displayed facts use plain source-grounded sentences; missing facts do not become generic invented heritage. | S | none | none |

### 8.4 Wanteds

| Feature | Spec | Acceptance | Effort | Risk | Depends on |
|---|---|---|---|---|---|
| Wanted from a share | the shell's share target and a paste field on the map accept a pub name or link | A supported shared or pasted pub reference resolves to the intended Wanted. Unsupported text offers correction and creates no false venue. | M | none | native |
| Wanted on the map | Wanted pubs paint a mark for the owner | The owner sees marks for their saved pubs. Account switching does not expose the previous account's Wanteds. | S | none | none |

### 8.5 Pub Pal

| Feature | Spec | Acceptance | Effort | Risk | Depends on |
|---|---|---|---|---|---|
| Area aliases in the router | section 2 item 8 | `near Soho` answers | S | none | none |
| One send control | remove the top `Send` primary on `/pal/chat` | The existing composer has one usable Send control; pending and failure states retain the entered message. | S | none | none |
| Pal on the sheet | the Ask tab becomes the Pal chip with the pub pre-named | The Pub Pal entry carries the selected pub; switching pubs cannot submit the previous pub as context. | S | none | none |
| Voice when the key exists | Keep the existing configured voice feature; no new provider or capability. | Use the existing configured voice path. Without configuration, the text path remains usable and no successful voice session is claimed. | S: verification only | provider availability | existing configuration |

### 8.6 Native apps

| Feature | Spec | Acceptance | Effort | Risk | Depends on |
|---|---|---|---|---|---|
| Store submission | the owner checklist in `docs/STORE_READINESS.md` | Blocked on verified enrollment and native QA. The owner records submission receipts from both stores. Enrollment and native QA remain prerequisites. | M | accounts, mailbox | captain |
| Share target | Wanted from a share | Use the Wanted-from-share criteria in 8.4. This is the native entry to that same work item. | M | none | none |
| Push for the digest and the weekly ask | the rails exist | Only opted-in registered devices receive the accepted D5 messages. Refusal and withdrawal stop scheduling. | S | consent | D5 |

### 8.7 Growth

| Feature | Spec | Acceptance | Effort | Risk | Depends on |
|---|---|---|---|---|---|
| Borough and drink landings as the SEO front door | exist; add the photo and the map CTA above the fold | Each affected landing shows a permitted credited image and a usable Map CTA above the fold at phone widths. | S | none | photos |
| Share cards for every surface | plan, recap, profile, pub (with the photo) | every share unfurls with an image | M | none | photos |
| The `/r/<code>` link with a face | Unspecified in the source draft; P2 owns its disposition. | Pending P2: no behaviour is specified. Do not implement or mark accepted until its destination and public-data contract are recorded. | unsized until scoped | public identity | P2 |
| Product Hunt and a London press line | outside the tree | Pending owner campaign scope, copy, date and destination. No launch or external contact is implied by this plan. | unsized until scoped | public claims | captain |

### 8.8 Operations and owner dependencies

| Feature | Spec | Acceptance | Effort | Risk | Depends on |
|---|---|---|---|---|---|
| Vercel firewall rule | section 2 item 15 | Blocked on D6 and dashboard evidence. `/api/*` never challenged | S | captain-side | D6 |
| Support mailbox | `support@pubmaxxing.com` answers | The owner records successful inbound delivery and reply from the published address; configuring a string alone does not pass. | S | captain-side | none |
| CWV sweep on the merge bar | `npm run perf:cwv-sweep` before a map merge; production Slow 4G table recorded | The audit owner supplies release-labelled results against unchanged budgets. This docs task does not run the heavy sweep. | S | time | none |
| `profiles.user_id` backfill | migration 0152, reported applied in Astra.md | Confirm the private thread admits participants and refuses non-members. | S: verification | access policy | existing migration and relevant proof |
| Founding numbers 9, 11, 12 | identify test accounts for removal or leave them retired; never reclaim or reassign a number | Any removal preserves permanent number gaps and the allocation sequence. No remaining account receives a retired number. Account removal requires the owner's named disposition. | S | none | captain |
| Retire the P2 debt | the review lists (report section 4) | Each finding has its own fix and relevant proof, or a named accepted deferral. A merged bundle is not blanket clearance. | M | none | none |
| Leaked-password protection | the captain enables it in the Supabase Auth dashboard (advisor WARN `auth_leaked_password_protection`, open since 6 August and louder since #1524 shipped password sign-in) | the advisor reads clean | S | captain-side | none |
| Enrichment retry proof | Reconcile #1584 retry work with `GET /api/admin/city-enrichment` and its queue-age summary. | Identify evidence that deferred work completes or reaches an explicit terminal state within three nights. Separate simulated recovery tests from successive live-night proof. | S: evidence review | provider availability | #1500 and #1584 |

### 8.9 Measurement: preserve the 28-day outcome and the reporting limits

The 6 September draft records an adopted goal: weekly groups that complete a Planned Night and repeat.
A qualifying group has at least two accounts. Completion means a saved Plan ending.
Repeat means the same group, or at least two shared members, completes another Plan within 28 days.
Keep this outcome in the decision record. Do not rename a weekly device rate as this result.

The draft proposed store-side aggregation over completed Plans and participating seats:

| Proposed measure | Original definition | Status |
|---|---|---|
| `completed_group_outings_week` | Completed Plans in the ISO week with at least two non-revoked members at completion. | Blocked on implementation and schema validation; the group outcome is adopted. |
| `repeat_groups_week` | Qualifying completions with at least two shared members in a completion during the prior 28 days. | Blocked on implementation. Validate table/identity bindings and the membership-at-completion rule. |
| `groups_completed`, `groups_repeated` | Counts from those aggregates. | Unavailable as proven group outcomes in the current event stream. |
| `repeat_rate` | `groups_repeated / groups_completed` for that completed-night cohort. | Undefined for an empty denominator; never replace it with a device ratio. |
| `median_days_between_repeats` | Days between qualifying group completions. | Blocked on a documented interval rule and query proof. This does not reopen the adopted core outcome. |

The original view sketch named `plan_id`, `host_user_id`, `member_ids[]`, stops and city.
It also proposed `plans` joined to `plan_crew_members`.
These are design notes, not proof that the schema or retained history supports the query.
No migration or aggregate is introduced by this document.
Any accepted implementation must validate membership, revocation, deletion and access rules against the real store contract.
Read no messages. Publish aggregate counts only; do not add identity joins to analytics events.

The current canonical [METRICS.md](../analytics/METRICS.md) reports weekly accepted Plans, crew commitments and completed nights separately.
Its repeat proxy follows consenting `distinct_id` devices into the next ISO week.
It cannot join a guest's `crew_committed` event to another device's `plan_completed` for the same night.
It cannot prove two shared members or 28-day group repetition.
Even its proposed completion-receipt crew boolean would not close the group-identity repeat gap.
M1 remains the engineering reconciliation between the reporting proxy and the adopted outcome above.
The completed-group measure needs its own store proof; adding words to this document cannot provide it.

[TRACKING_PLAN.md](../analytics/TRACKING_PLAN.md) remains authoritative for event names, emitters and the release metric.
The release metric is first meaningful action within 60 seconds, not Weekly Meaningful Nights.
The original draft incorrectly treated every invite stage as a same-device funnel.
Invites cross devices; weekly sends/opens are counts or a labelled aggregate ratio, not a joined conversion proof.
`guest_plan_participated` is registered without an emitter; registration does not make guest depth measurable.
Server-minted price confirmations do not create analytics events without a consenting actor.

Filter product queries to `environment = 'production'` and retain release/schema attribution.
Unattributed history cannot be called production. Product events have no `$session_id`, Plan ID or handle.
Use the verified outcome delivery contract for kept actions and retain each metric's denominator.
The six loop-moment events remain supporting pairs, not additional meaningful core actions.

Acceptance remains blocked on M1 implementation and proof.
Record the adopted outcome, population, repeat window and reporting limits in the canonical metric document.
The adopted store aggregate needs a reviewed schema query and known examples for qualifying, non-qualifying and empty cohorts.
Until then, report the current proxy by its actual name and mark the 28-day group measure unmeasured.
Numeric D1/D7/D30 cohort targets and staged rollout thresholds remain within #1522; this plan supplies no invented targets.

#### Measurement evidence checkpoint for #1522

Source: coordinator handoff on 7 September 2026 from task `01a076b4-e017-70b2-b60a-d430b6aecd77`.
The coordinator inspected PostHog project `219466` read-only. This docs task did not repeat that inspection.

The [saved sample Retention insight](https://eu.posthog.com/project/219466/insights/fXaBWbD7)
uses `$pageview` for both target and return, period `Week`, 11 intervals, and `date_from = -7d`.
It has no property filters and includes test accounts.
It does not measure London activated-user D1, D7 or D30 retention.

The coordinator inspected all 13 saved insights.
No named activated-core retention insight or accepted numeric targets were found in that inspected set.
This is not proof that no separate cohort definitions exist.
The warehouse-schema tool failed with `Tool read-data-warehouse-schema not found`; no guessed SQL was run.
Separate cohort definitions therefore remain unverified.

An unsaved aggregate query covered 8 August to 7 September 2026 UTC, through its query time.
It returned these project-wide event counts, including test accounts:

| Event | Count |
|---|---|
| `meaningful_core_action` | 3 |
| `briefing_viewed` | 3 |
| `plan_generated` | 8 |
| `plan_saved` | 3 |
| `plan_created` | 2 |
| `venue_accepted` | 2 |
| `concierge_ask` | 8 |
| `night_description_submitted` | 9 |
| `account_claimed` | 2 |
| `tour_complete` | 5 |

These are event counts, not unique customers, production-only figures or London activated-user cohorts.
The returned `meaningful_core_action` action values contained only `plan_saved`.
That result does not narrow the code-defined action set or prove the other actions unused.
The returned taxonomy contained no explicit recap, food or voice event.
Missing entries do not establish zero usage, missing emitters or a completed retention measurement.

The #1522 cohort-and-target checkbox remains unchecked.
Code-defined event names and emitted instrumentation do not establish accepted cohort definitions or numeric targets.
The measured-core-loop gate remains in force. This evidence authorises no rollout and adds no product interview question.

---

## 9. Roadmap in waves

The original wave order is retained as planning history, without elapsed 'this week' commitments.
Re-cut undelivered waves after the decisions in section 1. Check existing lanes before assigning duplicate work.
Each accepted wave requires relevant proof and a captain-owned deploy. None of the following proves that work already passed.

**Wave 0 (historical ordering, partly delivered): the fixes a stranger sees, and the truth fixes Astra found.** Section 2 items 1, 5, 6, 7, 8, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25 and the firewall rule; plus items 26 to 33, which are the six lanes assigned on 6 September: `venue-truth-contract` (26, 33 freshness half), `today-intent-and-plan-metadata` (27, 28, 29, 30), `analytics-env-attribution` (31), `authz-matrix-tests` (33 test half), `enrichment-retry-proof` (the F04 proof, section 8.8), and `landing-london-pictures` (D3 as decided, the first piece of Wave 1 pulled forward on the captain's word). Proves: the site reads as one system on a phone; no stamp lies; no primary hides under chrome; a handle can be claimed; the venue API says only what it knows; every product event names its release.

**Wave 1 (proposed, subject to D4): the first sixty seconds and the photograph.** Section 3 onboarding, D1, D3b with the chain assets on the sheet, item 3 (slim image field), item 2 (the 12 MB), item 32 (the desktop row and `/pal`), the reduced map toolbar. Proves: a stranger gets an answer with a picture inside 15 s on Slow 4G; first pin under 5 s; a desktop figure exists to regress against.

**Astra's PR00 to PR11, mapped onto these waves.** Astra proposed twelve work packages in the captain's paste, one per finding plus PR00 (the change map). The original scout recorded PR00 (`data/astra-delta-plan/report.md` section 3); the packages are placed by the finding each addresses so nothing is proposed beside a lane that already owns it.

| Astra package | Finding | Where it lives now | Wave |
|---|---|---|---|
| PR00 change map | production `1d676d930` against main `5bf044f55`, 14 PRs since #1558 | executed; report section 3 | done |
| PR01 | F01 transport copy | item 27, `today-intent-and-plan-metadata` | 0 |
| PR02 | F02 quiet intent | item 28, same lane | 0 |
| PR03 | F03 venue contract | item 26, `venue-truth-contract` | 0 |
| PR04 | F04 enrichment retry proof | section 8.8, `enrichment-retry-proof` | 0 |
| PR05 | F05 desktop LCP and CLS | item 32 and section 6 desktop row | 1 |
| PR06 | F06 event attribution | item 31, `analytics-env-attribution` | 0 |
| PR07 | F07 leaked password and RLS tests | item 33, `authz-matrix-tests`; the toggle is the captain's, section 8.8 | 0 |
| PR08 | F08 Pub of the day gate | item 29, `today-intent-and-plan-metadata` | 0 |
| PR09 | F09 `/plan` canonical and OG | item 30, same lane | 0 |
| PR10 | F10 social loop and mobile verification | done by this plan's review with screenshots; fixes are items 6, 7, 12, 19 to 25 | 0 |
| PR11 | F11 deployment SHA provenance | resolved against Astra's early read; nothing in the tree | closed |
| 72-case QA matrix | Astra's proposed acceptance sweep | The original draft distributed it across waves. That is planning coverage, not evidence that 72 cases passed. | each |

**Wave 2: a second person.** The D2 public London-tonight lane, bill-backed Pint Drop, "I'm here" on the sheet, the second-drinker door on the pin, the contributor record with faces. Acceptance: permitted public evidence is readable; a priced drop retains its required bill. Measure the revised interaction cost.

**Wave 3: plan together.** Plan chat, open crews on the map, the plan as a card, Rounds folded (D8), the recap share-first. Proves: two accounts plan and talk in one place; a stranger can ask to join a night.

**Wave 4: the second Friday.** The D5 digest and independent price recheck, activity, passport stamps and hours. Acceptance: scheduling honours the agreed combined cadence and consent. A return visit is measured, never assumed from a sent message.

**Wave 5: the stores and the city.** iOS and Android submission, the share target, the historic index as walks, drink pages for every brand, the P2 debt. Proves: the same product in the stores; the SEO front door has a photo.

At each accepted wave, report the release metric and release-labelled performance against current budgets.
Report the canonical weekly device proxy separately. The 28-day group measure remains unmeasured until M1 is implemented and validated.
A count of accounts with another person in their lot also needs a defined store query; do not infer it from device events.

---

## 10. MECE principles

1. **The answer before the ask.** Show an answer before asking for a contribution. Request location only through the chosen location door. Every screen in section 3 obeys it.
2. **Independent agreement confirms a claim.** Trust stays a label (confirmed, logged once, listed, estimate); colour stays the city price band. Apply the exact drink, price, measure and time rules. Repeated claims from one account do not confirm.
3. **A photograph is a fact with a source.** Community first, first-party chain second, licensed third, never stock, never generated. Every photo carries its credit.
4. **One surface, one primary.** A painted button is the one thing to do here; a door that cannot work signed out is never painted.
5. **Bytes belong to the pin.** Nothing rides the map that the map does not draw; a whole-city file is a build artefact, not a request.
6. **Unavailable is its own state.** A failed read is never worded as an absence; a degraded channel tells the reader.
7. **A second person is the feature.** Every social item names the loop it serves and the other person it puts on screen; retirement requires D2 approval and preserves stored history.
8. **Honest copy at every width.** The stamp names the day the evidence was seen; the snapshot is a snapshot; the quiet night is quiet.
9. **The reader's own Friday.** Every return mechanism names the reader's patch, lot or pub; nothing pushes growth mail.
10. **London first, one deploy per cycle, on the captain's word.** New cities are supply; a flag no deployment sets is dark code; the captain applies migrations.
