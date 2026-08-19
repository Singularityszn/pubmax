# Overnight Coder audit — pubmaxxing.com (chengdu)

**Repo:** Singularityszn/pubmax · **Not** karanmrn/pubmaxxing  
**Date:** 2026-08-19 · **Main tip inspected:** `dec149fb` (#1097)  
**Scope:** Read-and-report only. No product fixes in this branch.

---

## 1. What the code actually is

### Stack
| Layer | Reality in source |
| --- | --- |
| App | Next.js App Router (`app/`), React 19, TypeScript (`package.json` name `pubmaxxing`) |
| Node | `engines.node: ">=22"` — not hard-pinned to 24 |
| Dev | `next dev --webpack` (not Turbopack as the primary local path) |
| Map | MapLibre GL JS · OpenFreeMap raster primary · CARTO Voyager fallback · SW caches OpenFreeMap (`components/map/canvas/tokens.ts`, `lib/swCaching.ts`) |
| Data | Supabase (PostgREST + service-role stores). Migrations through `0110_open_social_crews` |
| Auth | Supabase session is the product identity. Clerk is **optional two-key** (`lib/clerkIdentity.ts`, `proxy.ts`) |
| Brand | `PUBMAXX` brand / `PUBMAXXING` app (`lib/brandNaming.ts`) |
| Deploy | Vercel project **`chengdu`** (`prj_FAC09rdCxDiGujUHeDOeZ04JLymc`) under team `pubmax` / `pubmax69` |

### Main surfaces (routes)
Landing `/` · Map `/map` · Now `/today` + `/tonight` · Out `/out` · Near `/near` · Plan `/plan` · Pal `/pal` · Social `/social` · You `/u/you` · Login `/login` · Messages `/messages` · Admin `/admin` · Founders `/founders` · Crawls `/crawls` · Wanted · Rounds · Pint Index · borough / drink landings · heritage · legal.

Phone chrome: `PRIMARY_NAV_ITEMS` = Now · Map · Out · Social · You (`components/nav/MobileTabBar.tsx`) + floating Compose (`CreateFab`). Desktop: `SiteNav`.

### Auth model
- Durable product session: Supabase + HttpOnly resume cookie (`lib/authSessionResume.ts`, `/api/auth/session`).
- Device multi-account: `lib/deviceAccountSessions.ts` / `deviceAccountSwitch.ts`.
- Actor-gated writes: bearer → server-derived actor (`gateHandleAction` / `resolveContributionIdentity`).
- Clerk: only when **both** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are set. Missing secret keeps the plain security proxy so the site never 500s.

### Map stack (client, not “API pins”)
- Scene/constants: `components/map/canvas/buildScene.ts`
- Basemap URL: `OPENFREEMAP_RASTER_STYLE_URL` with CARTO fallback (`components/map/canvas/tokens.ts`)
- WebGL recovery: `components/map/canvas/webglRecovery.ts`
- Pin probe for e2e: `paintedPinProbe.ts`
- City OG card: `/api/city-map-card` (`app/api/city-map-card/route.tsx`) — share image, not the live pin pipeline

### Key write APIs (do not conflate)
| Surface | Route | Store / table | Notes |
| --- | --- | --- | --- |
| Community price (“Log a price”) | `POST /api/price-submit` | `community_prices` | Needs signed-in + completed profile (`resolveContributionIdentity`) |
| Pint Drop (map moment) | `POST /api/pint-drops` | `visit_reports` | Analytics: `night_moment_saved` kind `pint_drop` |
| Visit Report (dated account) | `POST /api/visit-reports` | `structured_visit_reports` | Auth required; **creation** blocked by `socialFreezeResponse()` |
| Open social crew / feed | social routes | social tables | Gated by `PUBMAX_SOCIAL_FRIENDS_LAUNCH` |

### Data model (high level, migrations)
Profiles + handles · private identity · adult assertions · community prices · visit_reports + structured_visit_reports · occupancy · plans + social crews (visibility `open` in 0110) · wanted · messages · venue photos · profile covers · founding numbers · referrals (marks only) · crawl_stories + **crawl_story_stops** · rate_limits · ops freezes via env.

---

## 2. Baby’s likely work list vs source

### `/api/crawls` still selects `crawl_stories.stops`?
**Reject.**  
Stops live in sibling table `crawl_story_stops` (`lib/crawlStoryStore.ts`, migration `0006`).  
`app/api/crawls/route.ts` uses `body.stops` only as **POST body** parsing (`readStops`), not a PostgREST column on `crawl_stories`. A “column does not exist” failure on that shape is not what this route does today. Do not restack a schema bug that is already fixed in code.

### Pint Drop / visit-reports “never write” (price_submit_viewed 24 vs visit_reports 0)
**Reject the funnel as stated; keep the symptom.**

Three different lanes were merged in the brief:

1. **`price_submit_viewed`** — composer opened (`VenuePriceEntryPanel.tsx`) → hits **`/api/price-submit`**, not visit-reports.
2. **Pint Drop** — `/api/pint-drops` → table `visit_reports` → client event **`night_moment_saved`**.
3. **Visit Report** — `/api/visit-reports` → `structured_visit_reports` → `visit_report_created`.

**PostHog (project 219466, ~30d, EU):**
- `price_submit_viewed` ≈ **24**
- `price_submitted` = **0**
- `contribution_gate` = **0**
- `night_moment_saved` = **0**

So people open the price composer and almost never finish a trusted write. That is a **contribution / auth / onboarding** problem on `/api/price-submit` (`lib/contributionIdentity.server.ts`: 401 sign-in, 409 “Choose a public handle and add your date of birth…”, 503 verification unavailable), not proof that `POST /api/visit-reports` is selecting a bad column.

Visit-report **creation** can also hard-stop with 503 under `PUBMAX_SOCIAL_FREEZE=social` (`lib/opsFreeze.ts`); reporting/moderation stay open. Check that env on the deployment before blaming the route.

### Map tiles / pins — client WebGL vs API miss?
**Mostly client.** Live map paints via MapLibre + OpenFreeMap (CARTO fallback). Failures look like WebGL context loss, basemap/CDN, or pin collision — not a missing `/api/...` pin feed. City-map-card is OG only. Keep V0 item (1) as draw/reliability work on the canvas stack (`buildScene.ts`, `webglRecovery.ts`, SW caching), not invent a pin API.

### Price freshness (`price_updates` ~6 Jul) / enrich-city-pubs
**Confirm stale lane.**  
`data/freshness_registry.json` → `public/data/price_updates/latest.json` stamped **2026-07-06**, `updates: []`. First-party parsers in `scripts/fetch_price_updates.mjs` are **stubbed to empty** (“awaiting ToS”). So the registry will keep looking “fresh” relative to a dead pipeline, or the stamp ages with nothing useful inside — either way it is not a live observation lane.

`/api/cron/enrich-city-pubs`: `maxDuration = 120`; **no-ops without Tavily + AI Gateway keys**. Timeout / empty enrich is expected keyless.

Community prices and `drink_price_updates` remain the live people/curated lanes; do not confuse them with the stubbed `price_updates` artifact.

### Dual Clerk leftover
**Confirm as optional leftover.** Still in deps and CSP/proxy paths, but gated on both keys. Privacy/CSP still have to mention it when configured. Not a second identity authority for PUBMAXX User ID. Safe to leave dormant; do not wire a second login UX.

### Social gated / empty
**Confirm.** `lib/socialLaunch.ts` + `PUBMAX_SOCIAL_FRIENDS_LAUNCH`. Off → “Social preview” framing; adult gate still real. Empty feed while gated is expected, not a broken list.

### Today vs Tonight inconsistency
**Partially reject the “wrong source” claim.**  
`app/today/page.tsx` already calls `loadWhatsOn({ window: "tonight", ... })` and builds Top picks via `digestSectionPicks`. The V0 ask “fill Top picks from Tonight listings” is largely **already the architecture**. What still hurts is honesty when What’s-On is empty/degraded (`lib/dayGreeting.ts` / `readStatus`), and Out vs Tonight listing merge (`lib/tonightOutListings.ts`) — not a second invent-a-feed.

### Chrome / nav / 390px wordmark / consent pill
**Confirm as real friction, partially already instrumented.**
- Dual chrome: desktop `SiteNav` + phone `MobileTabBar` + `CreateFab` (by design, but easy to feel like “two apps”).
- Wordmark `hideWordmarkBelowPx` ≈ **361** in `SiteNav.tsx` (below that, mark-only).
- Consent pill lifts the float stack (`--consent-pill-lift` in `mobileNav.css`); geometry owned by `e2e/mobile-map-chrome-fit.spec.ts` / `__tests__/mobileChromeFit.test.ts`.
V0 item (5) “one chrome/nav” is still valid as product polish, not as “nothing exists.”

---

## 3. IMPROVE (existing surfaces — not new products)

Highest leverage **after** the stated V0 order (map draw → price write → Today honesty → Pal→Plan link → one chrome → crawls hygiene). These are reliability/UX on surfaces that already ship:

1. **Close the price-submit view→write gap**  
   Files: `app/api/price-submit/route.ts`, `lib/contributionIdentity.server.ts`, `components/map/VenuePriceSubmit.tsx`, `VenuePriceSignInGate.tsx`, `useContributionGate.ts`.  
   Why: PostHog shows opens without `price_submitted` or even `contribution_gate`. Measure 401 vs 409 vs abandon; shorten sign-in/`from=` return; make onboarding DOB requirement visible before the form feels broken. This is the real “Pint Drop never lands” adjacent problem.

2. **Name the three contribution lanes in UI + analytics**  
   Files: `lib/analyticsEvents.ts`, map sheet vs VisitReportPanel vs Pint Drop entry.  
   Why: Internal and PostHog confusion will keep sending Overnight Coders to the wrong route. Same copy, three stores = silent “0 writes.”

3. **Ops freeze observability**  
   Files: `lib/opsFreeze.ts`, visit-reports + social write routes.  
   Why: A frozen production env looks like “feature broken.” Surface `SOCIAL_FROZEN` in admin/health, not only 503 JSON.

4. **What’s-On degraded empty states on Today**  
   Files: `app/today/page.tsx`, `lib/dayGreeting.ts`, `lib/whatsOnStore.ts`.  
   Why: Top picks already share Tonight’s window; when the read fails, “Nothing left” vs “Could not check” must stay distinct (already partly owned — keep tightening, don’t rebuild).

5. **Stubbed `price_updates` honesty**  
   Files: `scripts/fetch_price_updates.mjs`, `data/freshness_registry.json`, freshness cron.  
   Why: A July stamp + empty array burns trust. Prefer “lane held / stubbed” in freshness language over a quiet stale artifact.

6. **Map WebGL / basemap recovery path**  
   Files: `webglRecovery.ts`, SW OpenFreeMap caching, `tokens.ts`.  
   Why: V0 (1) — pins are canvas; prove recovery and fallback in the field rather than guessing API misses.

7. **390px chrome fit (wordmark + consent + FAB)**  
   Files: `SiteNav.tsx`, `mobileNav.css`, existing e2e.  
   Why: Screenshot/PH trust; already measured — fix regressions, don’t invent a third nav system.

---

## 4. REMOVE (or hide)

| Target | Why |
| --- | --- |
| **Marketing Social as live** while `PUBMAX_SOCIAL_FRIENDS_LAUNCH` is off | Empty gated surface fights the PH screenshot. Keep route; stop promising a full network. |
| **`/founders` vanity emphasis** | V0 explicitly: no founders vanity. Page exists (`app/founders/page.tsx`). Belonging mark can stay on profile; the wall/door can stay quiet for non-founders (already the law) — don’t promote the page. |
| **Clerk as a visible second door** | Optional leftover is fine dormant. Remove from privacy/CSP copy and UI if keys are unset in prod; don’t delete the two-key gate until captain says so. |
| **Stubbed first-party `price_updates` as if it were a live feed** | Either delete from freshness alerting or mark held — don’t treat empty July JSON as city truth. |
| **Duplicate mental models of “Pint Drop”** | Not a file delete: stop calling visit-reports / price-submit / pint-drops the same thing in briefs and dashboards. |
| **gitDirty / tooling churn** | `next-env.d.ts` route-types drift, `allowScripts` — AGENTS.md already: checkout before commit. |

Do **not** remove crawl stop sibling tables or invent a stops column “fix.”

---

## 5. DO NOT ADD

Already shipped or explicitly out of V0 — do not restack:

- New city packs / multi-city splash  
- New tables “for growth”  
- Second auth (Clerk as primary, or anything else)  
- Blog / content engine  
- Founders vanity marketing  
- Referral **capabilities** (marks only — `lib/referrals.ts`)  
- Drinker paywalls / Stripe theatre  
- Twitter-for-pubs feed while Social is gated  
- Re-implementing `/api/crawls` stops-as-column  
- Rebuilding Today picks from a new source (already What’s-On tonight window)  
- Merging UK base pubs into the curated slim index  
- Money-saved deal counters (`lib/dealsHonesty.ts`)  
- Competing with LondonPubMap as a directory  

Home Cursor / Grok 4.6 may already be shipping map, contribution, or chrome work — verify open PRs before starting parallel lanes.

---

## 6. ADD (max 3 — only if they earn a place)

Grounded in holes in code/IA, **not** on the V0 list, **not** already first-class:

1. **Standing / garden / deal / Spoons (or chain) filters that already have signal paths**  
   Community venue signals + deals honesty exist (`lib/communityVenueSignals.ts`, `lib/dealsHonesty.ts`) but map filter UX is still price/persona-heavy. Mid-Aug London street context wants “where can we stand / garden / deal / Spoons” without a new dataset — wire filters to **existing** corroborated signals and deal rows. Cap scope: map + near, no new scrape.

2. **Honest city-price frame on the hero / share card**  
   Code already has about-stats and OG (`lib/homeOgCard.tsx`, `loadAboutStats`). Street narrative (£4 Soho deals vs ~£5.77 avg vs “eight quid” myth) needs one **sourced** line from live/bundled figures — not an inflation explainer page. Only if the figure is already derived; do not invent a fourth price lane.

3. **One sendable Plan link as the default share object**  
   V0 already has Pal → Plan → link. If that ships, the hole left is: make **that** link the primary share from Plan ready state (not a new product). Only list here if Plan share is still buried behind Social crew / soft-plan ambiguity after V0 (4).

If none of these clear the “hole in code” bar after V0 lands, ship **zero** adds.

---

## Verdict for Overnight Coder

Prioritise **map draw reliability** and **community price write completion** (auth/onboarding friction on `/api/price-submit`). Do **not** chase `crawl_stories.stops` or treat `price_submit_viewed` as visit-reports. Today already digests Tonight’s What’s-On — fix empty/degraded honesty, don’t rebuild. Clerk and founders are leftovers to quiet, not rebuild around. Freshness pain on `price_updates` is a **stubbed lane**, not a missing enrich timeout alone.

Success for this audit: improve / remove / do-not-add / add above — not a feature PR.
