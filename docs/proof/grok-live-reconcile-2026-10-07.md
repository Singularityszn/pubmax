# Grok live review reconciliation, 7 October 2026

This batch fixes eight reproduced defects. It preserves the existing price records and leaves the production release under the captain's decision.

## Source and deployment

The supplied review describes production at `2290063` on 6 October, around 07:55 BST. That identity is historical.

At inspection, the live version endpoint identified `dpl_C1QdeoW5TgJucYhv9uca4ZYA2GnX`. Vercel identifies its source as CLI and its commit as `0c442d44bf97ec14bd240f7b41ef68437cf9627a` (#2042).

The patch starts from `origin/main` at `3bc62e232be88dcbfa564ecb01970aba68afa9de`. At inspection, main was eight commits ahead of production.

Vercel reports the latest main production attempt, `dpl_9RgG1n4yRNtY6CrbCan9bLt4fUjK`, as `CANCELED`. Its error link names the ignored-build step. It entered and left that state at the same timestamp. No compilation error was reported. The connector did not expose the configured command.

## Reproduced defects and fixes

| Finding | Before | After | Evidence |
|---|---|---|---|
| Price flash | A delayed selected-pub read displayed `est. £6.50` before a £4.70 fixture record. | The mobile peek and Overview show `Checking prices…` until fallback reads settle. An observed price remains available during refresh. | Rendered helper tests and a delayed-response browser regression. The fixture pub is Princess Louise, not current Hatton data. |
| Search pin loss | Typing removed venues from the canvas while the camera and field remained active. | The canvas retains query-independent membership during search. Other filters remain active. | The phone browser test checks membership after every character and checks that the camera stays still. |
| UK legacy routes | Both live `/map/uk` and `/map/uk/1` showed the 404 page. | Both redirect with 308 to the existing national map at `/map?uk=1`. | Redirect tests and browser inspection of the national map. |
| Bare map restores a pub | Visiting a selected pub, leaving for Today, and returning to `/map` reopened that pub. | The map restores its viewport and filters. It opens a pub only when the incoming URL selects one. | The rendered phone journey returns to a bare map without a sheet, then opens an explicit deep link. |
| Tonight quiet claim | Pub recommendations appeared above `Quiet night` and the city-wide quiet sentence. | No event rows produce event-scoped copy beside recommendations. The footer says `More ways to plan tonight`. | A hydrated Tonight regression test. |
| Create action covers a recommendation | At 390×626, the + button covered Devonshire description text. The combined build also showed it over the Today weather card title and empty-state sentence. | Recommendation cards and the Today weather card reserve the existing create-action lane. | Browser text rectangles show one overlapping description before and none after. The regression also checks 320 and 430 pixels. The Today regression checks weather text clearance. See the [Today record](grok-today-parity-2026-10-07.md). |
| Today omits sourced pub suggestions | Today showed an empty-event line while Tonight recommended sourced pubs. | Today reuses Tonight’s suggestions when no event picks exist and none were excluded by filters. | The rendered regression and production phone journey compare pub names, source links, and the Day segment. See the [Today record](grok-today-parity-2026-10-07.md). |
| Ambiguous listing counts | The map said `On tonight`, and Out did not explain its map-linked subset. The longer replacement label initially truncated at 320 pixels. | Both map chips say `Tonight listings`. Out names listings shown and accepted venue links when matching is available. The phone label wraps. | Read-only reproduction, 84 focused tests, and phone geometry checks. See the [count record](grok-count-clarity-2026-10-07.md). |

The independent standards review found a non-pub loading regression in the first patch. A rendered café test reproduced it. The pending price label now applies only to pubs. The search filter policy also moved into `lib/pubMap.ts`.

The publication review found repeated pin filtering during typing and duplicated loading copy. The pin pipeline now memoizes every non-query filter, and both price surfaces use one shared pending line. These corrections passed 216 focused tests.

## Other findings

| Finding | Current evidence | Status |
|---|---|---|
| Signed-in confirmation write | Existing confirmation rules and composer tests remain intact. No authenticated hosted-preview write ran in this batch. | Untested on hosted preview. |
| Provider-backed Today and Tonight listings | Shared event helpers and sourced suggestions are covered locally. | Provider-backed rendered parity remains a preview check. |
| Day navigation | Today renders `NowSegment current="day"`. The primary Tonight destination deliberately owns both Today and Tonight in `navigationModel.ts`. | Current design retained. |
| Area-updates toast | Main already moved map search failures into the search panel. Remaining area-news unavailable text belongs to its own rail or section. | The phone area-pick regression passed with `/api/area-news` returning 503. No unavailable message was visible. |
| Search result and close button | The current selection path opens a sheet. | Existing behavior retained. A further live verification is not claimed. |
| Hatton price records | The live read returned two records, £4.70 and £4.50. | Read-only check passed. No records or trust labels changed. |
| Hatton Camden and Holborn | `primaryBorough` represents the administrative borough. Holborn represents the neighbourhood. | No venue data rewrite. |
| Tonight and Out supply | The map counts expanded What's-On rows. Out serves a different provider set and day window. | Caps and data selection remain unchanged. The labels now state their denominators. |
| Out venue honesty | Existing venue acceptance and unmatched-row tests passed in full verification. | No new live matching claim. |
| Drinks below the fold | The sheet retains its explicit Drinks tab and sourced record count. | No layout change in this batch. |
| Public version SHA | `app/api/version/route.ts` deliberately protects commit and build fields with cron authorization. Public clients receive the deployment ID. | Existing boundary retained. Vercel supplied release identity. |
| External `cut_check` | The review references files under `/workspace`. Those files and its scorer are absent from this workspace. | Unavailable source. No invented scoring change. |

## Validation

The local app uses a private port and `.next-prod`. It has no production credentials. Browser fixtures intercept reads only.

- `npm run verify` passed before the reviewer corrections. It included 21,003 unit tests, 554 PostgreSQL tests, and 10 harness tests.
- The reviewer corrections and existing UI fences passed 197 focused tests.
- The production build passed after the original six fixes. Each feature lane also passed its own production build.
- Five production-build phone regressions passed together, including the bare-map journey and area-news failure.
- The combined production build and expanded phone regression set run before publication. Their final result is recorded with the PR.
- The final publication gate reruns full verification on the committed head. Its result and CI status are recorded with the PR.

Screenshots and scripts remain under `artifacts/grok/`. The pull request carries the relevant visual captures. The original review's `/workspace` screenshots were not available here.

## Release boundary

GitHub publication and hosted-preview readiness are separate results. A signed-in preview confirmation and provider-backed Today parity remain separate acceptance work. This batch does not merge or promote production. The [preview acceptance record](grok-preview-acceptance-2026-10-07.md) states the protection and data conditions.
