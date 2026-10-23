# SEO audit #2126: evidence matrix, 17 October 2026

Issue: [#2126](https://github.com/Singularityszn/pubmax/issues/2126), the 15 October 2026 search audit.
Baseline: `main` at `1284c1f3` (after #2196). Earlier matrix: `docs/proof/seo-audit-2026-10-16.md` on open PR #2135, taken at `2aee35d2d` before #2128 folded `/out` into `/tonight`.
This matrix re-checks every claim against current `main` and records what changed since then.

## How the evidence was taken

- **Local production build** of `1284c1f3`, built with `NEXT_DIST_DIR=.next-prod PUBMAX_TRACKED_OUTPUTS=public/data` and served on private port 3976 with `VERCEL_ENV=production`, so the proxy sends no preview `X-Robots-Tag`. `robots.txt` was prerendered at build time without `VERCEL_ENV`, so the local file says `Disallow: /`. That is the documented preview behaviour, not a production defect.
- **Initial HTML**: `curl` per route, once with a desktop Chrome user agent and once with a Googlebot user agent, with status, headers and body saved separately (`http-status-main.txt`). Both agents received identical bodies on every route once the per-request CSP nonce is removed; the nonce is the only difference, and only on the routes that carry one.
- **Hydrated DOM**: Playwright Chromium at 390 px, once with JavaScript (6 s settle) and once without. Title, H1, canonical, robots meta, visible text length and `Loading…` placeholders were recorded per route.
- **Sitemap-wide title scan**: every one of the 2,687 `<loc>` URLs fetched from the local build, with `<title>`, `og:title`, canonical and robots meta extracted.
- **Production**: one `GET /api/version` and two single `GET /today` reads, plus one `GET /tonight` (`production-today-held-copy.txt`). Production answers deployment `dpl_72wRDnp979oNf4kGotREGiKFHZkk`, which #2196 identifies as `85512d7` (#2063), so `main`'s later fixes are not deployed. No load test, no provider sweep and no analytics traffic were generated.
- **Not available**: Google Search Console, URL Inspection, a rank tracker and the production database. Every claim that needs one of them is marked `blocked by access`.

## Matrix

| # | Audit claim | Classification | Reproduction and evidence | Owning code |
| --- | --- | --- | --- | --- |
| 1 | Strong Camden price visibility; weaker generic price, neighbourhood, station, event and crawl queries | Blocked by access | No GSC export or controlled rank history. Search-result order from a research tool is not a Google ranking. | n/a |
| 2 | Pages newly indexed | Blocked by access | A crawl timestamp is not indexation. Needs URL Inspection. | n/a |
| 3 | Today/Tonight showed 14 Oct on 15 Oct; another snapshot showed 8 Sep | **Confirmed defect, fix needs a captain decision** | Production `/today` at 15:01 London answered `x-vercel-cache: STALE`, `age: 13539`, rendered 11:15, greeting **"Good morning. Saturday 17 Oct."** The next read got "Good afternoon". `revalidate = 300` bounds how often a copy *may* regenerate, not how old the served copy can be: Next's default `expireTime` is one year (`Cache-Control: s-maxage=300, stale-while-revalidate=31535700`; the build table prints `/today 5m 1y`), so the first reader after a quiet period gets the copy from the previous visit. A quiet period over midnight prints yesterday's date. The page comment ("Five minutes bounds how far a held copy can lag") is wrong. The 8 Sep snapshot is a search-engine cache and cannot be reproduced. Timezone handling is correct: `formatConditionDate` and `londonDayKey` use `Europe/London`. See decision D1. | `app/today/page.tsx`, `app/tonight/page.tsx`, `proxy.ts` `CDN_CACHED_DOCUMENT_PATHS`, `next.config.mjs` |
| 4 | October borough snapshots look stale | Intentional behaviour | `/borough/camden` prints "a snapshot from 2 October 2026", the collection date. A render date must never replace an observation date. Open #2194 dates the borough average by the reads it averages. | `app/borough/[slug]/page.tsx`, `lib/pintFacts.ts` |
| 5 | Tonight's listings appeared as loading placeholders to a crawler | Confirmed defect, **covered by open #2135** | No-JS `/tonight`: 530 visible characters and "Loading listings". With JS it settles. Recommendations are in the HTML. #2135 server-renders the listings but needs rework onto `/tonight` after #2128 (owner decision pending on #2135). | `app/tonight/TonightListingsNotice.tsx`, `app/tonight/TonightClient.tsx` |
| 6 | Out shows only a listings placeholder | Superseded on `main` | `/out` now answers 308 to `/tonight` (#2128), so it has no page, canonical or sitemap row. Out's indexing restriction is now stricter than noindex. | `lib/outRoute.ts`, `proxy.ts` |
| 7 | Dated event inventory is thin | Blocked by access or supply | Keyless `/api/out` reports `skiddle:not-configured`, `ticketmaster:not-configured`. That cannot prove production supply. No new collection is authorised by the audit. | `lib/out/loadOut.ts` |
| 8 | Tonight should lead with events | Intentional behaviour | #1614: pubs people are talking about first, labelled chain deals below. Preserved. | `app/tonight/` |
| 9 | Pint Index fetch returned 503 | Unreproduced | Both agents: 200, 98 KB, 0.55 s cold. A research tool's failed fetch is not an origin outage. | `app/pint-index/page.tsx` |
| 10 | Pint Index title duplicates PUBMAXX and says "public data status" | Confirmed defect, **covered by open #2135** | `The London Pint Index public data status · PUBMAXX \| PUBMAXX`. | `app/pint-index/page.tsx` |
| 11 | Pint Index serves stale July/August wording | Intentional behaviour | The July dates are cited third-party sources (The Morning Advertiser, 23 July 2026; ONS, 21 July 2026). The open-month line names October 2026. | `app/pint-index/PintIndexScreen.tsx` |
| 12 | Pint Index absent from the sitemap | Intentional behaviour | `robots: noindex, follow` and no sitemap row until the live snapshot meets `pintIndexMeetsAdmissionFloor`. The frozen June 2026 edition is listed. | `app/sitemap.ts` |
| 13 | `/crawls` title and H1 do not say "London pub crawl routes" | Confirmed defect, **covered by open #2135** | Title `Crawls worth walking \| PUBMAXX`; H1 `Pub stories mapped into walks.` | `app/crawls/page.tsx` |
| 14 | Crawl content not crawlable | Confirmed defect, **covered by open #2135** | No-JS `/crawls` shows 0 visible characters (Suspense fallback). The initial HTML does contain the four named routes. | `app/crawls/CrawlsPageClient.tsx` |
| 15 | "Free" and "self-guided" in the crawl title | Product decision needed | The page makes neither claim today. See D4. | `app/crawls/page.tsx` |
| 16 | Victorian Soho, Camden Market, Borough Market, Fleet Street routes missing | Already present as map routes; dedicated pages need a decision | All four are in the `/crawls` HTML with ordered venue IDs (`lib/curatedCrawls.ts`). `/crawls/[slug]` belongs to user stories. See D4. | `lib/curatedCrawls.ts` |
| 17 | Neighbourhood and station pages missing | Product decision needed | `/area/soho` and `/area/shoreditch` answer 404, as the hold requires. `/area/piccadilly-soho/drink/guinness` answers 200 in the approved family. See D3. | `app/area/` |
| 18 | Robots or sitemap discovery broken | Already fixed for share-card images (#2196, merged); otherwise unreproduced | Sitemap: 2,687 URLs (2,214 ledger, 342 historic, 34 landmark, 33 borough, 20 drink, 14 area/drink, 11 city maps, hubs). No `/out`, no standalone `/area/{slug}`, no live Pint Index. `/today` is self-canonical and indexable but has no sitemap row. See D1. | `app/robots.ts`, `app/sitemap.ts` |
| 19 | (found here) Every document title doubles the brand | **Confirmed defect, fixed in slice A** | 2,629 of 2,687 sitemap URLs: `The Ledger: The Greyhound. PUBMAXX \| PUBMAXX`, `Tonight in London · PUBMAXX \| PUBMAXX`, `… · PUBMAXX \| PUBMAXX` on every borough, historic and landmark page. Production prints the same doubling (`Tonight in London · PUBMAXXING \| PUBMAXX`). After slice A: 1 (`/about`, whose subject is the brand). | 12 page files, root `title.template` |
| 20 | (found here) 188 duplicate ledger titles | Product decision needed | 562 ledger pages share 188 titles after slice A, because distinct pubs share a name (`The Ledger: The Greyhound` x8). See D5. | `app/ledger/[id]/page.tsx` |
| 21 | "Maruquis of Cornwallis" duplicates "The Marquis of Cornwallis" | Confirmed identity candidate, **covered by open #2187** | `venue-j71x23` (street-only address, 657 m straight-line from the pub) and `venue-1eyb3zz` (304 Bethnal Green Rd, OSM way/1059879142). #2187 folds the verified pair in the build. | `scripts/lib/venueCanonicalization.mjs` |
| 22 | Multiple Three Colts Tavern records | Confirmed identity candidate, dry run only | See the dry run below. Not covered by any open PR. See D6. | `scripts/lib/venueCanonicalization.mjs` |
| 23 | £5.54 versus £5.72 average pint | **Confirmed labelling defect, fixed in slice B** | Both are correct, over different cohorts. Landing: mean of each pub's cheapest pint over 950 pubs (`lib/pintSavings.ts`). About: mean of all 2,785 readings (`lib/aboutStats.ts`). About printed a bare "The average is £5.72". | `app/about/page.tsx` |
| 24 | 298 versus 342 historic pubs | Intentional behaviour | 298 is the pubs drawn in the landing map (`LONDON_MAP_PUB_COUNT`, fenced by `__tests__/landingMapSnapshot.test.ts`). 342 is the cited historic-pub cohort (`loadAboutStats`). The landing sentence says "on one map, with 298 historic pubs marked". | `components/landing/londonMapGeometry.ts` |
| 25 | Different substantive content for crawlers | Unreproduced | Ordinary and Googlebot requests received identical bodies on all 16 routes, apart from the per-request CSP nonce. | `proxy.ts` |

Hydration: no React hydration error on any route. The only browser console errors were local 503s from `/api/tonight-conditions`, which needs the weather store this keyless build does not have.

## Venue identity dry run

No record was modified, merged or deleted.

| Pair | Record | Address and point | Finding |
| --- | --- | --- | --- |
| Three Colts | `venue-1g0y58p` "The Three Colts Tavern" | 199 Cambridge Heath Rd, E2 0EL; 51.5248, -0.0548784 | Has an OSM match (`data/osm/uk/uk_osm_pubs.json`), a website and UK price rows. |
| Three Colts | `venue-1s1ffqx` "Three Colts Tavern" | "E2 0EL" only; 51.5262, -0.0556257 | Postcode-only address, same postcode, 164 m straight-line from the other point. Appears in `venues_slim` and the discover board. No OSM match. |
| Cornwallis | `venue-j71x23` "Maruquis of Cornwallis" | "Bethnal Green Road"; 51.5242, -0.0732748 | Covered by #2187. |
| Cornwallis | `venue-1eyb3zz` "The Marquis of Cornwallis" | 304 Bethnal Green Rd, E2 0AG | Covered by #2187. |
| Cornwallis | `venue-7gowhv` "The Marquis Cornwallis" | 31 Marchmont St, WC1N 1AP | A different pub. Not a duplicate. |

Distances compare stored points, not walking routes. Production references (plans, crawls, saves, memories) live in Supabase and were not read: `blocked by access`.

## Measurement baseline

`Blocked by access`: no authorised GSC property access in this session. Export checklist:

1. Authorised read access or an export for the verified `https://pubmaxxing.com` property.
2. Query and page performance for the same two 28-day periods, one device and country filter, search type Web. Keep six query groups apart: branded, price, neighbourhood, station, event, crawl.
3. URL Inspection for one canonical per family (`/`, `/today`, `/tonight`, `/borough/camden`, `/drink/guinness`, `/area/piccadilly-soho/drink/guinness`, `/crawls`, `/pint-index/2026-06`, one `/historic`, one `/ledger`). Record inspection time, verdict, Google-selected canonical and last crawl separately.
4. Record the deployment ID beside the export. Slice A's title change reaches Google only after a deploy and a recrawl.

GSC average position is an aggregate, not a rank.

## Slices

- **A, titles:** #2239 (`claude/seo-2126-single-brand-title`). 12 page families stop typing the brand; a TypeScript-AST fence over `app/**` holds the rule.
- **B, About average:** #2241 (`claude/seo-2126-about-average-cohort`). The About sentence names its 2,785 readings.

## Decisions for the captain

- **D1, held copies of `/today` and `/tonight`.** Each fix trades against a standing decision, so none was built. (a) Set `expireTime` in `next.config.mjs` (for example 3,900 s): a copy is then at most about an hour old, but every ISR page, including the 445 SEO pages the 15 Oct CDN task cached, renders in-request after an idle hour. (b) Take `/today` and `/tonight` off `CDN_CACHED_DOCUMENT_PATHS` and render per request with the nonce (reverses "Widen" for those two). (c) Revalidate both paths on demand from an existing scheduled job. (d) A client guard that reloads a copy older than its window; `lib/routerCacheFence.mjs` refuses `router.refresh()`, so this needs an argued exception, and it fixes people but not a crawler without JavaScript. Adding `/today` to the sitemap should wait for this decision, because today it would invite crawlers to a copy that can be hours old.
- **D2, `/pint-index`, `/crawls` and Tonight listings.** Covered by #2135, which waits on its owner decision (rework onto `/tonight` after #2128).
- **D3, neighbourhood and station pages.** `/area/{slug}` stays held. The proposal in #2135's matrix (station family with a publication floor and measured proximity) still stands and belongs with #1522 and #1576/#1581.
- **D4, editorial crawl pages and "free, self-guided".** Needs a namespace that cannot collide with `/crawls/[slug]` user stories, row-owned price dates and no walking figures until routed.
- **D5, duplicate ledger titles.** Add the area to the ledger title (`The Ledger: The Greyhound, Battersea`) so 188 same-name pubs stop sharing one. A copy change, so it needs a yes.
- **D6, Three Colts reconciliation.** Confirm `venue-1s1ffqx` is the same pub and add it to `VERIFIED_MISPLACED_RECORDS` (the #2187 seam) after a production reference check.
- **D7, deploy.** Production serves `85512d7`; #2196 and both slices reach users only after a deploy.
