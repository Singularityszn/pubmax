# Cursor repository handoff: 6 August 2026

Snapshot time: 6 August 2026, while Social Crew read-store work continues after projected-read verification commit `dc5a31043035153170ac6d618bba541ffa54ddd1`.

This file gives Cursor one current map of PUBMAXX. It covers implemented product capabilities, authority seams, runtime functions, active delivery lanes, verification commands, and safe next work. It is not a function-by-function transcription. Source modules and tests remain the authority for exact behaviour.

## Start here

1. Read `AGENTS.md` and every `CONTEXT.md` before changing files.
2. Read `docs/VOICE.md` before changing visible or accessible copy.
3. Fetch `origin` and record the current `origin/main` SHA.
4. Work in an isolated worktree. The primary checkout has mixed uncommitted work.
5. Check open PRs and the active Social branch before choosing files.
6. Reproduce defects end to end before fixing them.
7. Run the smallest relevant tests during work, then the required repository gates before handoff.

Status words in this handoff are exact:

- **Merged**: commit is on `origin/main`.
- **Pushed**: commit exists on a GitHub branch or pull request, but is not on `origin/main`.
- **Local commit**: commit exists only in a local branch.
- **Uncommitted**: working-tree state can still change.
- **Preview-verified**: named Vercel Preview and checks passed. This does not mean Production was promoted.

Snapshot state:

- `origin/main`: `f78593a247506f7fc6e492fcd2a72ae2d0600f3f`
- Draft PRs: #724, #725, and #726
- Open major dependency PRs: #737, #738, and #739
- Social branch: `codex/social-night-loop-20260805`, 51 local commits ahead of `origin/main`, with active uncommitted read-store work
- Social remote branch: none at snapshot time
- Social invite beta: off
- Primary checkout: dirty, mixed ownership, unsafe for broad staging or cleanup

## Product model

PUBMAXX helps adults discover venues and plan nights using price, setting, story, transport, current conditions, and community observations. It promotes intentional social exploration. Alcohol quantity is never an achievement, ranking input, or pressure mechanic.

Use repository vocabulary exactly:

- **PUBMAXX** is the product and brand.
- **Pubmaxxing** is the activity.
- **Pubmaxxer** is a community member.
- **PUBMAXX User ID** is stable private account authority.
- **PUBMAXX Handle** is mutable public identity.
- **Venue** includes pubs, bars, late-food venues, and restaurant-bars.
- **Pint Price** is one named, observed pint price. It is not any drink price.
- **Crawl Route** is an ordered night plan.
- **Crawl Stop** is one Venue in that route.
- **Night Area** is a curated public planning district. It is not Home Area.
- **Visit Report** is one dated account of observed visit conditions. It is not a review or Venue rating.
- **Pint Drop** is a community contribution with price, optional photos, and optional Passed-Down Note.
- **Round** records spend and buying turns. It never records debt.
- **Night Memory** is private by default.
- **Night Story** is a deliberately published expression of a Night Memory.
- **Pub Pal** is a user-owned planning companion. It is not a separate recommendation authority.

`CONTEXT.md` owns the complete glossary. Do not add a parallel vocabulary file.

## Runtime and architecture

PUBMAXX is one Next.js 16 App Router application using React 19 and TypeScript. It deploys to Vercel.

Core systems:

| System                | Purpose                                                       | Authority                                  |
| --------------------- | ------------------------------------------------------------- | ------------------------------------------ |
| Next.js App Router    | pages, route handlers, server rendering, metadata             | `app/`                                     |
| React components      | map, sheets, planners, profiles, contributions                | `components/`                              |
| Domain and stores     | policy, validation, derived state, persistence boundaries     | `lib/`                                     |
| MapLibre GL           | 3-D map, symbols, clustering, camera, accessible map parallel | `components/map/`, `lib/map*`              |
| Supabase              | production Postgres, Storage, RLS, service-role writes        | `lib/*Store.ts`, `supabase/migrations/`    |
| Clerk                 | optional authentication provider beside Supabase              | `lib/clerkIdentity.ts`, `proxy.ts`         |
| OpenRouter            | optional narrated heritage response                           | `app/api/heritage`, `lib/heritage*`        |
| PostHog               | consent-gated product analytics                               | `lib/analytics*`, `docs/METRICS_FUNNEL.md` |
| Vitest and Playwright | unit, policy, data, browser, accessibility, and layout proof  | `__tests__/`, `e2e/`                       |

The application runs without secrets. Keyless local mode uses safe in-memory stores and structured grounded heritage answers. Supabase, Clerk, OpenRouter, analytics, provider APIs, and native credentials extend behaviour only when correctly configured.

Clerk is two-key gated. Both `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are required before Clerk middleware runs. A Clerk session is not a PUBMAXX User ID.

Most writes use server-side service-role stores. RLS is a second defence. Do not expose private table writes to browser roles.

## Implemented product capability map

Unless a section says otherwise, these capabilities exist on `origin/main` at the snapshot SHA.

### Entry, discovery, and re-entry

Implemented surfaces:

- landing experience with direct routes into planning and Map
- `/today` for current, personalised, and varied choices
- `/tonight` for live night context and planning entry
- `/near` for location-based discovery with honest denied and unavailable states
- `/choose-city` for nine curated city guides and any UK place with base-pub coverage
- `/activity` for user activity
- `/contributors` for public contribution totals
- morning re-entry, first-run guidance, and install prompts

Primary modules:

- `app/page.tsx`, `app/today`, `app/tonight`, `app/near`, `app/choose-city`
- `lib/entryDecision.ts`, `lib/morningReentry.ts`, `lib/forYou.ts`
- `lib/nearMeAnswer.ts`, `lib/nearMeLocation.ts`, `lib/nearestCity.ts`
- `lib/dayGreeting.ts`, `lib/gardenWeather.ts`, `lib/drinkWeather.ts`

Preserve:

- denied location remains usable
- empty and failed data are different states
- recommendations name their evidence and freshness
- duplicate product branding does not replace useful route metadata

### Editorial guides, collections, and supporting surfaces

Implemented:

- borough chapters, heritage pages, historic Venue guides, and landmark pages
- chronological public Pint Drop feed and per-Venue Bar Tab grid
- public Venue Ledger with newest-first Pint Drop and Passed-Down Note history
- redacted legacy Family Table lane on public Ledger pages
- Pint Passport activity summary, borough progress, and non-consumption badges
- Venue and drink ratings with minimum-vote and Bayesian display policy
- saved Venue lists with signed-out local fallback and account-backed paths
- private check-ins and the `/we-are-out` friends-facing composer
- email subscriber confirmation and digest generation seams
- Venue operator proposal and moderation paths
- food-hygiene lookups with source and rate-limit boundaries

Primary modules:

- `app/borough`, `app/historic`, `app/landmark`, `app/feed`
- `app/bar-tab/[id]`, `app/ledger/[id]`, `app/p/[id]`
- `lib/feed.ts`, `lib/feedSightings.ts`
- `lib/boroughs.ts`, `lib/boroughHeritage.ts`, `lib/historic.ts`, `lib/landmarks.ts`
- `lib/ledger.ts`, `lib/passport.ts`
- `lib/ratings.ts`, `lib/ratingsStore.ts`
- `lib/savedPubs.ts`, `lib/savedPubsStore.ts`, `lib/savedListPolicy.ts`
- `lib/checkIn.ts`, `lib/checkInStore.ts`, `app/we-are-out`
- `lib/emailSubscribers.ts`, `lib/emailSubscribersStore.ts`, `lib/dealsDigest.ts`
- `lib/operatorProposals.ts`, `lib/operatorProposalsStore.ts`
- `lib/foodHygiene.ts`, `app/api/hygiene`

Preserve:

- public Ledger never exposes private legacy note bodies or handles
- Passport and badges reward exploration, contribution, and completion, never alcohol quantity
- ratings stay hidden below their evidence floor and never replace Visit Reports
- signed-out saved lists are device-local demo state, not durable account claims
- check-in visibility and operator claims remain server-authorised
- subscriber, provider, and hygiene failures stay honest and bounded
- Social branch redirects `/feed` to `/social`; do not expand current Feed while that ownership is active

### Map, search, and Venue sheets

Implemented:

- MapLibre 3-D map with light and dark basemaps
- curated price-aware Venue layer for London and supported cities
- separate UK-wide unpriced OSM base-pub layer at street zoom
- clusters, price bands, selected Venue state, deep links, and camera intents
- area, locality, Venue, price, kind, amenity, and drink-lens discovery
- accessible List view that follows visible map results
- phone sheets, desktop drawers, hover cards, and map navigation history
- Venue sheets with price, menu, heritage, visit, access, and community context
- OSM attribution attached to Map, not only to optional source layers

Primary modules:

- `app/map`, `components/map/`, `components/mobile/`
- `components/map/canvas/buildScene.ts`
- `components/map/canvas/filters.ts`
- `components/map/canvas/tokens.ts`
- `lib/mapExperienceLens.ts`, `lib/mapPriceLegend.ts`, `lib/mapVenueList.ts`
- `lib/mapSurfaceHistory.ts`, `lib/surfaceStack.ts`
- `lib/mapSearchCamera.ts`, `lib/mapSearchSuggest.ts`
- `lib/cityVenuePacks.mjs`, `lib/venueIndexTracing.mjs`
- `public/data/uk_base/README.md`

Preserve:

- curated and UK base layers remain separate
- map density and symbol collision constants are product contracts
- pin colour may use a demo hint, but a printed price figure needs authoritative price evidence
- bar, food, and restaurant anchors never appear as bare Pint Prices
- accessible List view stays behaviourally parallel to pins
- Back, Home, Escape, and fling dismissal follow `lib/surfaceStack.ts`
- dynamic runtime data paths stay declared in tracing configuration

### Price, drinks, menus, and trust

Implemented price lanes:

1. Curated current prices from the Venue Dataset.
2. Community current prices with named contributor, date, freshness, and corroboration policy.
3. Historical prices shown only as history.
4. National pint benchmarks shown only on live Pint Index.

Implemented:

- pint-first map pricing
- selected drink lenses for supported drink categories
- separate soft-drink and alcohol-free categories
- current community prices on each Venue sheet after one report
- provisional pin mark after first current pint report
- map colour and cheapest views only after corroboration and freshness gates
- sourced menu and anchor prices where evidence exists
- reporting, moderator hide, restore, and provenance retention
- category price index with `ready`, `partial`, and `degraded` truth states
- immutable monthly Pint Index archive with corrections and integrity hashes
- live CSV and fixed published-month CSV schemas

Primary modules:

- `lib/drinks.ts`, `lib/drinkMenu.ts`, `lib/drinkPriceUpdates.ts`
- `lib/communityPrice.ts`, `lib/communityPriceStore.ts`
- `lib/communityVenueSignals.ts`
- `components/map/communityPriceSignals.ts`
- `lib/mapExperienceLens.ts`
- `lib/priceHistory.ts`, `lib/priceHistoryLoader.ts`
- `lib/nationalPintBenchmarks.ts`
- `lib/pintIndex.ts`, `lib/pintIndexArchive.ts`, `lib/pintIndexCanonical.mjs`
- `app/api/price-submit`, `app/api/price-confirm`
- `app/pint-index`, `app/pint-index/[month]`

Preserve:

- first report can mark but cannot repaint Map
- corroboration count is derived, never client-supplied or stored
- hidden rows leave all current price and signal calculations together
- no-alcohol prices share trust policy but never enter pint authority
- `other` remains loggable but cannot own a map lens
- historical and national figures never enter current price decisions
- every figure-bearing published month block reads only frozen edition data

### Venue observations and community knowledge

Implemented:

- Visit Reports with a dated 140-character account and closed observation vocabulary
- community Venue signals for character, access, door policy, and eating
- weather Recommendations as attributed opinions
- follower-aware public visibility
- contributor totals derived from visible contributions
- reader reports and moderator recovery paths

Primary modules:

- `lib/visitReports.ts`, `lib/visitReportsStore.ts`
- `components/visits/VisitReportPanel.tsx`
- `lib/communityVenueSignals.ts`
- `components/map/VenueCommunitySignals.tsx`
- `lib/weatherRecommendationStore.ts`, `lib/weatherRecommendations.ts`
- `lib/contributorLeaderboard.ts`, `lib/contributorLeaderboardStore.ts`
- `app/api/visit-reports`, `app/api/weather-recommendations`

Preserve:

- Visit Report is never a Venue rating
- visit date, not creation date, owns freshness and display order
- failed reads never appear as no reports
- step-free entrance and step-free toilets stay separate
- a lone expired report can support detail but cannot establish an access fact
- UI branches on trust enum, not on copy text

### Pint Drops, photos, and Passed-Down Notes

Implemented:

- Pint Drop composer and Venue-attached reads
- observed Pint Price with optional pint and Venue photos
- optional Passed-Down Note with era context
- in-memory keyless store and durable Supabase store
- storage object ownership and moderated public reads
- report threshold for Pint Drops and moderator review
- demo seeds that stay visibly marked and do not affect organic metrics

Primary modules:

- `lib/pintDrops.ts`, `lib/pintDropsStore.ts`
- `lib/pintDropDraft.ts`, `lib/pintDropViewer.ts`
- `lib/pintContributions.ts`, `lib/imageSafety.ts`
- `app/api/pint-drops`, `app/add`, `app/add/[handle]`

Preserve:

- Pint Drop, Visit Report, and Social post remain separate aggregates
- database stores object keys, not trusted caller-owned public URLs
- moderation hides rather than deletes provenance
- demo content never earns authority or organic metrics

### Crawl planning and route continuity

Implemented:

- suggested Crawl Routes and build-your-own routes
- Crawl Preferences for price, story, amenities, and mood
- curated Featured crawls and city-specific crawls
- geolocation-based Pubs near me
- shareable URL state and invite links
- walking and tube transport modes
- route windows, stop order, travel estimates, and route geometry
- active Plan continuity across navigation and refresh
- collaborative Plan membership and invite flows
- explicit Crawl Ending choices: Food, Get Home, or Keep Going
- completion and recap surfaces

Primary modules:

- `app/plan`, `app/plan/[id]`, `app/crawls`, `app/crawls/[slug]`
- `lib/plan.ts`, `lib/planStore.ts`
- `lib/planCollaborationStore.ts`, `lib/planCollaborationHttp.ts`
- `lib/nightPlanning.ts`, `lib/nightCrawl.ts`
- `lib/walkRoute.ts`, `lib/lastRide.ts`
- `lib/activePlan.ts`, `lib/planContinuity.ts`
- `lib/crawlCompletion.ts`, `lib/crawlStory.ts`
- `app/api/plans`, `app/api/walk-route`, `app/api/last-*`

Preserve:

- route state round-trips through URL and held navigation state
- unavailable routing degrades honestly to straight-line estimates
- complete Crawl Stop order remains authoritative
- final Crawl Stop allows only one Crawl Ending action
- collaboration ownership resolves through stable account identity

### Night Context, current conditions, and get-home help

Implemented:

- Night Area and Daypart planning
- visible editable Night Context
- weather recommendations and snapshots
- current event and what-is-on feeds
- late-food suggestions
- night-area demand, calm, character, and place signals
- TfL disruption and nearby transport help
- last train, tram, subway, Merseyrail, and other supported get-home answers
- freshness status and provenance for current claims

Primary modules:

- `lib/nightAreas.ts`, `lib/nightProfile.ts`, `lib/nightPlanning.ts`
- `lib/nightOutPlaces.ts`, `lib/nightSignalClaims.ts`
- `lib/events/`, `lib/lateFood.ts`, `lib/foodHygiene.ts`
- `lib/tflDisruption.ts`, `lib/metrolink.ts`, `lib/merseyrail.ts`
- `lib/lastRide.ts`, `lib/nearbyBusDepartures.ts`
- `app/api/tonight-conditions`, `app/api/whats-on`, `app/api/night-*`

Preserve:

- live, cached, stale, unresolved, and unavailable remain distinct
- inference is visible and editable
- event and provider claims keep source and observation time
- transport times name whether they are leave-by times or estimates
- current context cards are not user posts and are never disguised as such

### Rounds and night diary

Implemented:

- shared Round code and member access
- immutable buying turns
- current payer rotation derived from payer order
- plain total and itemised drink lines
- Plan and Map handoff into a Round
- idempotent community-price promotion for eligible first-party lines
- durable promotion outcomes: `promoted`, `superseded`, `legacy_unknown`, or diary-only behaviour

Primary modules:

- `app/rounds`, `app/rounds/[code]`
- `lib/rounds.ts`, `lib/roundsStore.ts`, `lib/activeRound.ts`
- `app/api/rounds`

Preserve:

- Round records spend, never balances, debt, shares, or settlement
- demo menu figures can prefill but cannot become community observations
- promotion depends on provenance, not value equality
- older superseded lines remain in diary history

### Profiles, follows, messages, and account identity

Implemented:

- public profile routes by PUBMAXX Handle
- private account profile data
- handle claims, rename rules, reserved names, and retired-handle routing
- follow and follower relationships
- direct messages with server-side message authority
- saves, check-ins, notifications, and referrals
- Clerk and Supabase authentication paths
- account deletion and contribution redaction seams

Primary modules:

- `app/profile`, `app/u/[handle]`, `app/messages`
- `lib/identityHandleStore.ts`, `lib/handleDisplay.ts`
- `lib/authServer.ts`, `lib/clerkIdentity.ts`, `lib/passwordlessAuth.ts`
- `lib/followStore.ts`, `lib/messagesStore.ts`, `lib/messageAuth.ts`
- `lib/checkInStore.ts`, `lib/notificationsStore.ts`
- `lib/referralStore.ts`, `docs/REFERRALS.md`

Preserve:

- PUBMAXX User ID owns data, not mutable handle
- client-supplied handles never establish authorship
- private date of birth, full name, and sex do not become public profile data
- Clerk session and product account authority remain separate
- account deletion redacts attributable content without rewriting unrelated provenance

### Memories, moments, stories, and recap

Implemented before new Social programme:

- private Night Memory records
- Night Moments with optional media
- crawl story and recap routes
- explicit story publishing and consent boundaries
- memory timelines and private ownership

Primary modules:

- `lib/nightMemory.ts`, `lib/nightMemoryStore.ts`
- `lib/nightMomentMedia.ts`, `lib/momentDraft.ts`
- `lib/crawlStory.ts`, `lib/crawlStoryStore.ts`
- `app/moment`, `app/recap/[storyId]`
- `app/api/night-memories`, `app/api/night-moments`, `app/api/night-stories`

Preserve:

- private memory is not an automatic public post
- contributor media and likeness need explicit consent before wider publication
- story publication does not erase private source history

### Pub Pal, heritage, and voice

Implemented:

- grounded Venue Heritage retrieval
- structured keyless answers and optional OpenRouter narration
- Pub Pal glance and chat surfaces
- optional user-initiated voice sessions
- typed, confirmed Pal Memory
- Night Signal presentation and cosmetic progression
- rate, quota, privacy, and provider boundaries

Primary modules:

- `app/pal`, `app/pal/chat`, `app/api/pub-pal`
- `lib/palChat.ts`, `lib/palGlance.ts`
- `lib/heritage.ts`, `lib/heritageFacts.ts`, `lib/heritageListings.ts`
- voice and companion components under `components/pal/`
- Pub Pal ADRs in `docs/adr/`

Preserve:

- grounded facts remain separate from generated narration
- provider API keys never reach browser code
- raw audio, transcripts, and generated prose are not Pal Memory
- mutations follow propose, confirm, then persist
- nightlife progression never uses alcohol quantity

### PWA, native shells, push, and sharing

Implemented:

- installable PWA shell and offline cache boundaries
- Add to Home Screen prompts and install analytics
- Capacitor iOS and Android wrapper configuration
- native deep-link and system-bar helpers
- web and native push-token storage seams
- opt-in daily brief push path
- social cards, crawl cards, list cards, plan cards, and city cards
- store-readiness copy, assets, and screenshot plan

Primary modules:

- `lib/a2hsPrompt.ts`, `lib/offlineCache.ts`
- `lib/nativePlatform.ts`, `lib/nativeDeepLinks.ts`, `lib/nativePush.ts`
- `app/api/push-tokens`, `scripts/push/`
- card routes under `app/api/*-card`
- `docs/CAPACITOR_WRAP.md`, `docs/STORE_READINESS.md`, `docs/WEB_PUSH.md`

Preserve:

- install prompts remain platform-correct and dismissible
- push is opt-in; current generic registry is identity-free
- person, Plan, and protected Social targeting remain closed until stable subscription ownership and send-time visibility checks exist
- store publication requires owner accounts and store-side actions

### Analytics, freshness, data, and operations

Implemented:

- consent-gated PostHog analytics
- central event registry and funnel definitions
- no raw viewer coordinates in analytics
- freshness registry and route-visible feed health
- separate stale and unresolved findings
- protected cron plane
- local review-gated data refresh scheduler
- semantic data diffs and generated refresh PR path
- data validation, source provenance, payload budgets, and build tracing tests
- resilient dependency audit with narrow documented waivers

Primary modules:

- `lib/analytics.ts`, `lib/analyticsEvents.ts`, `docs/METRICS_FUNNEL.md`
- `lib/freshness.ts`, `lib/freshnessNotify.ts`, `lib/dataFreshness.ts`
- `app/api/freshness`, `app/api/cron`
- `docs/CRON_PLANE_RUNBOOK.md`, `docs/LOCAL_REFRESH_SCHEDULER.md`
- `docs/WAYFINDER_LIVE_DATA.md`, `docs/OBSERVABILITY_CERTIFICATION.md`
- `scripts/validate-data.mjs`, `scripts/check_freshness.mjs`
- `scripts/resilient-audit.mjs`

Preserve:

- analytics waits for consent
- viewer coordinate egress uses only `lib/geo.ts`
- unresolved age is not stale and is never treated as fresh
- operate the existing scheduler before proposing more orchestration

### Privacy, legal, security, and moderation

Implemented:

- privacy and terms routes tied to actual data flows
- consent-gated analytics disclosure
- hashed, short-lived rate-limit identities
- expiring durable rate-limit records
- service-role write paths and RLS defence
- moderator-gated queues and reversible hiding
- response headers, CSP, callback validation, and URL validation
- write-surface and observability certification documents

Primary modules:

- `app/privacy`, `app/terms`, `app/legal.css`
- `lib/geo.ts`, `lib/ipRateLimit.ts`, `lib/adminAuth.ts`
- `proxy.ts`, `lib/apiResponses.ts`, `lib/httpUrl.ts`
- `docs/SECURITY_POSTURE.md`, `docs/WRITE_SURFACE_CERTIFICATION.md`
- `supabase/migrations/`

Preserve:

- data-practice changes update legal pages in the same commit
- public Venue coordinates and private viewer coordinates are different data classes
- moderation hides content without deleting provenance
- missing auth or configuration fails closed on protected paths
- Captain applies production migrations. Agents ship reviewed SQL and rollback proof only.

## Data layout

Keep these data classes separate:

| Data class                | Purpose                                     | Browser payload                    |
| ------------------------- | ------------------------------------------- | ---------------------------------- |
| Curated slim Venue index  | priced pins, search, filters, crawl routing | yes, budgeted                      |
| Server Venue detail index | lazy Venue-sheet detail                     | no direct bulk payload             |
| UK base-pub shards        | street-zoom unpriced OSM discovery          | viewport streamed                  |
| Drink price updates       | dated current observations                  | merged through server policy       |
| Price history             | dated historical comparison                 | read-only, never current authority |
| Pint Index editions       | immutable published monthly records         | edition-specific                   |
| Freshness registry        | source and artifact age contracts           | status surfaces only               |

`npm run build:slim` builds browser slim data and server detail artifacts. Production functions that build file paths at runtime need explicit `outputFileTracingIncludes`. Declare new runtime packs in `lib/venueIndexTracing.mjs` and prove them with tracing tests.

## Main verification commands

```sh
npm install
npm run dev
npm run lint
npm run typecheck
npm test
npm run verify
npm run ci
```

Use these when relevant:

```sh
npm run test:e2e
npm run test:rls
npm run shots
npm run shots:extended
npm run check:freshness
npm run ci:isolated
```

Notes:

- `npm run dev` works without secrets.
- `npm run verify` runs data validation, lint, typecheck, coverage, and resilient audit.
- `npm run ci` adds production build.
- Playwright needs Chromium installed.
- RLS proof needs local PostgreSQL 16 and PostgREST.
- Use `NEXT_DIST_DIR=.next-prod` for production QA when another process uses `.next`.
- A hand-started listener on the Playwright port can bypass required test environment variables. Let Playwright own its server.
- `next dev` can rewrite `next-env.d.ts`. Do not commit that tooling churn.

## Work merged on 5 August

These commits are on `origin/main`:

- PR #714: RLS wave 2
- PR #721: review-gated London refresh scheduler
- PR #712: reserved PUBMAXX Handles
- PR #713: viewer-coordinate privacy and expiring rate limits
- PR #722: Clerk provider availability
- PRs #716, #717, #718, #720, and #723: dependency updates

Read `tofable.md` beside this file for the detailed 5 August delivery ledger.

## Pushed but not merged

### PR #724

Design skill and plugin skill-pack refresh. Draft. Owns `skills/` and design-skill catalogue work. Keep application changes separate.

### PR #725

Full product, security, and UX review. Draft. Documentation only. Main artifact is `docs/FABLE_FULL_PRODUCT_REVIEW_2026-08-05.md` on branch `codex/full-review-20260805`.

### PR #726

V1 release hardening. Draft and preview-verified. Branch `codex/v1-release-20260805`, head `0a9c8d4f8e9663067d2bf70929b28d9b130cd112`.

It includes private Night Memory and Pub Pal quota authorisation, atomic profile deletion, reserved-handle enforcement, honest Night Crawl rollback, dated and stale-aware menu presentation, other price-truth hardening, production demo exclusion, durable reaction batching, mobile Today and install fixes, Clerk hardening, and stronger gates.

Recorded release gate: Captain applies and verifies `supabase/migrations/20260805070000_0070_v1_release_security.sql`. Do not describe PR #726 as merged or deployed.

### PRs #737 to #739

Open major dependency updates for ESLint 10, TypeScript 7, and Lucide React 1.28. Review separately with full CI and browser proof.

## Active Social Night Loop branch

Branch: `codex/social-night-loop-20260805`

Worktree: `.codex-worktrees/social-night-loop-20260805`

State: 51 local commits ahead of `origin/main`, no remote branch, active uncommitted read-store work at snapshot time.

Master plan: `docs/superpowers/plans/2026-08-05-verified-social-night-loop.md` on that branch.

Completed local programme slices:

1. Beta contract, threat model, GitHub issue hierarchy, and release controls.
2. Stable Social product identity and five-state access policy.
3. Durable verified Social posts, chronological feeds, moderation, and privacy changes.
4. Cheers, comments, private saves, reposts, quote posts, reports, blocks, notifications, and feature-request governance.
5. Canonical responsive `/social` shell, redirects, navigation state, and accessibility proof.
6. Composer, private media delivery, edit revision, draft recovery, feature requests, and explicit tag consent.

Active Task 7 foundation:

- migration `0075_social_crews` and rollback
- Crew ownership, membership, roles, visibility, invitations, and join requests
- stable relationship authority
- legacy Plan boundary protection
- verified Crew membership routes
- atomic Crew detail and membership projected reads
- authority-first pagination and snapshot-race proof

Latest committed Social head at snapshot: `dc5a31043035153170ac6d618bba541ffa54ddd1`.

Commits `3f9cdc57b` and `dc5a31043` completed projected-read race isolation and clarified the snapshot boundary. Work then continued without a new commit in:

- `lib/socialCrewCursor.server.ts`
- `lib/socialCrewProjection.server.ts`
- `lib/socialCrewStore.ts`
- `__tests__/socialCrewReadStore.test.ts`
- `__tests__/socialCrewStore.test.ts`

Treat this read-store diff as unstable. Recheck the worktree before planning because the active agent can commit or change it after this snapshot.

Do not edit Social files, allocate its migration numbers, apply its migrations, or depend on unpushed DTOs. Tasks 7 through 9 are not complete. Crew Pages, full crawl integration, safe-home handoff, 30-day chat expiry, Night Story imports and erasure, beta measurement, and release remain active or deferred.

Social migration order currently starts after PR #726:

1. `0070` from PR #726
2. `0071` Social identity
3. `0072` Social posts
4. `0073` Social interactions
5. `0074` Social composer and consent
6. `0075` Social Crews

Captain has not applied these Social migrations. Confirm final branch state and rollbacks before any hosted operation.

## Uncommitted primary-checkout work

Path: `/Users/karanmanoharan/Documents/pubmax`

Branch: `docs/dag-handoff`

State: large mixed diff across application code, tests, skills, reviews, plans, and SQL.

Do not reset, clean, stash, bulk-stage, or commit this checkout. Its product changes are salvage candidates, not delivered features. Current candidates include:

- route mini-map stale-state and routed-bounds correction
- Night Area coverage truth correction
- Night mode leave-by and straight-line wording
- failed what-is-on refresh truth
- TfL daylight-saving boundary correction
- mixed walking-route approximation and global rate-limit protection
- final Crawl Stop action guard
- retired-handle metadata correction
- navigation return-path state retention
- account-deletion mention redaction
- stale Venue price-story request handling

Reproduce each candidate in a clean worktree, compare with PR #726 and Social ownership, then move one verified slice.

Critical collision: primary checkout contains untracked `supabase/migrations/20260805090000_0070_departed_contributor_name.sql`. PR #726 already owns suffix `0070`. Never apply or commit the primary file under that suffix. Reassess after PR #726 merges, then assign a later unused number with rollback and tests.

Issue #727 and uncommitted store-deduplication specifications are proposals. Store deduplication is not implemented.

## Ownership and collision map

| Lane                   | Owns                                                                                               | Avoid                         |
| ---------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------- |
| PR #724                | repository skill packs                                                                             | application code              |
| PR #725                | review documentation                                                                               | implementation                |
| PR #726                | v1 security, identity, price truth, Today, install, release gates                                  | Social runtime and migrations |
| Social branch          | Social policy, identity, posts, interactions, shell, composer, media, Crews, Stories, beta release | PR #726 files until rebase    |
| Primary dirty checkout | mixed salvage only                                                                                 | all new feature ownership     |

PR #726 and Social both touch identity and profile ownership. Merge and verify PR #726 first. Rebase Social after that merge. Preserve PR #726 security semantics and run profile, Clerk, deletion, migration, RLS, and Social tests after conflict resolution.

## Safe Cursor pickup order

1. Fetch and record current `origin/main` and Vercel Production SHAs separately.
2. Check whether PR #726 migration and merge gates have changed since this snapshot.
3. Check whether Social branch is still active and whether it has been pushed.
4. Create a new isolated worktree from current `origin/main` or a named post-merge base.
5. Choose one file-owned lane that does not overlap PR #726 or Social.
6. Write a short plan with reproduction, authority, tests, and browser proof.
7. Implement one independently verifiable slice.
8. Run focused tests, `npm run verify`, and the relevant browser or RLS gates.
9. Request independent review before merge.

Safe next feature lanes after PR #726 lands:

- truthful visual regression readiness signals
- non-Social accessibility foundation, including skip link and sheet focus
- phone Venue decision clarity and trust-caption measurement
- purposeful desktop Today and Tonight composition
- price-free city and Venue-menu proof
- operating the shipped refresh and trust loop

Avoid these until active ownership clears:

- Social composer, media, consent, interactions, or shell
- Crew Pages, Crew membership, and Social projected reads
- Night Story Social publication, imports, export, and erasure
- Social analytics and beta release gates
- PR #726 identity, security, Today, install, price-truth, or migration files

Owner or Captain decisions still required for:

- production migrations
- moderation primary and backup assignment
- age-assurance provider activation
- event-provider credentials
- native store enrolment
- payments or membership
- city launches

## Hard contracts Cursor must preserve

1. PUBMAXX User ID owns data. Handle and provider account names do not.
2. Clerk session and product identity remain different authorities.
3. Community visibility and price authority remain separate decisions.
4. A first report may mark a pin but may not repaint it.
5. Pint, other-drink, food, historical, and national price lanes do not merge.
6. Visit Reports, Pint Drops, Social posts, Night Memories, and Night Stories remain separate aggregates.
7. Round records spend, never debt.
8. Curated Venue index and UK base pubs remain separate data products.
9. Map density, symbol collision, and surface history are tested contracts.
10. Protected reads fail closed. Failed reads do not become empty results.
11. Moderation hides or holds. It does not delete provenance or approve on dependency failure.
12. Saves remain private and engagement does not control feed or Venue rank.
13. Viewer coordinates cross only the shared rounded egress seam.
14. Data-practice changes update privacy and terms in the same commit.
15. Stale and unresolved remain different findings.
16. Runtime file paths need explicit deployment tracing.
17. Published Pint Index months do not silently change.
18. Visible and accessible copy follows `docs/VOICE.md`.
19. Social flags remain off until named release evidence and owners exist.
20. Captain applies hosted migrations.

## Evidence and authority index

Read these before reconstructing behaviour from commit subjects:

- `CONTEXT.md`: complete product vocabulary
- `AGENTS.md`: engineering and product contracts
- `README.md`: public feature overview and commands
- `teach.md`: repository architecture tour
- `tofable.md`: 5 August change and ownership ledger
- `docs/VOICE.md`: visible and accessible copy law
- `docs/DESIGN_SYSTEM.md`: visual system
- `docs/METRICS_FUNNEL.md`: analytics registry and funnel ownership
- `docs/DEPLOYMENT.md`: Vercel and production data build
- `docs/CRON_PLANE_RUNBOOK.md`: protected scheduler plane
- `docs/LOCAL_REFRESH_SCHEDULER.md`: review-gated local refresh operation
- `docs/WAYFINDER_LIVE_DATA.md`: live-data source and freshness policy
- `docs/SECURITY_POSTURE.md`: security posture
- `docs/STORE_READINESS.md`: native store state and owner-only steps
- `public/data/uk_base/README.md`: UK base-pub layer contract
- `public/data/price_history/README.md`: historical price admission rules
- PR #725 branch: current full product review
- PR #726 branch: `docs/V1_RELEASE_HANDOFF_2026-08-05.md`
- Social branch: master plan, beta contract, threat model, and `.superpowers/sdd/` evidence
- GitHub issues #728 through #736: Social programme dependencies

Older PRDs are useful history, not current delivery truth. Verify their claims against source, tests, open PRs, and current Git state.

## Definition of a safe Cursor plan

A new Cursor plan is safe only when it:

- records exact base SHA and current deployed SHA separately
- names one owner for every touched file boundary
- excludes active PR and Social ownership unless integration is the stated task
- states migration, provider, and owner gates before implementation
- identifies authoritative domain modules and tests
- includes user-level reproduction for defects
- includes phone and desktop browser proof for user-facing changes
- preserves keyless behaviour
- preserves PUBMAXX vocabulary and voice
- makes no merged, deployed, or verified claim without named evidence
