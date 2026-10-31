# Round 5 performance sweep, 30 October 2026: a loaded-box run, not acceptance

This folder holds the saved evidence behind the three round 5 rows in
`perf/route-budgets.json`: `/time-machine`, `/board/venue-eltcmh` and
`/dog-of-the-week`. It is the record of ONE measuring run on a Linux cloud
container with software WebGL while other agents' builds shared the box. It is
not acceptance. The macOS CI sweep (`performance-budget` job) is the oracle, and
the ceilings come down to its figure at the next sweep.

`sweep-excerpt.txt` is copied from the run's Playwright log, filtered to the
three routes. The server origin is replaced with `<server>`; nothing else is
edited.

## What the run was

| Item | Value |
| --- | --- |
| Source | Production build of this branch at `b67983ad` |
| Build ID | Not recorded. The worktree that held `.next-prod` was removed after the merge, so the `BUILD_ID` file is gone. |
| Data | The committed tree at `b67983ad`; `data/freshness_registry.json` at that commit is the registry it read. |
| Command | `PUBMAX_PERF_BUDGET=1 PUBMAX_E2E_KEYLESS=1 PW_SKIP_KEYLESS_WEBSERVER=1 npx playwright test e2e/performance-budget.spec.ts --project=chromium --workers=1`, against a production server on a private port, keyless |
| Method | The `method` block in `perf/route-budgets.json`: Desktop Chrome, device scale 1, one warm-up, three measured runs, two resamples when a route needs more evidence: either its samples disagree (the percentage spread past the tracked 12 percent width AND the span past the metric's absolute floor, 250 ms for LCP and 25 ms for server render) or the median sits within 10 percent of a ceiling (`routeNeedsMoreEvidence` in `lib/performanceBudgets.ts`). `e2e/helpers/perfMeasurement.ts` stamps the counting boundary from the page and leaves out resources that start after it. |
| Playwright | 1.64.0, project `chromium` = `devices["Desktop Chrome"]` |
| Browser | Chromium 153.0.8010.12, Playwright build 1243, linked as build 1248 because Playwright 1.64.0 asks for 1248. CI's macOS runners use the real 1248. |
| Box | Linux cloud container, 4 cores, software WebGL, other builds running at the same time. The whole 55-row sweep took 34.3 minutes. |
| Warm-up | One warm-up load per route is spent before the counted samples. The log prints only the counted samples; the warm-up's figures are not recorded. |

## The recorded samples

Columns are the samples in the order taken, the median and the spread.

| Route | Metric | Samples | Median | Spread |
| --- | --- | --- | --- | --- |
| `/time-machine` | server render (ms) | 32 / 33 / 36 | 33 | 12% |
| `/time-machine` | JS decoded (KB) | 788 / 788 / 788 | 788 | 0% |
| `/time-machine` | requests | 35 / 35 / 35 | 35 | 0% |
| `/time-machine` | LCP (ms) | 456 / 484 / 464 | 464 | 6% |
| `/board/venue-eltcmh` | server render (ms) | 24 / 20 / 38 | 24 | 75% |
| `/board/venue-eltcmh` | JS decoded (KB) | 833 / 833 / 833 | 833 | 0% |
| `/board/venue-eltcmh` | requests | 37 / 37 / 37 | 37 | 0% |
| `/board/venue-eltcmh` | LCP (ms) | 420 / 352 / 496 | 420 | 34% |
| `/dog-of-the-week` | server render (ms) | 26 / 35 / 27 / 20 / 29 | 27 | 56% |
| `/dog-of-the-week` | JS decoded (KB) | 776 / 776 / 776 / 776 / 776 | 776 | 0% |
| `/dog-of-the-week` | requests | 32 / 32 / 32 / 32 / 32 | 32 | 0% |
| `/dog-of-the-week` | LCP (ms) | 452 / 376 / 296 / 316 / 328 | 328 | 48% |

`/dog-of-the-week` has five samples because the median of its first three LCP
samples (452 / 376 / 296, median 376 ms) sat within 10 percent of the 400 ms
ceiling, the near-ceiling rule in `lib/performanceBudgets.ts`
(`medianSitsOnTheLine`). The spread rule did not fire: it needs the percentage
past the 12 percent width AND the span past the metric's floor, and those three
samples span 156 ms against the 250 ms LCP floor. The two resamples (316 and
328 ms) moved the median to 328 ms.

## How to read it

- Bytes and requests are stable at 0 percent spread on every route. They are
  the figures the two lowered ceilings rest on.
- Timing is not proof from this box. `/board/venue-eltcmh` server render spread
  75 percent and LCP 34 percent; `/dog-of-the-week` spread 56 and 48 percent.
  Those percentages alone are not a method breach: the spread rule also needs
  the span past the metric's floor, and none of these did. The rule decides on
  the first three samples: the board's LCP span is 144 ms and the dog's 156 ms
  against the 250 ms floor, and the server render spans are 18 ms (board,
  24/20/38) and 9 ms (dog, 26/35/27) against 25 ms. They say only that one loaded
  box moved the clocks by a third to three quarters between samples, which is
  why the timings are weak evidence and the macOS sweep is the oracle.
- `/dog-of-the-week` recorded one LCP sample, 452 ms, above the 400 ms seeded
  ceiling. The median, 328 ms, sits 72 ms under it, so the run listed the row
  as undecided rather than as a breach. The ceiling stays at 400 ms. It was not
  raised, and it stays open as "cause to be found".
- The run's route-budget test failed on rows that are main's, not this
  branch's: `/contributors` LCP median 476 ms over 400 and `/historic` 540 ms
  over 400, with 16 clocks the loaded box could not decide. The three round 5
  rows were not on the breach list.

## What was written from it

| Route | Was (seed) | Now | Rule |
| --- | --- | --- | --- |
| `/time-machine` | 2600 KB, 50 requests, 800 ms LCP | 907 KB, 41 requests, 605 ms LCP | bytes and requests p75 plus 15 percent, rounded up; LCP worst sample plus 25 percent; server render the 150 ms floor |
| `/board/venue-eltcmh` | 1070 KB, 54 requests, 850 ms LCP | 958 KB, 43 requests, 620 ms LCP | the same |
| `/dog-of-the-week` | 960 KB, 43 requests, 400 ms LCP | unchanged | held, with one sample above the LCP seed |

Every recorded sample sits under the ceiling written from it. No existing
ceiling moved.
