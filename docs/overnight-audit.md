# Overnight Coder audit — Baby ORDER (19 Aug 2026)

**Repo:** Singularityszn/pubmax · **Not** karanmrn/pubmaxxing  
**Main tip inspected:** `dec149fb` (#1097)  
**Mode:** AUDIT ONLY. No product implementation. Collision risk highest on ORDER items **1, 2, 5** (home-terminal Cursor + grok 4.6).

---

## Collision note (leave alone)

No **open** PR titled as a Pint Drop / Today habit / map-reliability rewrite. Historical remotes still exist — do not stack:

| Risk | Branches (remote, leave) |
| --- | --- |
| 1 Visit / drops | `origin/lane/visit-reports` |
| 2 Today habit | `origin/codex/fable-today-diversity`, `origin/lane-m1-today-morning-check`, `origin/fm/today-server-budget`, `origin/perf/today-isr-and-core-dataset`, others |
| 5 Map | `origin/fix/map-search-overlay-fit`; recent main already has #1094 hold-until-paint, #1097 arrival |

This audit PR (#1106) is docs-only.

---

## ORDER — done vs still broken (verified in source)

| # | Baby ask | Verdict | Evidence |
| --- | --- | --- | --- |
| **1** | Finish Pint Drop. `/api/visit-reports` GET/POST. One-tap from pub sheet. | **Still broken / misframed** — do **not** implement here | **Pint Drop ≠ Visit Report.** Visit Report GET/POST are live (`app/api/visit-reports/route.ts` → `structured_visit_reports`). Pub sheet mounts `VisitReportPanel` on Overview + Story (`VenueOverviewTab.tsx`, `VenueStoryTab.tsx`) — peek/full composer, **not** a one-tap habit. Real Pint Drop write path is `/api/pint-drops` + `usePintDrops` / `VisitReportComposer` (photo/moment → `visit_reports` + Storage). First-drop **copy** invite is price (`lib/firstDropNudge.ts` → Log a price), not Visit Report. PostHog (~30d): write funnel ≈ 0. |
| **2** | Now habit: Tonight listings + one cheap pint into `/today` Top picks | **Done in source** — do **not** rewrite | `app/today/page.tsx` loads `loadWhatsOn({ window: "tonight" })` + `buildTodayPintsIndex`. `TodayClient.tsx`: “Top picks for tonight”, link to `/tonight`, `TodayPintsCard`. `lib/dayGreeting.ts` owns picks status / degraded copy. |
| **3** | Pal → Plan → send one link. #1096. No crew. | **Done** | `3d36237d` on main (#1096). Do not add crew. |
| **4** | One habit ping after first drop. `push_tokens` 0. | **Still broken** | Step Out weekly push exists (`lib/stepOutNudge*`, `/api/cron/step-out-nudge`). No first-drop → push wiring. `push_tokens` empty ⇒ no delivery. `firstDropNudge` is in-sheet price copy, not a push. |
| **5** | Map reliability. Client/WebGL + overlay diet. Pins must draw. | **Still open** — do **not** implement | Watchdog / WebGL recovery already in tree (`lib/mapPaintWatchdog.ts`, `webglRecovery.ts`). #1094 hold-until-paint shipped. Overlay diet + reliable paint still the live fight. Collision risk high. |
| **6** | One chrome. Same tabs everywhere. Fix 390px wordmark. | **Mostly done** | Same `PRIMARY_NAV_ITEMS` in SiteNav + MobileTabBar. Compact ≤640px bar + wordmark clip in `components/nav/siteNav.css` (no `overflow-x: clip` on `.siteNavBrand`). Re-proof at 390 if visual drift returns. |
| **7** | Consent pill reserve space | **Done** | `--map-corner-bottom-consent` in `components/nav/mobileNav.css`; map shell consumes it (`mobileMapShell.css`). Shipped with #1095 chrome lane. |
| **8** | `/out` desktop: group by venue, hide empty Open plans | **Partially done / still broken** | Open plans still shows `OUT_OPEN_PLANS_PLACEHOLDER_LINE` whenever the plans list is empty (`app/out/OutClient.tsx`, `lib/outListings.ts`) — does **not** hide empty. No “group by venue” in `components/out/*` / `lib/outListings.ts`. |
| **9** | `/api/crawls` must use `crawl_story_stops` not `crawl_stories.stops` | **Done — confirmed** | `lib/crawlStoryStore.ts`: `STOPS_TABLE = "crawl_story_stops"`; inserts stop rows there; lists count via that table. Comment: “stops live in crawl_story_stops, not on crawl_stories”. `app/api/crawls/route.ts` `body.stops` is POST JSON only → `readStops` → store; never a PostgREST column on `crawl_stories`. |
| **10** | Price freshness / date-stamp July baseline | **Still broken (honest-degraded)** | Overlay `public/data/drink_price_updates/prices_20260726.json`. Registry parsers stubbed → feed **unmeasurable** (`data/freshness_registry.json`). Surfaces can still look dated July without a true stamp path. |
| **11** | Bound enrich-city-pubs 120s timeout | **Done** | `app/api/cron/enrich-city-pubs/route.ts`: `export const maxDuration = 120;` |
| **12** | Do not add tables | **Policy hold** | Migrations through `0110`. Do not add tables for ORDER work. |

---

## Already done — do not redo

Login cold copy · `/admin` 401 (#1084) · ten city guides · Our story → `/about` · consent smaller · `/tonight` populated · Pal→Plan #1096 · `/pubs` “Chains (119)”.

---

## Still open (side list, not ORDER)

| Item | Source |
| --- | --- |
| `/our-story` `/story` 404 | No `app/our-story` or `app/story`; story lives at `/about` |
| Homepage drink chips no prices | `components/landing/LandingPage.tsx` — chips are drink-shape CTAs, not priced |
| `/founders` vanity | `app/founders/` — belonging wall, not a capability |
| Clerk in CSP | `proxy.ts` already adds `clerkCspSources()` when both keys set — proof/env still open |
| Sitemap flaky | `app/sitemap.ts` + pack tracing |
| gitDirty deploys | Ops / deploy hygiene (distinct from map paint “dirty”) |

---

## Improve / remove / add

### Improve (fix in place — not 1/2/5)

1. **ORDER #1 framing** — Keep three lanes: price (`/api/price-submit`) · Pint Drop (`/api/pint-drops`) · Visit Report (`/api/visit-reports`). Do not “finish Pint Drop” by renaming Visit Report. Paths: `lib/visitReports.ts`, `lib/pintDrops.ts`, `components/visits/VisitReportPanel.tsx`, `components/map/usePintDrops.ts`.
2. **ORDER #8** — Hide empty Open plans on `/out`; add desktop group-by-venue only if product still wants it. Paths: `app/out/OutClient.tsx`, `lib/outListings.ts`, `components/out/*`.
3. **ORDER #10** — Un-stub freshness parsers or refresh July overlay so “Checked” is measurable. Paths: `data/freshness_registry.json`, `public/data/drink_price_updates/`, `lib/freshness.ts`.

### Remove / do not do

- Parallel map / Pint Drop / Today rewrite while home-terminal owns 1, 2, 5.
- Merging Pint Drop into Visit Report because Baby used both names in one line.
- Crew on Pal→Plan (#1096 is one link only).
- New tables (ORDER #12). New Social, founders vanity expansion, blog, new city, second auth, karanmrn/pubmaxxing.

### Add (max 3 — not on ORDER)

1. **Redirect `/our-story` and `/story` → `/about`** — `proxy.ts` (or thin `app/` redirects). Stops 404 on the retired story URLs.
2. **Homepage drink-chip honesty** — `components/landing/LandingPage.tsx` (+ landing honesty fence if needed): chips must not imply listed prices they do not carry.
3. **First-drop habit ping (ORDER #4 adjacent)** — Only after `push_tokens` has a real registration path; wire one push off first successful drop/price, not a second nudge product. Paths: `lib/pushTokenStore.ts`, `lib/pushSender.ts`, drop/price success handlers — **leave if home-terminal claims #4**.

---

## Do not add (standing)

New Social · crew · founders product · blog · new city · second auth · new tables · work on karanmrn/pubmaxxing · parallel rewrite of 1 / 2 / 5.
