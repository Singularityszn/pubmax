# Performance budget evidence, 22 October 2026

This change groups shared styles to reduce blocking requests during page arrival. The full budget sweep still has unresolved breaches.

This PR depends on [#2319](https://github.com/Singularityszn/pubmax/pull/2319).
Its readiness commit was cherry-picked as `2f0bc9752` before measurement.
The application base is `90864cf3f`.

## Method and limits

Both sweeps use production builds in `.next-perf-budget-breaches-1022` and the same private server port, 3532.
Both builds use the environment from `scripts/print-e2e-server-env.ts`.
The installed lockfile and dependencies remain unchanged.

The measurement calls `preparePerfPage`, `runPerfRoute`, and `measurePerfRedirect` from `e2e/helpers/perfMeasurement.ts`.
It reads all 50 routes from `perf/route-budgets.json`, in their recorded order.
Both sweeps use fresh browser contexts and the same route order.
They retain the recorded warmups, samples, resampling rules, and median calculation.
They use the recorded 390 by 844 viewport, 4x CPU throttle, Fast 4G settings, and third-party blocking.
`judgeBudgets` decides breaches and unmeasured clocks.

The temporary measurement spec and raw samples remain under `artifacts/perf-budget-breaches-1022/`.
`before.json` and `after.json` also retain resource URLs and decoded sizes.
The standard sweep uses the same measurement functions:

```sh
PUBMAX_PERF_BUDGET=1 npx playwright test e2e/performance-budget.spec.ts --project=chromium --workers=1
```

These figures describe the repository's arrival budgets. They do not measure live map tiles or first-pin latency.
The sweeps ran sequentially on a shared host. Clock changes require more evidence before they count as improvements.
Request counts and script sizes provide the evidence for this change.

## Priority and cause

1. Phone `/map` came first. It met its budgets. Shared navigation grouping reduces its requests without changing map-specific code.
2. `/tonight` needed 31 stylesheet requests. Eight requests loaded shared navigation and launch primitive styles.
3. `/near` and `/pal/chat` carried the same fragmented shared styles on their arrival paths.
4. `/out` serves the Tonight surface and carries the same request and script costs.
5. `/today` and `/crawls` needed repeat paint measurements. `/pint-index` needed its extra arrival requests removed.

Shared navigation styles now enter through `components/nav/navigation.css`.
The five launch primitives share `components/ui/primitives.css`.
Each original stylesheet keeps its rules. The new entry files use CSS imports and preserve the measured import order.
Standalone consumers use the same entries, including the loading shell, shared-pint control, and Pint Index arrival.

Both sign-in links also set `prefetch={false}` in `components/auth/SignInButton.tsx`.
This removes three unused sign-in requests after arrival. Those requests fall outside the budget boundary and do not explain the numeric improvement.
The links keep their destinations and their normal click behaviour.
The phone and desktop sign-in surfaces remain available.
No numeric ceiling or measurement setting changes.

## Original breaches and local comparison

The earlier values come from #2319. The local values come from this checkout's two sweeps.

| Route | Metric | Earlier PR | Local before | Local after | Ceiling |
| --- | --- | ---: | ---: | ---: | ---: |
| `/map` | Requests | Not breached | 128 | 125 | 160 |
| `/tonight` | Requests | 62 | 62 | 56 | 56 |
| `/near` | Requests | 53 | 53 | 49 | 52 |
| `/pal/chat` | Requests | 50 | 50 | 46 | 46 |
| `/pal/chat` | JavaScript KB | 1175 | 1175 | 1175 | 1040 |
| `/out` | Requests | 62 | 62 | 56 | 49 |
| `/out` | JavaScript KB | 1037 | 1037 | 1037 | 1010 |
| `/today` | Largest paint ms | 380 | 180 | 168 | 300 |
| `/crawls` | Largest paint ms | 424 | 296 | 292 | 300 |
| `/pint-index` | Requests | 46 | 46 | 42 | 45 |

The local baseline had seven numeric breaches. The final sweep has three.
Tonight, Near, Pub Pal, and Pint Index now meet their request ceilings.
The earlier `/today` and `/crawls` paint breaches did not reproduce as numeric breaches here.
The baseline marked `/crawls` paint unmeasured because its samples crossed 300 ms and disagreed.
The final `/crawls` samples all stayed below 300 ms.
These results do not establish a clock improvement or resolve the earlier paint failures on another runner.

## Remaining evidence

- `/out` still downloads 1,037 KB of JavaScript against 1,010 KB. It serves the Tonight surface and carries the same script footprint.
- `/out` still needs 56 requests against 49. Its stylesheet count fell from 31 to 25, but the remaining assets still exceed the ceiling.
- `/pal/chat` still downloads 1,175 KB of JavaScript against 1,040 KB.
  Its 128 KB chunk `28hu28143rq50.js` contains the station and locality datasets.
  `PalChat.tsx` imports `refineRoutedAskQuery` from `lib/ask/router.ts`.
  That router imports `lib/ask/placePhrases.ts`, which imports both datasets.
  Further splitting must preserve follow-up geography and venue acceptance behaviour.

The final run also marked `/social` paint unmeasured. Its samples ranged from 164 to 408 ms against 400 ms.
Its median was 164 ms. The spread rule marks the clock as unmeasured, so this is not a pass.
The final measurement test exits 1 because the three numeric breaches remain.
The nightly performance job is not established as green.

A Next.js stylesheet graph trial increased Tonight from 62 to 63 requests and changed spacing.
That trial was removed. `next.config.mjs` remains unchanged.
A separate sign-in-only trial removed three background requests without reducing the measured request count.
The final request reduction comes from grouping blocking stylesheets.

## Style cost and visual checks

All nine original CSS files remain unchanged. The new files import their existing rules.
Sharing styles also sends some unused rules to smaller surfaces.
Summed, rounded resource sizes show about 21 KB more CSS on `/account/delete`.
They show about 17 KB more on `/login` and `/signin`. Those routes still meet every unchanged numeric ceiling.

Screenshots cover `/tonight`, `/near`, `/pal/chat`, `/crawls`, and `/pubs` at 390 and 1440 pixels wide.
All ten before-and-after pairs match pixel for pixel in their captured viewport.
The sampled heading, navigation, and main-container styles and positions also match in all ten cases.
These are local Chromium checks, not physical-device proof.

## Checks

- `npm run typecheck` passed.
- ESLint passed on every changed TypeScript component and the inherited gallery spec.
- `npx vitest related <changed component files> perf/route-budgets.json e2e/mobile-pubs-gallery.spec.ts --run` passed 2,719 tests in 243 files.
- `playwright test e2e/mobile-pubs-gallery.spec.ts --project=chromium --workers=1` passed both tests.
- The final isolated production build passed with `NEXT_DIST_DIR=.next-perf-budget-breaches-1022`.
- Both complete 50-route measurements finished. The final sweep retained three numeric breaches and one unmeasured clock.
- The budget diff changes only the inherited `/pubs` readiness selector. All numeric ceilings remain unchanged.

Fast path: no-mistakes gate and full local verify skipped by captain decision; CI runs the full suite.

## Complete route comparison

Each cell gives **before / after**. Paint means largest contentful paint, the browser's largest visible content paint.
These are medians under the recorded method. An unmeasured clock retains its number without claiming a verdict.

| Route | Server ms | JavaScript KB | Requests | Paint ms |
| --- | ---: | ---: | ---: | ---: |
| `/` | 7 / 2 | 856 / 856 | 43 / 40 | 476 / 456 |
| `/pal` | 2 / 2 | 915 / 915 | 44 / 40 | 420 / 396 |
| `/map` | 88 / 86 | 2778 / 2777 | 128 / 125 | 152 / 144 |
| `/today` | 88 / 88 | 995 / 995 | 51 / 46 | 180 / 168 |
| `/tonight` | 87 / 86 | 1037 / 1037 | 62 / 56 | 172 / 164 |
| `/out` | 88 / 88 | 1037 / 1037 | 62 / 56 | 256 / 256 |
| `/about` | 90 / 89 | 771 / 771 | 38 / 35 | 176 / 160 |
| `/pubs` | 87 / 87 | 1041 / 1041 | 50 / 47 | 184 / 176 |
| `/webmcp` | 88 / 87 | 844 / 844 | 36 / 34 | 156 / 152 |
| `/near` | 87 / 88 | 1004 / 1004 | 53 / 49 | 156 / 156 |
| `/login` | 87 / 88 | 808 / 808 | 37 / 34 | 164 / 156 |
| `/signin` | 85 / 87 | 808 / 808 | 37 / 34 | 256 / 240 |
| `/plan` | 88 / 87 | 1084 / 1084 | 47 / 44 | 168 / 156 |
| `/pal/chat` | 89 / 88 | 1175 / 1175 | 50 / 46 | 164 / 156 |
| `/social` | 88 / 87 | 1071 / 1071 | 55 / 51 | 184 / 164 |
| `/feed` | 87 / 88 | 1071 / 1071 | 55 / 51 | 272 / 264 |
| `/discover` | 88 / 89 | 1071 / 1071 | 56 / 52 | 320 / 312 |
| `/drinks` | 89 / 85 | 1071 / 1071 | 56 / 52 | 328 / 308 |
| `/messages` | 88 / 86 | 797 / 797 | 39 / 35 | 476 / 432 |
| `/activity` | 87 / 86 | 814 / 814 | 41 / 37 | 164 / 160 |
| `/u/you` | 86 / 87 | 956 / 956 | 48 / 46 | 168 / 172 |
| `/onboarding` | 11 / 8 | 0 / 0 | 1 / 1 | 0 / 0 |
| `/choose-city` | 2 / 1 | 0 / 0 | 1 / 1 | 0 / 0 |
| `/moment` | 88 / 87 | 799 / 799 | 38 / 35 | 176 / 168 |
| `/rounds` | 86 / 87 | 787 / 787 | 38 / 35 | 164 / 164 |
| `/crawls` | 87 / 87 | 887 / 887 | 45 / 41 | 296 / 292 |
| `/borough` | 87 / 89 | 771 / 771 | 41 / 36 | 180 / 176 |
| `/historic` | 86 / 85 | 773 / 773 | 43 / 38 | 212 / 204 |
| `/pint-index` | 89 / 90 | 850 / 850 | 46 / 42 | 196 / 184 |
| `/founders` | 87 / 88 | 771 / 771 | 37 / 33 | 168 / 164 |
| `/contributors` | 87 / 87 | 771 / 771 | 38 / 33 | 164 / 168 |
| `/we-are-out` | 86 / 88 | 794 / 794 | 36 / 34 | 164 / 168 |
| `/privacy` | 88 / 86 | 771 / 771 | 36 / 34 | 200 / 192 |
| `/terms` | 87 / 86 | 771 / 771 | 36 / 34 | 168 / 168 |
| `/credits` | 87 / 89 | 771 / 771 | 35 / 33 | 172 / 168 |
| `/how-we-estimate` | 87 / 87 | 771 / 771 | 37 / 35 | 176 / 160 |
| `/price-pulse` | 87 / 88 | 771 / 771 | 39 / 36 | 180 / 168 |
| `/places` | 86 / 87 | 929 / 929 | 42 / 38 | 160 / 160 |
| `/borough/westminster` | 88 / 87 | 779 / 779 | 46 / 41 | 288 / 272 |
| `/historic/prospect-of-whitby` | 87 / 88 | 779 / 779 | 43 / 39 | 180 / 164 |
| `/landmark/big-ben` | 87 / 86 | 773 / 773 | 37 / 35 | 164 / 160 |
| `/ledger/venue-eltcmh` | 87 / 87 | 856 / 856 | 47 / 46 | 168 / 160 |
| `/bar-tab/venue-eltcmh` | 87 / 88 | 822 / 822 | 44 / 42 | 160 / 160 |
| `/spoons-value` | 88 / 86 | 781 / 781 | 40 / 36 | 288 / 312 |
| `/drink/guinness` | 86 / 88 | 771 / 771 | 38 / 35 | 168 / 168 |
| `/area/clapham/drink/guinness` | 87 / 88 | 771 / 771 | 38 / 36 | 236 / 232 |
| `/pint-index/2026-06` | 90 / 88 | 771 / 771 | 37 / 34 | 164 / 160 |
| `/account/delete` | 87 / 87 | 724 / 724 | 33 / 32 | 168 / 156 |
| `/feedback` | 87 / 86 | 771 / 771 | 36 / 33 | 156 / 156 |
| `/updates` | 86 / 87 | 771 / 771 | 36 / 34 | 156 / 156 |

## Samples for the priority routes and original breaches

| Route | Metric | Before samples | After samples |
| --- | --- | --- | --- |
| `/map` | Requests | 127, 128, 128 | 125, 127, 124 |
| `/tonight` | Requests | 62, 62, 62, 62, 62 | 56, 56, 56, 56, 56 |
| `/near` | Requests | 53, 53, 53, 53, 53 | 49, 49, 49, 49, 49 |
| `/pal/chat` | Requests | 50, 50, 50, 50, 50 | 46, 46, 46, 46, 46 |
| `/pal/chat` | JavaScript KB | 1175, 1175, 1175, 1175, 1175 | 1175, 1175, 1175, 1175, 1175 |
| `/out` | Requests | 62, 62, 62, 62, 62 | 56, 56, 56, 56, 56 |
| `/out` | JavaScript KB | 1037, 1037, 1037, 1037, 1037 | 1037, 1037, 1037, 1037, 1037 |
| `/today` | Largest paint ms | 244, 208, 184, 172, 180, 172, 176 | 168, 168, 164, 160, 164, 168, 168 |
| `/crawls` | Largest paint ms | 280, 300, 292, 296, 296, 304, 356 | 284, 292, 296, 296, 296, 284, 280 |
| `/pint-index` | Requests | 46, 46, 46, 46, 46 | 42, 42, 42, 42, 42 |
