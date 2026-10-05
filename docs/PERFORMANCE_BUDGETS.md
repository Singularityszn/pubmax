# Performance budgets

Speed is the promise this product makes. A promise nobody counts is a wish, so
every budgeted route has a number, the number is tracked in the repository, and
CI refuses a change that goes past it.

- The ceilings: [`perf/route-budgets.json`](../perf/route-budgets.json). Every route the site serves a stranger, all 46 rows
- The pawl on the ratchet: [`scripts/check-budget-ratchet.mjs`](../scripts/check-budget-ratchet.mjs), which refuses a ceiling taken up against the base branch without a record
- The rules and the failure table: [`lib/performanceBudgets.ts`](../lib/performanceBudgets.ts)
- The measuring: [`e2e/performance-budget.spec.ts`](../e2e/performance-budget.spec.ts)
- The method every perf spec shares: [`e2e/helpers/perfMeasurement.ts`](../e2e/helpers/perfMeasurement.ts)
- The UX lane report: [`e2e/ux-lane-perf-verification.spec.ts`](../e2e/ux-lane-perf-verification.spec.ts). Four arrival routes (`/`, `/near`, `/map/london`, `/out`) with LCP and CLS beside decoded JS, written as a markdown table for the PR body. It REPORTS: a route over a ceiling here is a warning, and the only failure is a route it could not measure at all
- The gate: the `performance-budget` job in `.github/workflows/performance.yml`, which runs nightly on main and on demand since 15 September 2026 (it ran on every pull request in `ci.yml` before that); the UX lane report is its own `ux-lane-performance` job in the same workflow, because one 15-minute wall cannot hold two full sweeps
- The evidence behind a RED run: [`scripts/perf-ab.mjs`](../scripts/perf-ab.mjs), an `if: failure()` step in that same job. It rebuilds the merge base, re-measures the breached routes against it on the same box with the navigations interleaved, and prints whether the branch or the box is slower. It gates nothing and moves no ceiling; the rule is [`perf/AGENTS.md`](../perf/AGENTS.md)
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
| `/onboarding` **redirects to `/`** | - / 150 | 0 / 0 | 1 / 1 | 0 / 0 |
| `/choose-city` **redirects to `/places`** | - / 150 | 0 / 0 | 1 / 1 | 0 / 0 |
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

Two rows are budgeted as redirects rather than pages, and their server-render cell
carries no measured figure. `measurePerfRedirect` TIMES the 3xx and reports that as
`serverRenderMs`, so a zero there would be a measurement nobody took: the 2026-09-04
seed sweep measured the document each route used to serve, and neither has answered
one since. The other three cells hold by construction rather than by sampling, because
the lane returns one request, no script and no paint. See "A route that redirects is
measured as a redirect".

The margin is not one number, because the four metrics do not behave alike.

| metric | seeded from | margin | why |
| --- | --- | --- | --- |
| `jsDecodedKB` | p75 of five samples | +15% | Identical across every sample of every route. A build ships what it ships. |
| `requests` | p75 of five samples | +15% | Same: stable to the request within a run. |
| `serverRenderMs` | p75 of five samples | +50%, floor 150 ms | Single-digit milliseconds on most routes, so a percentage alone is meaningless and the floor does the work. |
| `lcpMs` | the WORST sample any sweep has produced | +25% | See below. It is the noisy one, and it is not close. |

**Why LCP is seeded from the worst figure rather than a p75.** Within one run LCP
is tight - five samples of `/rounds` came back 176, 196, 172, 176, 180. The spread
is BETWEEN runs, and it is wide: measured across three full sweeps, `/tonight`
produced 660 ms and 192 ms, `/discover` 272 ms and 776 ms, `/out` 1064 ms and
532 ms. The worst between-sweep figure reached **3.17x** the same route's
within-run p75.

A ceiling seeded from one run's p75 would therefore rebuild the gate this whole
programme started by fixing: red on unchanged code, and an author pushed toward
the one move the law forbids. So every LCP ceiling covers the worst figure any
sweep has actually produced, plus a quarter. Every route has at least 25% headroom
against its own worst observation, except `/pal`, which simply keeps its existing
1500 ms - tighter than the rule would give it, and not raised to suit it.

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

One named exception stands, by the captain's ruling of 2026-10-03:
`/api/auth/providers`. Its body is a store read, the Supabase Auth provider
flags, so it fails the bar as written. It is allowed because the answer is the
same for every caller and changes only when someone edits the Supabase
dashboard. The shared copy is fresh for five minutes (`s-maxage=300`, plus a
60-second `stale-while-revalidate`), so a dashboard toggle can take that long
to show or hide a button. Before OAuth starts, the client rechecks with
`?fresh=1`, which is never cached. The exception covers this route alone. It
does not loosen the bar for any other remote read.

| class | contract | verdict |
| --- | --- | --- |
| Night Areas (list and slug) | Bundled config; changes only on deploy | Cached (`jsonCached`) |
| Social sign-in providers (`/api/auth/providers`) | Supabase dashboard flags, the same for every caller; `?fresh=1` is the pre-OAuth recheck | Cached five minutes; `?fresh=1` no-store |
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
measurement, then the median of three measured runs. Two kinds of route are
measured twice more and judged on the median of five: one whose samples disagree
past the tracked width, because a median of three is only a median when the
samples agree, and one whose median lands within `resampleWithinCeilingPct` of
its own ceiling ON EITHER SIDE, because a verdict that close is decided by
jitter and deserves more evidence rather than less. That second band is
symmetric on purpose. It used to fire on any median at or above the ceiling
minus the margin, which has no upper edge, so it bought extra samples on every
figure from a hair under the line out to a route three times over it and never
on one sitting comfortably under: extra samples can only move a median, so a
trigger shaped like that spends evidence exactly and only where it can turn a
red into a green. A route far over its ceiling now buys nothing, because that is
a regression rather than jitter, and the spread rule still covers the run where
a box genuinely stalled. A network that does not drain within 20 seconds fails
the run.

### The runner the sweep is taken on, and why it is not the one every other job takes

From 6 to 15 September 2026 the budget job and the UX lane report ran on a
4 vCPU runner (`avrea-ubuntu-latest-4-vcpu`, then `blacksmith-4vcpu-ubuntu-2404`)
while every other job in `.github/workflows/ci.yml` ran on a 2 vCPU label. Since
15 September every job runs on GitHub-hosted `ubuntu-latest`, a 2 vCPU box on a
private repository. On the 2 vCPU box the sweep could not measure itself. Its own method check reported LCP
samples spread 37 to 51 per cent on `/today`, `/discover`, `/drinks` and
`/crawls`, and a server-render spread of 320 per cent on `/feed`, all past the
12 per cent width this method tracks. Inside one run of one commit `/crawls`
measured 304 ms and then 612 ms, and `/today` 304 ms and then 708 ms: a route
flipped between pass and fail with nothing in the tree changing. A ceiling is
only a ceiling when the number under it is repeatable.

Two things follow, and the second is the one that keeps this honest. The
ceilings do not move because the box changed: not one number in
`perf/route-budgets.json` was re-seeded for the runner size. And the ratchet law
below still says a ceiling comes DOWN whenever the measured figure sits
comfortably under it, so a quieter box is a reason to take ceilings down at the
next sweep, never a place for a route to hide. The two perf jobs stay on the
same label as each other for the reason the UX lane exists: it reports on this
method so its figures are comparable to the ceilings, and two figures taken on
two different boxes are not comparable.

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
| `resampleRuns` | 2 | Spent only where the run needs more evidence, so that route's median is taken over 5 rather than 3. A quiet route costs exactly what it did before. |
| `resampleWithinCeilingPct` | 10 | The second reason to spend them, and it reads BOTH WAYS. The spread rule asks whether the samples agreed with EACH OTHER and is blind to where they sit: on 6 September `/map` agreed with itself to 14 per cent and still read 612 ms in one attempt of the job and 956 ms in the next against a 900 ms ceiling, while `/pubs` asked 68 requests in one attempt and 69 in the other against a ceiling of 68. A median within this margin of its own ceiling, on EITHER side of it, buys the extra samples: `\|median - ceiling\| <= ceiling * pct`. The band is symmetric on the captain's decision of 7 September 2026. It only ever ADDS runs and decides nothing. |
| `noisyWarmupRuns` | 2 | What a route carrying a `noisy` record discards before its first counted sample, rather than one. The four marked routes are shells whose SECOND load is the first with caches, modules and fonts all in place, and a warm-up that has not settled is the widest single source of their spread. |
| `noisyResampleRuns` | 4 | And the resample budget such a route may spend, rather than two, so it is judged on the median of seven. Spent only where the resample rules fired, exactly as before. |
| `aggregate` | median | One slow run cannot fail a green route. |
| `boundaryClock` | page | Whose clock stops the count. See below. |
| `sampleSpreadWarnPct` | 12 | How far a route's own samples may sit apart before the run says so. A warning; it fails nothing. |
| `sampleSpreadFloors` | 25 ms / 20 KB / 3 requests / 250 ms | And how wide that gap has to be in the metric's own units. A percentage alone is not information here: server render sits at 3 to 19 ms, so one millisecond of jitter reads as a 33% spread and every route would warn on every run. |

### The noise floor, and which routes carry it

Four routes on these runners cannot measure themselves in three. The 6
September sweep's own method check put their LCP samples 37 to 51 per cent
apart, past this method's tracked 12 per cent width, and inside one run of one
commit `/crawls` measured 304 ms and then 612 ms while `/today` measured 304 ms
and then 708 ms. Two pull requests then went red on routes they had not touched:
#1604 on `/crawls` at 320 against 300, on a branch an interleaved A/B proved
equal to or faster than main on that very route, and #1611, a docs-only change,
on `/today` at 364 against 300 and `/onboarding` at 908 against 900.

The answer to a figure nobody can repeat is more evidence, never a bigger
ceiling. Not one number in `perf/route-budgets.json` moved for this. A route
that has been MEASURED wide carries a `noisy` record naming the metric, the
widest spread recorded and why, and spends `noisyWarmupRuns` and
`noisyResampleRuns` instead of the ordinary pair: two discarded navigations
rather than one, and a median of seven rather than of three or five.

Two rules keep it a measurement rather than a mute button. The mark is
EVIDENCE, so it carries the figure it was made on and can be taken off the day
a route measures narrow again; `__tests__/performanceBudgets.test.ts` refuses a
mark with no recorded spread wider than the tracked width. And it costs an
unmarked route nothing, so a quiet sweep takes exactly the navigations it took
before.

| route | marked on | widest recorded spread |
| --- | --- | --- |
| `/today` | LCP | 51% |
| `/discover` | LCP | 37% |
| `/drinks` | LCP | 37% |
| `/crawls` | LCP | 51% |

`/onboarding` is deliberately NOT marked. It has no recorded wide spread; it
went red at 908 against a 900 ceiling, which is nine tenths of one per cent
over, and the symmetric on-the-line band already buys that verdict its extra
samples. A mark is for a route whose samples disagree with each other, not for
one whose answer sits near its line.

### Noise floor: what ten runs measured, 7 September 2026

Ten CI runs on `avrea-ubuntu-latest-4-vcpu`, five per arm, dispatched in parallel
on throwaway refs so no run cancelled another. Both arms sit on the same base
(`563f51198`): the before arm is that commit unchanged, the after arm is this
work, whose tree is byte-identical to the commit the runs measured.

**False reds: 1 of 5 before, 0 of 5 after.** The one red is the defect this work
is about, reproduced on code nobody had touched: `/crawls` LCP 320 against a
300 ms ceiling, +7%, which is #1604's red to the millisecond.

Per route, the median of each run's own LCP samples, and the spread of the
samples behind it. `n` is how many samples each run took.

| route | ceiling | before: medians | n | after: medians | n |
| --- | --- | --- | --- | --- | --- |
| `/crawls` | 300 | 236, 220, 220, 224, **320** | 5 | 220, 228, 240, 240, 272 | 7 |
| `/today` | 300 | 212, 228, 208, 212, 216 | 5 | 224, 236, 216, 220, 208 | 7 |
| `/discover` | 1000 | 308, 304, 308, 308, 336 | 5 | 332, 440, 336, 300, 332 | 7 |
| `/drinks` | 1000 | 300, 308, 312, 336, 348 | 5 | 328, 336, 324, 312, 324 | 7 |
| `/onboarding` | 900 | 788, 820, 676, 796, 700 | 5 | 724, 772, 672, 684, 692 | 5 |
| `/pubs` | 600 | 260, 260, 252, 300, 296 | 5 | 284, 284, 272, 312, 264 | 5 |
| `/map` | 900 | 220, 216, 200, 220, 192 | 3 | 256, 212, 200, 200, 196 | 3 |

The `n` column is the floor working. The four marked routes take seven samples
in the after arm and five in the before arm, so the second warm-up and the wider
resample budget are really being spent on the runner and nowhere else.
`/onboarding` and `/pubs` take five in both, which is the on-the-line band alone;
`/map` takes three, having room either side and nothing to resample for.

#### What the one red actually looked like

`/crawls` samples, before arm, all five runs:

```text
216 / 244 / 236 / 244 / 212      median 236
212 / 224 / 220 / 220 / 256      median 220
220 / 216 / 220 / 224 / 224      median 220
216 / 236 / 224 / 224 / 240      median 224
320 / 268 / 308 / 656 / 356      median 320   <- RED against 300
```

And the same route, after arm:

```text
280 / 312 / 260 / 272 / 268 / 272 / 256      median 272
236 / 240 / 248 / 240 / 280 / 224 / 256      median 240
244 / 240 / 244 / 240 / 240 / 272 / 240      median 240
220 / 224 / 280 / 232 / 228 / 216 / 228      median 228
216 / 228 / 248 / 216 / 220 / 220 / 224      median 220
```

The red run is not one outlier against four good samples. Its FIRST counted
sample is already 320 and four of its five sit at or above 308: that route had
not settled when counting began. `/crawls` was already spending the resample
budget in every before-arm run, which is why every before row shows five samples
rather than three - the old on-the-line band fired every time and still landed
at 320. Two more samples were not the missing thing. The second discarded
navigation is, and no after-arm run drew a sample above 312.

#### The spread gets WIDER, and that is arithmetic rather than a regression

`/discover` and `/drinks` report a wider sample spread in the after arm, up from
16% and 8% to 106% and 117%. Nothing got slower. `spreadPct` is
`(max - min) / median` over the samples a run drew, and seven draws catch the
tail more often than five do. `/discover`'s widest after-arm run is
`364 / 656 / 304 / 332 / 324 / 336 / 328`: one 656 against six samples between
304 and 364, median 332, against a 1000 ms ceiling.

That is the floor doing its job rather than failing at it. It was never meant to
narrow the spread; it is meant to stop one draw from the tail deciding a verdict,
and a median of seven shrugs off the 656 that a median of three could not. The
spread warning still prints, and still fails nothing.

#### What this evidence does not show

One red in five runs is a thin base. These ten runs show that the mechanism is
spent where it was meant to be spent, that the reproduced red is real, and that
no after-arm run of any route breached. They do not establish a false-red RATE to
any precision, and a second red on a later sweep would not be a surprise. The
honest claim is the mechanism and the direction, not a probability.

### A ceiling a wide run cannot decide

The three tables above said a route could not measure itself, and until 11
September 2026 saying so changed nothing: the median was judged anyway. So a
loaded runner read as a breach on a pull request whose diff had not touched the
route. Job 103319591915 and its re-run on the IDENTICAL commit `3ebac98ac`,
same label, same tree, printed eight and six breached routes and shared three of
them, while the method block reported `/tonight` LCP spreading 133 per cent and
`/activity` server render 400 per cent against a tracked width of 12.

`judgeBudgets` in `lib/performanceBudgets.ts` is the one owner of the rule, and
it is pure, so it is unit-tested with no browser. A verdict is unanimous or it
is not a verdict. A clock is UNMEASURED when all three of these hold, and is
judged on its median otherwise:

a. its samples STRADDLE the ceiling: at least one met it, and at least one went
   past it;
b. they disagree past `sampleSpreadWarnPct`;
c. the excess fits inside the spread that is supposed to explain it:
   `median - budget <= (max - min) / 2`.

**The known limit.** A route whose excess over its ceiling is smaller than its
own jitter cannot be decided by a single sweep, so it is reported unmeasured
every time rather than failed, and a row that keeps appearing there is the
signal to spend real evidence on that route. Every unmeasured row prints its
median, its ceiling and its excess over that ceiling beside the range its
samples ran over, so the same row returning is visible sweep after sweep.

An unmeasured row is reported in its own table, and left off the breach list and
off the ratchet table. Read the three the other way: samples of which not one met
the ceiling are a breach, because no median that evidence allows is under;
samples of which not one went past it are a pass for the same reason; samples
that agree with each other are judged on their median however close to the line
it sits; and a median further over the line than half the spread is a breach,
because noise that size did not put it there. A route running 1200 ms on six of
seven samples with one warm 290 ms sample straddles a 300 ms ceiling and is far
wider than the tracked width, but its median is 900 ms over against a half-spread
of 455, so it stays red. Condition (c) compares two figures the run already
measured and adds no tracked number.

ONLY A CLOCK IS EVER UNDECIDED. `CLOCK_METRICS` names the two: `serverRenderMs`
and `lcpMs` read the machine the sweep ran on, and a loaded box moves them with
no line of the route changing. `requests` and `jsDecodedKB` count work the page
CHOSE to do, so samples that disagree there measured a route loading different
things on different navigations, which is the finding rather than the noise.
They are judged on their median always: an extra chunk on some loads reads as
requests 44, 60 and 62 against a ceiling of 46, and that stays red. The second
run of `3ebac98ac` measured `/pubs` JS decoded 929 to 1185 and `/plan` 782 to
1106, so those rows may go red on the next sweep. That is conditional loading on
two routes, and it gets the same answer as `/crawls`: named for the captain,
never rescued by a wider width or a bigger number.

Both edges are asked in condition (a), because a run has to STRADDLE its ceiling
to leave it undecided. Server render sits at 3 to 19 ms against a 150 ms ceiling
on every route here, so one millisecond of scheduler jitter reads as a wide
spread on a row nothing could put in doubt; naming those would bury the
straddling rows the table exists for.

The anchor is the ceiling itself rather than a band around it. An earlier cut
let the fastest sample sit `resampleWithinCeilingPct` over the line, which
excluded samples of 320, 800 and 1200 against a 300 ms ceiling: a median two
thirds over budget, laundered by a fastest sample 10 ms inside the band. A run
in which no sample ever met the ceiling is a breach whatever its spread.
`medianSitsOnTheLine` still owns that band, because how many samples to BUY is a
different question from what the samples already bought may say. The metric's
`sampleSpreadFloors` entry is deliberately not asked either: it exists so the
method warning does not fire on every route on every run, and a spread wide
enough to straddle the ceiling already carries that relevance.

THE REPORT READS BOTH WAYS. `judgeBudgets` asks every route and every clock, not
only the rows already over their ceilings, so a straddling run is named in the
unmeasured table whichever side of its line the median fell on. The same
evidence may not read as a clean pass in one run and as undecided in the next.
No verdict moves with it: a median under its ceiling still passes, and the gate
still fails on the breach list alone.

AN UNDECIDED CEILING IS NOT BANKABLE EITHER. The ratchet table names ceilings
with slack worth taking down, and a run may not refuse a median and bank it in
the same log: lowering a ceiling off samples the run itself would not trust
makes the fast ones the next sweep's red. `bankableRatchetCandidates` drops
every undecided row, so `findRatchetCandidates` stays blind to the verdict and
pure, and the two are put together in exactly one place.

Replaying every breached row those two runs printed, eleven of fourteen stop
being breaches. The three that remain are the point of the rule rather than a
gap in it. `/today`'s first run spread 103 per cent and its FASTEST of seven
samples was 352 ms against a 300 ms ceiling. `/crawls` in the second run ran 308
to 408 against the same ceiling and never once met it, on a route that already
carries a `noisy` record and had spent the extra samples. `/historic` agreed
with itself to 9 per cent on 408 ms against 400, which is a route sitting on its
line rather than a runner having a bad morning. The answer to all three is the
route or a deliberate decision, never a wider width.

Nothing is loosened anywhere else. No ceiling moved, `sampleSpreadWarnPct` did
not widen, the sweep still declares `retries: 0`, and the resample budget is
spent exactly as before - this decides only what the evidence it bought is
allowed to say.

**Why exclude rather than resample until the spread closes.** Extra samples can
only move a median, so a loop that stops when the spread closes stops exactly
when the noise stopped SHOWING: it launders the measurement rather than taking
it, which is the objection upheld on 7 September against the one-sided rescue
band. It is also a retry with extra steps, and this sweep declares zero retries
for that reason. And the sweep's timeout is derived from `plannedNavigations`, a
worst case that no until-condition has.

### A route that redirects is measured as a redirect

`page.goto` follows a 3xx, so the moment a budgeted route starts redirecting its row
measures the page it lands on, under a ceiling written for the page it used to be.
`/onboarding` did exactly that on 7 September 2026: it began answering 307 to `/` and
shipping no document, and the next sweep read the homepage's 45 requests against the 41
that used to buy an almost empty first-run shell. Nothing had got slower. Measured on a
production build, `/onboarding` and `/` return the identical count, because they are now
the same page.

Both readings of that number are wrong. Calling it a regression takes a ceiling up to hide
a measurement pointing at the wrong page; calling it a win lets any route shed its own
ceiling by learning to redirect.

So the row says what it is. A route budget may carry `redirectsTo`, and the sweep then
measures the redirect rather than the page: one request, no script, no paint, and the
server time the 307 itself took. Two rules keep it honest. The target must carry a budget
row of its own, so the page never falls out of the sweep. And the lane ASSERTS the
redirect, with the `Accept` header a browser sends, rather than tolerating its absence: a
route declared as a redirect that quietly starts serving a document again fails here
instead of passing every ceiling on one request.

Owner: `redirectsTo` in `lib/performanceBudgets.ts`, `measurePerfRedirect` in
`e2e/helpers/perfMeasurement.ts`. Pin: `__tests__/performanceBudgets.test.ts`, "a budgeted
route that redirects".

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

### What the sweep does NOT reset, and why route order matters

`resetPerfState` clears cookies, `localStorage` and `sessionStorage` before every
route, because one sweep shares one page and a route was otherwise measured with
whatever the last one stored. It does **not** clear the HTTP cache.

That is deliberate and it matches what the method claims to describe - a
returning visitor, not a first-ever one - but it has a consequence worth stating
plainly rather than leaving for the next reader to rediscover: **a chunk fetched
by an earlier route is warm for every later one, so route order is a hidden
variable in the sweep.**

It is not a small effect. `/pal` measured 1200 ms LCP in second position and
540 ms in seventh, on identical code, because by the seventh route the auth chunk
it waits for was already in the cache. Two rules follow:

- A figure is only comparable to another taken **in the same position** in the
  same route order. The order is the order of `routes` in
  `perf/route-budgets.json`, so inserting a route changes what every route after
  it measures.
- A before-and-after comparison must run both sides with the same order and the
  same base commit, and is worth more samples than the enforced three. One sweep
  per side is not enough to tell a real change from between-run variance: on one
  such pair `/discover` appeared 504 ms worse and `/out` 532 ms better, and a
  seven-sample pass on the same two builds put both within 20 ms.

### What a run prints

Five tables, in this order:

- `[perf-budget]` - every route and metric against its ceiling.
- `[perf-budget][samples]` - every individual sample beside its median and the
  spread between them. #1314 asked for exactly this before choosing a fix: a run
  that reports only its median cannot say whether a swing happened inside the run
  or between runs, and those two have different fixes.
- `[perf-budget][method]` - facts about the MEASUREMENT rather than about the
  code: a route whose samples sat further apart than `sampleSpreadWarnPct`, and
  any sample that fell back to the harness clock. Reported, never failed on.
- `[perf-budget][ratchet]` - printed only when there is slack worth banking: a
  ceiling a route beat by a clear margin, which an undecided ceiling is never
  offered as. "Banking the slack" above owns it.
- `[perf-budget][unmeasured]` - printed only when there is one: a ceiling this
  run could not decide, with the median it would have judged, that ceiling, the
  median's excess over it in the metric's own units, the range the samples ran
  over and how far apart they sat. It is left off the breach list and off the
  ratchet table, it is reported whichever side of the ceiling the median fell
  on, and it is NOT green. See below.

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

### One thing already tried, so nobody tries it blind again

Warming the auth chunk at module-execution time - so the browser asks for it
before hydration rather than from an effect after it - was built, tested and
measured, and it was **dropped**. The record is worth keeping because the idea is
an obvious one to have twice.

It works: `/pal` is the one route whose readiness really waits for the session to
answer, and its auth chunk started at 1183 ms against about 112 ms for every
other chunk. Moving that earlier is a genuine saving. It is just a small one, and
it is not free.

Measured on one base, seven samples a route, identical order:

| route | before | after |
| --- | --- | --- |
| `/discover` | 752 | 736 |
| `/social` | 600 | 584 |
| `/feed` | 692 | 672 |
| `/pal` | 556 | 540 |
| `/out` | 544 | 540 |
| `/tonight` | 208 | 204 |
| **`/map`** | **632** | **728** |

Four to twenty milliseconds better on six routes, and 96 ms worse on `/map`,
whose before and after distributions do not overlap (minimum 528 against 700).
The cause is bandwidth rather than scheduling: on a throttled wire the 220 KB
chunk competes with the map's own shard reads during its paint window. `/pal`'s
own gain stays small because that route waits on hydration as well as on the
chunk, so an earlier download saves tens of milliseconds rather than the hundreds
the 1183 ms figure suggests.

`/map` is the product. Captain's ruling, 2026-09-04: a 96 ms loss there outweighs
4 to 20 ms elsewhere, so the module-scope warm is not taken. An idle-scheduled
variant was deliberately NOT tried, on the same reasoning: warming after first
paint lands close to where the effect already runs, so it would buy back the
`/map` cost by giving up the gain.

### Known and not fixed

`/borough` renders on the server in about 54 ms, against 4 to 14 ms almost
everywhere else in the tree. Its client side is fine. It is the slowest server
render in the file and it is left alone here deliberately, because this change is
about the ceilings rather than the routes; it is also the best edge-caching
candidate on the list, since it reads nothing per request but the nonce.

### The image audit that found nothing, and what the copy fix cost

An earlier note implied `/u/you` had a late image paint worth fixing. It does
not: that route renders **no images at all** - `document.images.length` is 0 and
there are no image resource entries. `/pal` has exactly one, 22 KB, already
carrying width, height and sizes, and it starts after that route's own LCP
element has painted.

Both routes' LCP elements were TEXT (`/u/you` a `<p class="wantedPanel__lede">`,
`/pal` an `<h1>`), gated on hydration rather than on bytes. #1411 fixed that by
painting the copy from the HTML, and the win is large:

| route | LCP before | LCP after | ceiling |
| --- | --- | --- | --- |
| `/pal` | 1384 | **512** | 700 |
| `/u/you` | 1556 | **772** | 900 |

`/pal` improved on every metric and its ceilings ratchet with it: 1300 KB to
1050, 51 requests to 45, 1500 ms to 700.

`/u/you` did not. The same change made it **heavier**: 1375 KB over 71 requests,
against ceilings of 1290 and 66. Its LCP ceiling stands at 900 and it passes
there, but the byte and request ceilings were left exactly where they are and the
sweep reported the route over budget. Moving them to fit the measurement is the
one move this file forbids.

The route was brought back under them instead. The head of the Wanted panel is
what has to be in the HTML, not the body: the title and the lede name nobody, so
they paint before the session answers, while the capture form, the sign-in line
and the `lib/wanted` graph behind them need an account and can load after paint.
The account hub, the crews panel and the timeline are not the paint either. Five
samples of one build each, same box, same throttle:

| metric | before | after | ceiling |
| --- | --- | --- | --- |
| JS decoded (KB) | 1376 | **1199** | 1290 |
| requests | 70 | **59** | 66 |
| LCP (ms) | 764 | **612** | 900 |

The chunk that went is the 147 KB one carrying the timeline and the account hub,
plus the 44 KB `ukBasePubs` graph the Wanted resolver reaches for and four
smaller ones behind the crews panel and the password policy.

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

One ceiling carries one, and it is worth reading because of what it says about
the row rather than about the route. `/drinks` went from 400 ms to 1000 ms on
6 September 2026, on the captain's ruling. `app/drinks/page.tsx` has been a
`permanentRedirect` to `/social?tab=discover` since #765 on 6 August, so the row
has been measuring the discover tab plus one redirect round trip, while
`/discover` is budgeted 1000 ms for exactly that content and passes at 688 ms.
The 400 was written for a drink lanes page that no longer exists. Measured 684 ms
on the runner (samples 708/684/488) and, locally against a production build under
the tracked throttle, 856 ms against `/social`'s 692 ms in the same run with
identical decoded JS. It goes to `/discover`'s own figure and no further, so the
redirect can never cost more than the page it lands on. Every other route was
brought back under its ceiling instead of being given room: see "The one route
over its ceiling" above.

One correction to the record, because a gate's history is part of the gate.
#1589's own PR body said "No gate is loosened", and it was wrong twice over: that
commit took the `/drinks` LCP ceiling from 400 ms to 1000 ms on the captain's
word, which is the raise recorded above, and it added the on-the-line resample,
whose band had no upper edge and so bought extra samples on every breach and on
no figure sitting comfortably under the line. Both were argued and both were
allowed; neither was "no gate loosened". The band was made symmetric on
7 September 2026, which removes those rescue attempts and adds none, and the
`/drinks` ceiling stands where the captain put it.

Adding a route is cheap: one entry with a `readySelector` the route really
renders and one sentence of `why`. Removing one is refused by the check, because
an unmeasured route reads as a pass and never fails again.

## Which routes are budgeted

Every route the site serves a stranger. That is two lists.

**The 35 with no dynamic segment**, which is every such `page.tsx` less two:

- `/admin`, which answers 401 to an anonymous request and renders a token form
  rather than a route.
- `/map/arrival`, which is not navigable: the proxy rewrites a `/map` request to
  it when the document really differs (`lib/mapDocumentTwin.ts`), so it is
  measured as `/map`.

`/profile` is budgeted as `/u/you`, the document it actually serves. Budgeting
`/profile` measured a server redirect rather than a route, and the page clock
said so by falling back to the harness clock - which is the fallback earning its
place on its first sweep.

**And ten routes that DO carry one**, added on 7 September 2026. A dynamic
family is measured through ONE concrete instance, because that is what a browser
can open: `/borough/westminster` (the heaviest borough, 200 priced pubs on a
33,441px page), `/historic/prospect-of-whitby`, `/landmark/big-ben`,
`/ledger/venue-eltcmh`, `/bar-tab/venue-eltcmh`, `/drink/guinness`,
`/area/clapham/drink/guinness`, `/pint-index/2026-06`, plus the two static
pages that had been missed, `/spoons-value` and `/account/delete`.

The rule they close is that **a route the sitemap advertises carries a budget**,
and `__tests__/sitemap.test.ts` enforces it per family. The gap it found was
`/spoons-value`: crawlable, sitemap-listed and unmeasured while serving 683 KB
of HTML over 806 server-rendered table rows, the heaviest document this site
publishes. `scripts/check-budget-ratchet.mjs` already refuses the REMOVAL of a
budgeted route, on the reasoning that an unmeasured route reads as a pass and
never fails again; it had no rule for a crawlable route that was never added.

`/map/{city}` is the one family with no row of its own, and deliberately: `/map`
is budgeted, and a second ceiling over the same map would be two answers about
one surface. `e2e/ux-lane-perf-verification.spec.ts` reports `/map/london`
against `/map`'s own figure with the difference stated.

These ten were seeded on a laptop under the tracked throttle rather than on the
runner, so their ceilings are set in FAMILY with `/about` and `/pubs` the way
`/webmcp`'s were, not at the measured figure: a request count taken on one box
is not comparable to CI's. CI's sweep is the oracle. Take them DOWN at the next
sweep, never up.

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

## The first pin on a cold, throttled /map

The pin-ready record above is taken on a warm box with a real renderer. The
audit's R2 rig is the other question: a phone at 390x844 under a 4x CPU throttle
on Slow 4G, cold. `docs/perf/baseline-2026-09-05.md` measured the first tappable
pin there at about 14.6 s and named the eight seconds between "everything needed
is in hand" and "a thumb can hit a pin" as the next lane. This is that lane.

### What the profile found

Cold `/map`, mobile rig, local production build, one CDP session per page. Full
traces in `docs/proof/map-first-pin/`.

| moment | ms |
| --- | ---: |
| venue rows merged (`pubmax:first-pins`) | 5,743 |
| map constructed | 6,986 |
| scene built (`pubmax:map-scene-built`) | 7,722 |
| 57 `venues_slim.cell.*` ring requests opened, 7,031 -> | 7,830 |
| `maplibre-gl-shared.mjs` requested | 7,173 |
| `maplibre-gl-shared.mjs` landed (478 KB / 133 KB) | **10,948** |
| glyph range landed | 13,163 |
| first painted, tappable pin | **13,512** |

The engine's worker module took 3,775 ms for 133 KB on a wire that carries it
in about 720 ms. It was not slow; it was QUEUED. Between the scene being built
and that module landing, the map opened 57 shard-cell requests, a 190 KB ambient
POI read and, on a returning visit, the UK base manifest and its packs - none of
which the first pin needs. Only once the worker module lands can it parse the
pubs source, ask for the glyph range and place a symbol.

### The rule that shipped

**Until the pins have painted, the wire belongs to the pins.**
`lib/mapFirstPinStreams.ts` owns it and names the closed set of held lanes: the
slim shard rings, the UK base layer, the ambient POI overlay and (added after
this measurement) the London restaurant pack. Nothing is
dropped and nothing new is fetched; the sides fill in the moment the map has
something a thumb can hit. A hold is never a cage - a painted pin, the shell
deciding there is no canvas at all, or the hold's own ceiling each end it, and
that ceiling is DERIVED from `MAP_CANVAS_READINESS_CEILING_MS` rather than
typed.

### The interleaved A/B

Both arms in one process, order alternated each pair so shared box load moves
them together; one CDP session per page; every arm served through the same
interception of the cold-open init script; the arm parked on `about:blank`
between samples, because an arm left on `/map` keeps MapLibre rendering under
the same throttle and taxes whichever arm measures next. Two production builds
on two ports, so the tree stays committed while both arms are measured. Raw
output in `docs/proof/map-first-pin/`.

First visit (storage cleared on the app's own origin before every sample), five
pairs:

| | before | after |
| --- | ---: | ---: |
| **first painted, tappable pin (median)** | **15,589 ms** | **10,679 ms** |
| shared worker module landed (median) | 13,217 ms | 8,204 ms |
| glyph range landed (median) | 15,394 ms | 10,381 ms |
| pubs source loaded (median) | 15,425 ms | 8,264 ms |
| shard cells started before the pin | 59 | 4 |
| first pin, per pair | NONE / 15986 / 15635 / 15439 / 15544 | 12194 / 10723 / 10581 / 10603 / 10679 |

Returning visitor (the cold-open warm fires at load), five pairs:

| | before | after |
| --- | ---: | ---: |
| **first painted, tappable pin (median)** | **15,908 ms** | **12,644 ms** |
| shared worker module landed (median) | 13,460 ms | 10,222 ms |
| first pin, per pair | 13131 / 15877 / 15911 / 15976 / 15908 | 10660 / 12853 / 12644 / 12650 / 12605 |

Every pair favours the after arm in both tables. The `NONE` is honest: that
sample never painted a pin inside the harness's 90 s ceiling, and the median is
taken over the four figures the run printed.

**What this rig overstates.** `next start` serves HTTP/1.1, so six connections
per origin turn 59 queued shard requests into head-of-line blocking, and
production serves HTTP/2 where they multiplex. The ORDERING win is real on both
- the held bytes are not on the wire at all until the pins have painted - but a
production figure will be smaller than 4.9 s. Nothing here is written into
`perf/route-budgets.json` or `perf/cwv-baseline.json`: no ceiling moved, and
`e2e/cwv-baseline.spec.ts` remains the only writer of the recorded table.

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

- **`experimental.staleTimes` in `next.config.mjs`** is the window. See the
  [Router Cache policy](rules/app-proxy-csp-caching-and-file-tracing.md#a-tab-you-have-already-opened-is-not-a-page-you-have-to-fetch-again)
  for its safety conditions, the `/admin` document guard, and test coverage.
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

- **Five documents are prerendered; every other route is dynamic.** The
  per-request CSP nonce (`proxy.ts`) rules out static generation, ISR and PPR,
  so a nonce'd page view is a function invocation with no CDN copy to serve
  instead. That was the single largest cost in the production figures, and it
  is a policy decision rather than an implementation detail: on 2026-08-09 the
  captain took the exception named in `CDN_CACHED_DOCUMENT_PATHS`, so `/` and
  `/map` drop the nonce, prerender, and are held by the CDN; on 2026-09-05
  ("Widen") the same trade was extended to the other logged-out pages,
  `/tonight`, `/today` and `/near`. All five are public and anonymous, and their
  documents are asserted to name nobody. Every other route - identity, social,
  profile, admin, every API - keeps the nonce and keeps paying the invocation.
  The ISR window is sized per page to the clock it reads: `/tonight` and
  `/today` compose off the London hour and regenerate every five minutes;
  `/near`, `/map` and `/` read only bundled data and take an hour.
- **A prerendered document reads nothing per request.** `force-static` on those
  five pages turns a per-request read into a build error rather than a silent
  fall back to dynamic rendering, and it is also what stops the root layout's
  nonce read (`headers()`) from pulling them back;
  `__tests__/cdnCachedDocuments.test.ts` holds the proxy list and the page files
  to each other in both directions. A `/map` request whose
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
