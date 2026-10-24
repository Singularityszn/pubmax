# AEO and SEO patch for 25 October

Issue: [#2349](https://github.com/Singularityszn/pubmax/issues/2349).

The source changes are ready for final validation. This report does not establish production launch readiness. Final local checks, browser evidence, hosted checks and merge remain pending.

## Baseline

The source base is `70283b8fa23043f142c18b092a8f8d2c07ec1aae`. Production reported that same commit and deployment `dpl_5cRQ5FGnGy8ZQGuQUXbsm7gqrN8D` on 24 October at 21:00 UTC.

[HTTP baseline](http-baseline.json) records completed response bodies, final URLs, status, canonical, robots, metadata and cache headers. These were ordinary HTTP requests without browser JavaScript. They did not emit browser analytics. Raw bodies remain in the local task evidence directory, `/Users/karanmanoharan/.codex/completion/launch-aeo-1024/baseline/`.

| URL | Result | Publication state |
| --- | --- | --- |
| `/` | 200, self-canonical | Indexable. The document inherited the map-only root title and description. |
| `/about` | 200, self-canonical | Indexable. |
| `/today` | 200, self-canonical | Indexable. Absent from the sitemap under the existing date-policy decision. |
| `/tonight` | 200, self-canonical | Indexable and in the sitemap. Recommendations remain separate from confirmed events. |
| `/crawls` | 200, self-canonical | Indexable. Named routes already render in completed HTML. |
| `/pint-index` | 200, self-canonical | `noindex, follow`. Absent from the sitemap while its publication gate is closed. |
| `/out` | Redirects to `/tonight` | No separate sitemap entry. This is the current merged route policy. |
| `/area/soho` | Redirects to `/map?area=piccadilly-soho` | No area-root sitemap entry. The map keeps its canonical. |
| `/robots.txt`, `/llms.txt`, `/sitemap.xml` | 200 | The sitemap contains 2,651 URLs in this dated capture. |

PRs #2135, #2229, #2239 and #2241 are merged. Their rendering, title and average work is retained. The founder identity correction from #2346 is also on the base.

## Changes and evidence owners

| Finding | Result |
| --- | --- |
| The FAQ omitted directory sources and promised a date for every price. | It now names menus, directories and drinker reports. Read days remain conditional. |
| The Listed tooltip called every publisher a pub or chain. | It now identifies a public source without asserting who owns it. Community confirmation remains separate. |
| A source retrieval day could read as a price observation. | The hero says `source read`. An absent read day says `read day not recorded`. |
| The landing average did not name its population. | It now names each priced pub's cheapest listed pint and the recorded London sample. The comparison is a gap, without a promised saving. |
| The homepage inherited a map-only document head. | It now owns its title and description, including planning with friends and sharing routes. |
| Product descriptions did not explain accounts. | Visible FAQ and About text explain anonymous browsing and device saves, plan invites, account sync and contributions. |
| WebSite description lacked the friends-and-sharing story. | It shares its description with visible About text. Stable entity IDs and aliases remain intact. |
| The issue reported founder links on the Organization. | Already fixed on the base. Personal profiles belong to the founder Person. [Captured graph](schema-before.json). |
| Search bots without named groups could be misunderstood as blocked. | Tests exercise Next's emitted robots document for Googlebot, Bingbot, OAI-SearchBot, Claude-SearchBot and PerplexityBot. |
| Cached Today and Tonight HTML can be old. | Both pages show their preparation time separately from source dates. Existing cache rules remain in force. |
| The launch crosses London's clock change. | Added midnight and repeated-hour cases. Existing service-day cache-boundary tests remain the owner of Tonight cache rollover. |

`lib/siteProductCopy.ts` owns the description shared by site identity and visible About copy. Homepage metadata and its image share the same derived heritage count. `llms.txt` retains the separation between the map baseline and eligible public Index observations.

The existing vocabulary remains `confirmed`, `listed`, `estimate` and `none`. A named directory is its own publisher. Its listing does not establish venue ownership, community confirmation or public Index eligibility. Price ranking and Index admission retain their existing deciders.

| Evidence case | Executable owner |
| --- | --- |
| Official menu publisher and its read day | `landingHero.test.ts` |
| Directory publisher, stale listing and unknown publisher or day | `landingHero.test.ts`, `landingHeroPriceCopy.test.ts` |
| Corroborated community price and provisional single report | Existing `venuePriceLane.test.ts` and `lonePintDropLane.test.ts` |
| Source and description in server-rendered public text | `landingFaq.test.ts`, `aboutPintIndexStory.test.ts`, `homepageIdentity.test.ts` |
| Public/private bot matrix and preview exclusion | `robotsPreviewNoindex.test.ts` |
| London midnight and both 01:30 instants | `landingAnswersServer.test.ts`, `todayGreetingClock.test.tsx`, `preparedBriefStamp.test.tsx`, `whatsOn.test.ts` |
| Warm Tonight cache at the service-day boundary | Existing `whatsOnTonightPublicReuse.test.ts`, `whatsOnTonightRolloverRace.test.ts` |

## Date and cache limitation

The baseline reproduced `x-vercel-cache: STALE` on Today with age 7,621 seconds and Tonight with age 860 seconds. The page-preparation stamp dates the rendered page. It does not advance a weather, price or listing observation.

Today's browser clock still updates its greeting after hydration. The preparation timestamp remains tied to the original page. A global expiry change, CDN removal, scheduled revalidation or forced client refresh remains a separate decision from this patch.

## Crawler access and schema limits

The robots matrix checks document access, not index eligibility or authentication. Pint Index publication, private data permissions and held area roots retain their current gates. Training and user-fetch permissions retain their existing settings.

Genuine search-crawler access is unverified. The connected Vercel observability schema endpoint returned 404. The active firewall endpoint for the linked production project returned `Seawall Config not found`. The Vercel CLI is absent from this environment. These responses do not prove that a crawler is blocked or allowed. An ordinary request or spoofed user agent cannot supply that proof.

The graph retains WebSite, Organization and the existing AboutPage relationship. It adds no reviews, ratings, offers, recommendation events or FAQ markup. Google's [AI feature guidance](https://developers.google.com/search/docs/appearance/ai-features) requires no special AEO schema. The [Organization guidance](https://developers.google.com/search/docs/appearance/structured-data/organization) and [supported feature gallery](https://developers.google.com/search/docs/appearance/structured-data/search-gallery) informed the schema review.

## Final validation record

| Check | Current result |
| --- | --- |
| Source whitespace and patch check | Passed during implementation. |
| Configured no-mistakes local checks | Pending the agreed validation slot. |
| One production build and focused browser journeys | Pending the agreed validation slot. |
| Completed local HTML and JSON-LD validation | Pending that production build. |
| Mobile and desktop layout and page timings | Pending the focused browser pass. Existing performance ceilings remain in force. |
| Hosted checks and final review | Pending publication. |
| Production version after an approved release | Outside this merge task. No deployment was started here. |

Earlier checks against `4d6386974` do not validate the later source changes. They will not substitute for the final gate. The configured local planner selects the required scope. Hosted CI owns its full suite. The browser pass uses one local build and one worker, with no separate duplicate build.

Rollback is a revert of the source and copy patch. It requires no data rewrite, migration, crawler permission change or new external service.
