# Performance budgets

Speed is the promise this product makes. A promise nobody counts is a wish, so
every budgeted route has a number, the number is tracked in the repository, and
CI refuses a change that goes past it.

- The ceilings: [`perf/route-budgets.json`](../perf/route-budgets.json). Every route the site serves a stranger, all 34
- The pawl on the ratchet: [`scripts/check-budget-ratchet.mjs`](../scripts/check-budget-ratchet.mjs), which refuses a ceiling taken up against the base branch without a record
- The rules and the failure table: [`lib/performanceBudgets.ts`](../lib/performanceBudgets.ts)
- The measuring: [`e2e/performance-budget.spec.ts`](../e2e/performance-budget.spec.ts)
- The method both perf specs share: [`e2e/helpers/perfMeasurement.ts`](../e2e/helpers/perfMeasurement.ts)
- The UX lane report: [`e2e/ux-lane-perf-verification.spec.ts`](../e2e/ux-lane-perf-verification.spec.ts). Four arrival routes (`/`, `/near`, `/map/london`, `/out`) with LCP and CLS beside decoded JS, written as a markdown table for the PR body. It REPORTS: a route over a ceiling here is a warning, and the only failure is a route it could not measure at all
- The gate: the `performance-budget` job in `.github/workflows/ci.yml`; the UX lane report is its own `ux-lane-performance` job, because one 15-minute wall cannot hold two full sweeps
- The API gate: the `api-latency-budget` job in `.github/workflows/api-performance.yml` probes a successful main deployment

## What each metric means

| Metric | What it is | Why this one |
| --- | --- | --- |
| `serverRenderMs` | `responseStart - requestStart` on the document's own navigation entry | Over loopback there is no network in that figure, so it is the part of a production TTFB the code owns. |
| `jsDecodedKB` | Decoded bytes of every same-origin script the route asked for before it was interactive | Decoded, not transferred, because parse time is what a phone feels. |
| `requests` | Same-origin requests to the same point, the document included | A route can hold its bytes and still lose the night to a waterfall. |
| `lcpMs` | The largest contentful paint the SAME run observed, from a buffered `PerformanceObserver` | The three above are levers; this is the one a drinker feels, and a route can hold every lever and still paint late. |

## Where the ceilings came from

Seeded on 2026-09-04 from one sweep on a production build of `main` at `4f36f2547`,
under the method above: the same method CI enforces, over the tracked Fast 4G
profile rather than loopback. Measured figure first, ceiling second:

| route | server render | JS decoded (KB) | requests | LCP (ms) |
| --- | --- | --- | --- | --- |
| `/` | 4 / 150 | 875 / 1010 | 40 / 46 | 576 / 1500 |
| `/pal` | 7 / 150 | 1163 / 1300 | 44 / 51 | 1256 / 1500 |
| `/map` **over** | 6 / 150 | 2985 / 3400 | 331 / 160 | 980 / 1500 |
| `/today` | 11 / 150 | 919 / 1060 | 45 / 52 | 208 / 2500 |
| `/tonight` | 8 / 150 | 931 / 1080 | 52 / 56 | 196 / 2500 |
| `/out` | 7 / 150 | 871 / 1010 | 42 / 49 | 528 / 2500 |
| `/about` | 8 / 150 | 833 / 960 | 37 / 43 | 256 / 2500 |
| `/pubs` | 14 / 150 | 1091 / 1200 | 59 / 68 | 296 / 2500 |
| `/webmcp` | 6 / 150 | 869 / 1000 | 38 / 44 | 172 / 2500 |
| `/near` | 7 / 150 | 976 / 1130 | 45 / 52 | 164 / 2500 |
| `/login` | 7 / 150 | 826 / 950 | 34 / 40 | 168 / 2500 |
| `/signin` | 6 / 150 | 826 / 950 | 34 / 40 | 184 / 2500 |
| `/plan` | 7 / 150 | 1013 / 1170 | 41 / 48 | 180 / 2500 |
| `/pal/chat` | 6 / 150 | 896 / 1040 | 40 / 46 | 176 / 2500 |
| `/social` | 11 / 150 | 978 / 1130 | 48 / 56 | 220 / 2500 |
| `/feed` | 7 / 150 | 978 / 1130 | 48 / 56 | 184 / 2500 |
| `/discover` | 12 / 150 | 978 / 1130 | 48 / 56 | 268 / 2500 |
| `/drinks` | 12 / 150 | 978 / 1130 | 48 / 56 | 268 / 2500 |
| `/messages` | 6 / 150 | 838 / 970 | 38 / 44 | 576 / 2500 |
| `/activity` | 7 / 150 | 847 / 980 | 39 / 45 | 176 / 2500 |
| `/u/you` | 7 / 150 | 1120 / 1290 | 57 / 66 | 668 / 2500 |
| `/onboarding` | 6 / 150 | 831 / 960 | 35 / 41 | 640 / 2500 |
| `/choose-city` | 7 / 150 | 822 / 950 | 33 / 38 | 204 / 2500 |
| `/moment` | 10 / 150 | 852 / 980 | 37 / 43 | 232 / 2500 |
| `/rounds` | 7 / 150 | 833 / 960 | 38 / 44 | 184 / 2500 |
| `/crawls` | 9 / 150 | 885 / 1020 | 39 / 45 | 220 / 2500 |
| `/borough` | 54 / 150 | 833 / 960 | 38 / 44 | 244 / 2500 |
| `/historic` | 31 / 150 | 835 / 970 | 38 / 44 | 260 / 2500 |
| `/pint-index` | 34 / 150 | 856 / 990 | 39 / 45 | 296 / 2500 |
| `/founders` | 9 / 150 | 833 / 960 | 38 / 44 | 188 / 2500 |
| `/contributors` | 6 / 150 | 833 / 960 | 37 / 43 | 176 / 2500 |
| `/we-are-out` | 6 / 150 | 837 / 970 | 38 / 44 | 176 / 2500 |
| `/privacy` | 7 / 150 | 788 / 910 | 32 / 37 | 212 / 2500 |
| `/terms` | 6 / 150 | 788 / 910 | 32 / 37 | 184 / 2500 |
| `/places` | 6 / 150 | 861 / 1000 | 40 / 46 | 188 / 2500 |

One headroom rule, applied to every route the same way: 15% for bytes and
requests, 20% for LCP, and a 150 ms or 450 ms family floor for server render.

Two exceptions, both in the tightening direction. Where the measurement already
met a **tighter** existing ceiling, the tighter one stands. Where the measurement
is **over** an existing ceiling, the ceiling still stands and the sweep reports
the breach. Nothing here was loosened to fit a measurement.

`/` and `/map` take the speed programme's own 1500 ms LCP target because they are
the front door and the product. Every other route takes 2500 ms, the Core Web
Vitals good boundary, so no route may be worse than good. Every route now meets
its LCP ceiling.

Production RUM corroborates the lab figure independently: `onLCP` already
reports through `lib/webVitals.ts` and the consent-gated `web_vital` event
(`components/PerformanceVitals.tsx`), rounded and route-patterned, carrying no
identifier.

## The regression the rig caught on its first sweep

`/map` asked for **331 requests** before it was interactive, against a ceiling of
**160**. The ceiling was not raised. The cause was found and fixed, and the route
now measures **125**.

| | requests | LCP |
| --- | --- | --- |
| before the map camera work | 148, 149 | - |
| after it | 327, 331 | 980 ms |
| after the fix | **125** (samples 147 / 125 / 125) | **576 ms** |

**What it was.** 243 of the 245 shard requests arrived inside one 250 ms burst,
while the settled camera was an ordinary zoom 12 city view - so it was one read
asking for the whole grid, not a camera wandering. Instrumenting `shardsForBounds`
named it exactly: `inBounds` was being called twice, at ring 0 and ring 1, with
bounds spanning **-7.99 to 1.19 and 49.8 to 61.0**. That is the United Kingdom,
and it is `UK_BOUNDS`, the canvas's own `maxBounds`. MapLibre reports `maxBounds`
as the visible bounds until the camera settles on the city, so a cold `/map`
briefly says it is looking at the whole country, and the shard ring took it
literally: all 244 London cells, twice, before the map was interactive.

**Why the existing guard did not catch it.** `viewportNamesNowhere` guards the
PLACEHOLDER the map holds while the location question is open - centre `[0, 0]`
at zoom 0. UK-wide bounds are a real centre at a real zoom, so they pass it.

**The fix is that same rule applied to the bounds.** `boundsNameNowhere`
(`lib/slimShards.ts`) refuses a shard read from bounds wider than
`SHARD_READ_MAX_SPAN_DEGREES`, an order of magnitude above any real city view, and
`components/PubMap.tsx` drops such a report at `handleMapBoundsChange` - the one
door both the ring lane and the first load come through. A read is about a place,
and a view spanning a country has none.

The ceiling stays at **160** rather than ratcheting to the 125 median, because the
widest sample in that run was 147. A later sweep can bank the rest.

## What each route actually parses

Swept on 2026-09-01 against production at 390x844, by fetching every same-origin
script the route loaded and reading the four heavy libraries out of the text.
Decoded KB, so parse cost rather than transfer:

| route | total | MapLibre | Convex | ElevenLabs | Supabase |
| --- | --- | --- | --- | --- | --- |
| `/` | 1143 | 0 | 0 | 0 | ~341 |
| `/pal` | 1745 | 0 | 0 | 603 | ~341 |
| `/map` | 2599 | 1024 | 0 | 0 | ~341 |
| `/today` | 1180 | 0 | 0 | 0 | ~341 |
| `/tonight` | 1175 | 0 | 0 | 0 | ~341 |
| `/out` | 1129 | 0 | 0 | 0 | ~341 |
| `/about` | 1081 | 0 | 0 | 0 | ~341 |
| `/pubs` | 1092 | 0 | 0 | 0 | ~341 |

Three things this settles.

MapLibre is on `/map` and nowhere else, and Supabase is on every route as the
same ~341 KB lazily fetched after paint by `ensureSupabaseBrowser`. Entry-point
isolation is already correct for both.

`/about` and `/pubs` were carrying 1900 and 1950 KB ceilings against 1081 and
1092 KB measured. There was no accidental import to split: no MapLibre, no
Convex, no voice SDK, no image cropper in any of their 24 and 25 chunks. They
were 800 KB of unbanked slack, which is the shape #1296 named, so both ceilings
ratchet to 1200.

Their REQUEST ceilings are left alone. A seed run counts requests against its
own interactive moment on a different box and network: this sweep counted 62 on
`/` where CI is green at 50, so a request figure measured here is not
comparable. Decoded bytes are, which is why only those ratcheted.

## Which API reads may sit at the edge

A shared cache holds ONE answer for everybody, so only a route whose answer is
the same for everybody may ask for one. The bar is narrower than "is it
public": the body has to be a pure function of the request URL and the
deployment. A session, a caller's identity, a store read that can change
between two requests, or a URL that can carry the viewer's own coordinates all
disqualify it.

| class | contract | verdict |
| --- | --- | --- |
| Night Areas (list and slug) | Bundled config; changes only on deploy | Cached (`jsonCached`) |
| Tonight conditions | Public and read-only, but its URL carries `lat`/`lng` | No-store, deliberately |
| What's-On | Bundled rows plus a live layer, and it accepts `near=lat,lng` | No-store, escalated |
| Everything actor-gated | Answer differs per caller | No-store, by law |

`__tests__/sharedCacheHonesty.test.ts` is the fence. It sweeps every route file
and fails when a shared-cache header sits beside a per-caller read or a viewer
point.

It first flagged two routes that ship one from a file mentioning
`coarsenViewerPoint`. The captain's ruling of 2026-09-01 set the invariant: no
UN-COARSENED viewer point may ever appear in a URL or a shared cache key, and a
bucket many people share by construction may. Traced against it, both are on the
right side.

`/api/tfl-disruption` is case one. Both callers, `DisruptionLine` and
`TodayTubeCard`, run `coarsenViewerPoint` BEFORE they build the URL, so the key
holds only bucket values and the route's own call is a defensive second pass for
a direct caller. The bucket is three decimal places, roughly a 70 to 110 metre
cell: in the London this strip serves that is a city block holding many people,
and the answer is a whole transport patch, coarser again than the cell that
selected it. The cache stays.

`/api/citymcp/journey` was never a viewer-point cache. Its cacheable GET carries
venue-to-venue coordinates, which are public map data; a journey that starts
where the reader stands goes by POST with `cache: no-store`, which
`useVenueJourney` says in its own comment.

Both stay named in the fence with the reason that ruled them, and the list may
only shrink. The fence now checks the invariant rather than trusting it: every
caller must coarsen above the line that builds the URL, and the viewer-origin
journey must stay on POST.

## The API latency budgets

`perf/api-budgets.json` is the same discipline one layer down: what the public
GETs the map, Today and Out spend on arrival may make a reader wait for. A page
can hold every byte budget it has and still lose the night because the read
behind it took a second.

Six reads are budgeted on p50 and p95, measured as time to the first byte of
the body. `lib/apiBudgets.mjs` owns the runtime rules and
`lib/apiBudgets.ts` supplies the application types; `scripts/probe-api-budgets.mjs`
only measures, so the verdict is unit-tested without a network:

```
node scripts/probe-api-budgets.mjs --base-url https://<deployment>.vercel.app
```

Seeded on 2026-09-01 from eight production samples per route, timed as curl's
`time_starttransfer`, which includes this machine's round trip and a cold
invocation in the first sample. The ceilings are looser again than the seed for
that reason, and the same down-only rule applies to them as to the page
budgets. A route the probe could not measure fails: a budget nothing checked is
not a budget, and an error page is not a fast read.

## Banking the slack

Slack does not stay slack. #1296 is the record of what happens otherwise: a
ceiling set generously, a route that quietly grows back into it, and nobody
able to say when.

So the sweep prints a second table. Any route that beats a ceiling by more than
15% is named as a ratchet candidate, with what it measured and how far under it
sat. A sweep where every ceiling is snug prints nothing, so a quiet run stays
quiet.

It is a WARNING and only a warning. It edits no file and fails no build:
`lib/performanceBudgets.ts` touches the filesystem at all only to read the
ceilings, and `__tests__/lcpBudget.test.ts` holds it to that. A ceiling comes
down because a person decided it should, with the measurement in front of them,
which is the same rule the budget file's own note states.

An unmeasured route is never a candidate. That route is a BREACH, and the
breach table already says so.

## How a run is taken

Against the production build in Desktop Chrome at device pixel ratio 1, with a
CSS viewport of 390x844, a 4x CPU throttle, and every cross-origin request
refused, so a run measures what we ship and never a tile server's morning. Each
route gets a warm-up load whose request lifecycle must fully drain before
measurement, then the median of three measured runs. A network that does not
drain within 20 seconds fails the run.

The method is tracked rather than remembered. It lives in the `method` block of
`perf/route-budgets.json`, which `lib/performanceBudgets.ts` types and both perf
specs read, so a figure cannot be taken one way and compared with a figure taken
another:

| field | value | why it is pinned |
| --- | --- | --- |
| `browser` | Desktop Chrome | One engine, so a run is comparable to the one before it. |
| `viewport` | 390x844 at DPR 1 | A phone's CSS viewport, fixed, because a wider one loads different images and a different number of cards. |
| `cpuThrottleRate` | 4 | A mid-range phone against a CI runner's core. |
| `network` | `chrome-fast-4g` | Loopback is not a network: it has no round trip, so it cannot see a waterfall, and a waterfall is what the `requests` ceiling exists to catch. The profile carries its own numbers because "4G" means different things in different tools. Its `quietMs` and `drainCeilingMs` scale with it, because over a throttled wire an ordinary gap between two requests is longer than a whole loopback load. |
| `thirdPartyBlocked` | true | A run measures what we ship, never a tile server's morning. |
| `warmupRuns` | 1 | Discarded, and its request lifecycle must fully drain, so a cold module load is not charged to the route. |
| `measuredRuns` | 3 | Stated here rather than implied, because "the median" means nothing without an N. |
| `aggregate` | median | One slow run cannot fail a green route. |
| `boundaryClock` | page | Whose clock stops the count. See below. |
| `sampleSpreadWarnPct` | 12 | How far a route's own samples may sit apart before the run says so. A warning; it fails nothing. |
| `sampleSpreadFloors` | 25 ms / 20 KB / 3 requests / 250 ms | And how wide that gap has to be in the metric's own units. A percentage alone is not information here: server render sits at 3 to 19 ms, so one millisecond of jitter reads as a 33% spread and every route would warn on every run. |

### Where counting stops, and whose clock stops it

Counting stops at an APP-DEFINED moment, not a wall clock: the later of the
document's own load event and the first in-page frame on which the route's
readiness gate held. A resource counts if it started before that moment; the run
then waits for the network to go quiet so every counted entry carries its final
size.

That distinction is the difference between a gate and a coin toss. `networkidle`
catches or misses the post-paint background warmup (`lib/mapWarmup.ts` warms the
OTHER tab destinations on purpose, on an idle callback with a 2000 ms timeout)
depending on how fast the box is: the first CI run of this spec measured
`/today` at 2726 KB and the retry at 1186 KB, on one build.

The rule above fixed the byte swing and left a smaller one behind, and #1314 is
its record: on a docs-only commit, `/today` measured 54 requests where the same
tree had measured 43. A markdown file moves neither figure, so the difference was
the runner. The cause was WHOSE CLOCK read the moment. Playwright learns a
selector is visible by polling, and learns the page's clock by a round trip after
that, so a harness-timed boundary lands a poll interval plus a round trip late
and drifts with load. One idle prefetch burst is about ten requests, which is the
size of the swing.

So the boundary is timestamped by the page. An init script installed by
`e2e/helpers/perfMeasurement.ts` carries the whole route table, picks its own row
off `location.pathname`, watches that route's readiness selectors frame by frame,
and records the first frame they held against the document's own time origin -
the same origin `loadEventEnd` and every resource `startTime` already use. Its
visibility test is deliberately no stricter than Playwright's own, because a
stricter one would leave the gate unheld on a route the harness calls ready.

`resolveCountBoundary` in `lib/performanceBudgets.ts` makes that one decision and
is unit-tested without a browser (`__tests__/perfBoundaryClock.test.ts`). The
harness figure survives only as a NAMED fallback: a sample that had to use it is
reported in the run's method warnings, so a drifting run is visible in the log
instead of quietly reading as a heavier route.

### What a run prints

Three tables, in this order:

- `[perf-budget]` - every route and metric against its ceiling.
- `[perf-budget][samples]` - every individual sample beside its median and the
  spread between them. #1314 asked for exactly this before choosing a fix: a run
  that reports only its median cannot say whether a swing happened inside the run
  or between runs, and those two have different fixes.
- `[perf-budget][method]` - facts about the MEASUREMENT rather than about the
  code: a route whose samples sat further apart than `sampleSpreadWarnPct`, and
  any sample that fell back to the harness clock. Reported, never failed on.

### What the page clock actually fixed, and what it did not

Two consecutive sweeps on one production build of `main`, nine routes, taken on
2026-09-03. The two COUNTED metrics - the ones the boundary decides, and the two
#1314 flaked on - came back identical on all nine routes:

| route | JS decoded (KB) | requests | first sweep = second sweep |
| --- | --- | --- | --- |
| `/` | 887 | 41 | yes |
| `/pal` | 1160 | 41 | yes |
| `/map` | 2972 | 122 | yes |
| `/today` | 914 | 43 | yes |
| `/tonight` | 926 | 50 | yes |
| `/out` | 866 | 40 | yes |
| `/about` | 828 | 36 | yes |
| `/pubs` | 832 | 43 | yes |
| `/webmcp` | 865 | 37 | yes |

18 figures, 18 agreements. The same sweep taken on the harness clock beforehand
counted more on every route (`/` 1144 KB over 48 requests, `/map` 3076 KB over
133, `/tonight` 1164 KB over 52), which is the post-paint idle burst that used to
land inside the count. Those ceilings are NOT re-seeded here: a method change and
a ceiling change do not belong in one commit, and the down-only law means the
banking is a separate, deliberate move.

The two OBSERVED metrics still move, and they are honestly reported rather than
claimed fixed. `serverRenderMs` sat between 3 and 19 ms and `lcpMs` between 84
and 780 ms across the two sweeps. Neither reads off the boundary: one is
`responseStart - requestStart` on the navigation entry, the other is a buffered
`PerformanceObserver`, and both move with scheduling under a 4x throttle. What
makes that tolerable is headroom rather than hope: every one of those figures
sits an order of magnitude under its ceiling (LCP 84 to 780 against 1500 and
2500; server render 3 to 19 against 150 and 450), so paint jitter cannot flip the
gate. If either ever does, the `[perf-budget][samples]` table says whether the
route moved or the runner did.

Run it locally the same way CI does:

```
PUBMAX_PERF_BUDGET=1 npx playwright test e2e/performance-budget.spec.ts --project=chromium --workers=1
```

A failing run prints one row per breach: route, metric, measured, budget, and
how far past the ceiling it went.

## Changing a number

A budget is a ratchet. Take one DOWN whenever the measured figure has been
comfortably below it for a while: that is the point of the exercise.

Take one UP only deliberately, in the same commit as the change that needs it,
with the reason and the new figure measured rather than guessed. A budget raised
to make a red build green is not a budget.

That half of the law used to be enforced by whoever happened to read the diff.
`scripts/check-budget-ratchet.mjs` is the pawl, and it runs in the
`performance-budget` job BEFORE the sweep, because it needs no browser and no
build. The trap it closes is specific: when the gate fails, the fastest way to
make the red go away is to raise the ceiling, and #1314 is the record of a gate
failing on unchanged code and pushing an author toward exactly that move.

So a raise is not forbidden - forbidding it would make the law a lie the first
time a route legitimately needs room - it is made impossible to do QUIETLY. A
raise needs a `ceilingRaises` entry on the route:

```json
"ceilingRaises": [
  { "metric": "requests", "from": 50, "to": 60, "measured": 52, "why": "..." }
]
```

The `from` is checked against the base branch's actual ceiling, so it cannot be
written from memory. A raise with a record still prints in the job log under
"ceiling(s) went UP with a record", because allowed is not the same as
unremarked. The record stays in the file afterwards, which is what makes the
next reader able to ask whether the debt was ever paid.

No ceiling carries one today, and that is the point: the sweep that added a
network profile to the rig found one route over its ceiling, and the answer was
to report the route rather than to move the number. See "The one route over its
ceiling" above.

Adding a route is cheap: one entry with a `readySelector` the route really
renders and one sentence of `why`. Removing one is refused by the check, because
an unmeasured route reads as a pass and never fails again.

## Which routes are budgeted

All 35 that the site serves a stranger, which is every `page.tsx` with no
dynamic segment, less two:

- `/admin`, which answers 401 to an anonymous request and renders a token form
  rather than a route.
- `/map/arrival`, which is not navigable: the proxy rewrites a `/map` request to
  it when the document really differs (`lib/mapDocumentTwin.ts`), so it is
  measured as `/map`.

`/profile` is budgeted as `/u/you`, the document it actually serves. Budgeting
`/profile` measured a server redirect rather than a route, and the page clock
said so by falling back to the harness clock - which is the fallback earning its
place on its first sweep.

## The pin-ready record on /map

`/map` carries one extra tracked block, `pinReady`. It is not one of the four
budgeted metrics, because it is not a page cost: it is the moment the product
becomes usable. It is kept beside the route it describes so the figure and the
ceiling live in one place, and `e2e/mobile-map-chrome-fit.spec.ts` now READS
`targetMs` from here rather than restating it. That was two owners for one
number, and ratcheting the recorded target down did nothing to what the spec
actually enforced.

The target came down from 4000 ms to **2500 ms** on 2026-09-03, against a
measured 1822 ms. The previous record said 3336 ms; the bounded opening viewport
(the city's own view rather than world bounds, with the surrounding ring waiting
for idle) is what closed that gap, and nothing had banked it. 2500 leaves 37%
headroom, so it can come down again.

| Field | What it is |
| --- | --- |
| `path` | The document measured. `/map/london` is the per-request city route, not the CDN-cached `/map`. |
| `targetMs` | The CEILING, and its ONE owner. The spec reads this field rather than restating it, and `scripts/check-budget-ratchet.mjs` refuses a commit that takes it up. |
| `measuredMs` | The last RECORDED figure, not a second ceiling. It is a note of where we stood. |
| `signal` | What was waited for: painted pins the collision index kept, off `components/map/canvas/paintedPinProbe.ts`. |
| `viewport` | The phone the promise is made to. |
| `note` | How the figure was taken, in one sentence. |

The pin-ready test in `e2e/mobile-map-chrome-fit.spec.ts` opens the route cold,
waits up to sixty seconds on the painted-pin probe, and always records
`pinReadyMs` as a Playwright annotation. That proves pins paint on every run.

The `targetMs` ceiling is enforced only when `PUBMAX_PIN_SLA_ENFORCE=1` is set
(GPU or real-device runs). That one variable does BOTH halves: it arms the
ceiling AND drops the spec's `--use-angle=swiftshader` launch override, so the
enforced run measures the machine's own renderer. Stock CI keeps SwiftShader
software rendering, which routinely exceeds five seconds even when pins do
paint; failing that build on the ceiling would be noise, not a product
regression. Set the variable only on a box with a real GPU - a software
fallback under an armed ceiling fails for the reason the gate exists to
excuse.

Nothing enforces `measuredMs`: re-measure it by running that spec against a
production build and reading the `pinReadyMs` annotation, then update it in the
same commit as the change that moved it. Take `targetMs` DOWN under the ratchet
rule above; raising it is raising the promise, which is a captain decision
rather than a number to edit.

## The second navigation

The budgeted numbers above are about ARRIVING. They say nothing about the
navigation a drinker does far more often: tapping between tabs inside a session
that is already open. That one has its own shape, and it had its own defect.

Method, and it is deliberately not the budget spec's: one phone profile
(390x844, 4x CPU throttle, 10 Mbps at 40 ms RTT, cross-origin refused), a lap
around the bottom nav, and the clock started on the tap itself with `pointerdown`
fired immediately before the click, so intent-warm gets no head start a fast
thumb would not give it. A switch has ARRIVED when the destination route's own
root element is in the DOM and the browser has painted twice. For `/map` that
root is the map screen, not the pins: the WebGL init that follows is the map's
own cold-start lane. COLD is the first landing on a route in the session; WARM is
every later one. Both arms of a comparison run alternating in one process so
machine drift lands on both, and the first two laps are dropped as the server's
own warm-up - the same rule `warmupRuns` states above.

Measured on 2026-08-09, before and after the client-cache work:

| Tab switch | p50 before | p50 after | p95 before | p95 after |
| --- | --- | --- | --- | --- |
| Today, warm | 314 ms | 46 ms | 328 ms | 60 ms |
| Tonight, warm | 317 ms | 35 ms | 319 ms | 39 ms |
| You, warm | 314 ms | 30 ms | 316 ms | 44 ms |
| Map, warm | 31 ms | 32 ms | 49 ms | 66 ms |
| Tonight, cold | 327 ms | 329 ms | 334 ms | 334 ms |
| Social, cold | 328 ms | 329 ms | 330 ms | 331 ms |
| You, cold | 330 ms | 326 ms | 332 ms | 348 ms |
| Map, cold | 401 ms | 395 ms | 409 ms | 414 ms |

Read it as one finding: a warm switch was a flat ~314 ms because it was a full
RSC round trip and a fresh server render for a document the browser was still
holding, and it is now the remount alone. A COLD switch is unchanged, which is
the right answer - there was nothing held to reuse. The map was already instant
in both arms because its document is one of the two the CDN holds.

The seams:

- **`experimental.staleTimes` in `next.config.mjs`** is the window. It is safe
  only because no page server-renders per-account content and nothing calls
  `router.refresh()`; `__tests__/clientRouterCache.test.ts` fences both.
  `/admin` is the one argued exception to the first invariant, named in that
  fence as `PER_SESSION_SERVER_PAGES`: it server-renders the console or a 401
  token form off the caller's own credential, nothing links to it, and every
  `/api/admin` read re-gates. A second exception re-derives the whole window
  rather than adding a list entry.
- **`lib/surfaceDataCache.ts`** is the data half: one browser-only
  stale-while-revalidate store, so a return paints its last answer and refreshes
  behind it. It refuses auth and identity keys outright and empties at an
  account boundary. On the same lap set, Tonight's LISTINGS - not just its shell
  - reached the screen on a return in 197 ms p50 / 344 ms p95, from 417 / 660.
- **`components/nav/IntentLink.tsx`** warms a dynamic destination on intent
  instead of prefetching it on sight. A Tonight arrival used to fire about twenty
  `/plan?occasion=…` and `/pal/chat?ask=…` server renders in front of the
  listings it was still fetching.

Keeping tabs MOUNTED instead - parallel-route slots rather than navigations -
was considered and rejected on the same numbers. The remount is what is left of
a warm switch, and it now measures 30-46 ms; against that, every other page
would carry the map's tree, its effects and a live WebGL context all session.
The JS heap over one lap reads 8.8 MB on arrival at `/today` and 15.8 MB after
visiting every tab, of which the map step alone is +3.3 MB. Route JS is retained
once loaded either way, so persistence would buy back tens of milliseconds and
charge the heaviest route to every surface.

## What holds the numbers up

These are the seams a regression usually comes through. Each carries the reason
in its own file:

- **Two documents are prerendered; every other route is dynamic.** The
  per-request CSP nonce (`proxy.ts`) rules out static generation, ISR and PPR,
  so a nonce'd page view is a function invocation with no CDN copy to serve
  instead. That was the single largest cost in the production figures, and it
  is a policy decision rather than an implementation detail: on 2026-08-09 the
  captain took the exception named in `CDN_CACHED_DOCUMENT_PATHS`, so `/` and
  `/map` drop the nonce, prerender, and are held by the CDN. Both are public
  and anonymous, and their documents are asserted to name nobody. Every other
  route - identity, social, profile, admin, every API - keeps the nonce and
  keeps paying the invocation.
- **A prerendered document reads nothing per request.** `force-static` on those
  two pages turns a per-request read into a build error rather than a silent
  fall back to dynamic rendering, and it is also what stops the root layout's
  nonce read (`headers()`) from pulling them back. A `/map` request whose
  document really does differ - a town arrival, national browse, a curated
  share card - is rewritten to `app/map/arrival` and rendered per request with
  the nonce intact; `lib/mapDocumentTwin.ts` owns that split, and widening its
  key list takes those requests off the CDN.
- **Bundled data is read once per instance, never once per request.**
  `lib/aboutStats.ts` and `lib/venuePriceIndex.ts` memoize; the price dataset is
  6.7 MB of JSON and parsing it per request is the difference between a fast
  landing and a slow one.
- **No third party is on a render path without a deadline.**
  `WEATHER_TOP_UP_RENDER_DEADLINE_MS` in `lib/weatherFreshness.server.ts` bounds
  the live weather top-up; past it the reader gets the cached reading with its
  honest staleness line and the top-up finishes in the background.
- **No share card lives at the root segment.** Next folds a segment's
  `opengraph-image` into a metadata module that every descendant page's server
  function carries, and at the root that is every page on the site. A
  `import()` inside the handler does not help, because the tracer follows it.
  The homepage card is therefore a route (`app/api/home-card/route.tsx`) named
  by the homepage's own metadata. A card that only some subtree pays for may
  stay a file convention.
- **The map's eager JS has its own older fence**,
  `e2e/map-perf-budget.spec.ts`, kept because it states the map-specific
  regression cliff the audit measured.
