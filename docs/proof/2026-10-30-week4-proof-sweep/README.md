# Week 4 proof sweep, 30 October 2026: Linux container, not acceptance, UNVERIFIED

This folder is the record of the week 4 performance sweep that
`docs/plans/ROUND6_FREEZE_AND_PROOF_2026-10-30.md` asked for. It was taken on
`main` at 734b39e9 in a Linux cloud container, on a quiet box, with Chromium
153 build 1243 standing in for the 1248 that Playwright 1.64.0 asks for. Every
figure here is UNVERIFIED: the macOS CI sweep (`performance-budget` job) is
the oracle for `perf/route-budgets.json`, and nothing in this folder moves a
ceiling. The launch head is swept again, on macOS, after PRs 2402 and 2412
merge and before the public build.

## What is in the folder

| File | What it is |
| --- | --- |
| `route-sweep-excerpt.txt` | The route budget sweep's breach table, undecided table, the samples for every route named in them, the ratchet table and the result lines. 52 routes, 26.9 minutes. |
| `ceilings-down.patch` | A patch against 734b39e9 that would lower 71 ceilings on 35 routes by the file's own margins. NOT applied. Kept as the record of what the sweep saw. |
| `proposed.tsv` | The same 71 proposals as a table: route, metric, samples, old ceiling, new ceiling. |
| `cwv-sweep.txt` | The Core Web Vitals sweep, three runs a cell, which stopped at its own interaction fence. |

## How it was taken

| Item | Value |
| --- | --- |
| Source | Production build of `main` at 734b39e9 (15 commits behind 538e3e28 at the time of writing). |
| Box | Linux cloud container, 4 cores, software WebGL (WebGL2 worked and the map painted its pins). The route sweep started at load average 0.0 with no other build or browser run. |
| Browser | Chromium 153.0.8010.12, Playwright build 1243, linked as build 1248 in a private browsers path. Playwright 1.64.0. |
| Method | The `method` block in `perf/route-budgets.json`: one warm-up, three measured runs, two resamples when a route needs more evidence, 390 by 844, 4x CPU throttle, Fast 4G, third parties blocked. |
| Commands | `npx playwright test e2e/performance-budget.spec.ts --project=chromium --workers=1` with `PUBMAX_PERF_BUDGET=1 PUBMAX_E2E_KEYLESS=1`; `node scripts/probe-api-budgets.mjs` against the same server; `npm run perf:cwv-sweep` with `PUBMAX_CWV_RUNS=3`. |
| Build ID | Not recorded. |

## What the sweep found

### Ceilings with slack (not banked)

71 ceilings on 35 routes sat under their ceiling by more than the file's
margins (bytes and requests at the p75 sample plus 15 percent, LCP at the worst
sample plus 25 percent, server render untouched at the 150 ms floor). The
patch and `proposed.tsv` hold them. They are not applied, for one reason: 44
of the 71 are LCP, and this same sweep read twelve light shells at about
400 ms against 300 ms ceilings that were set on macOS, so the two platforms'
clocks do not agree route by route. A Linux LCP ceiling can turn a healthy
macOS route red. The 27 byte and request figures do not depend on the box,
but the lane rule is that the macOS sweep banks the slack. `/map` bytes
(2839 KB against 3400) and requests (127 to 130 against 160) appear in
`proposed.tsv` but were held out of the patch on purpose, because the map
behaved unlike every earlier record on this box (below): the patch holds 69
of the 71 proposals plus the two `/map` rows left as they are, 35 routes in
all.

### Breaches (no ceiling moved)

The failing assertion's table, from `route-sweep-excerpt.txt`:

| Route | Metric | Measured | Ceiling | Reading |
| --- | --- | --- | --- | --- |
| `/map` | LCP | 10,188 ms (samples 10,220 / 10,188 / 10,184) | 900 ms | Unresolved. A near-zero spread at 10.2 s looks like a timer, perhaps the 8 s style-load timeout plus about 2 s, not a slow paint. The rules file records 716 to 792 ms on this method. Needs an A/B against an older build on the same box. |
| `/pal/chat` | JS decoded | 1,183 KB on all five samples | 1,040 KB | Probably a real change on `main`: bytes do not depend on the box. Nine Pal commits landed on 30 October. To be bisected on `main`. |
| `/today` | LCP | 1,064 ms (976 to 1,080 over seven samples) | 300 ms | Unresolved. Consistent and large. |
| `/social`, `/feed` | LCP | about 1,000 ms (932 to 1,072) | 400 ms | Unresolved. Same shell as `/today`. |
| `/discover`, `/drinks` | LCP | 1,136 and 1,060 ms | 1,000 ms | Same shell; `/drinks` redirects to the discover tab. |
| `/out` | server render | 248 ms (one redirect sample) | 150 ms | Probably a cold first hit: every other render is 3 to 95 ms. |
| `/signin`, `/activity`, `/moment`, `/rounds`, `/crawls`, `/historic`, `/pint-index`, `/terms`, `/places` | LCP | 396 to 512 ms | 300 or 400 ms | Box reading likely: light shells reading about 400 ms against ceilings set on macOS, with bytes and requests well under their ceilings on the same run. |

Five ceilings were undecided (`/pal/chat` LCP, `/messages` LCP, `/borough`
LCP, `/historic` and `/pint-index` server render): one sample met the ceiling,
another went past it, and the median sat within half the spread of the line.

### Core Web Vitals sweep

The sweep stopped at its own interaction fence: the map's primary action
never appeared on any of the four `/map` rows, so their INP is the 16 ms
Event Timing floor and the spec never reached its comparison with
`perf/cwv-baseline.json`. The baseline was not refreshed. Read by hand
against the recorded table with the spec's tolerances:

- Better than the baseline: mobile `/`, `/tonight` (cold 2,208 to 1,468 ms)
  and `/plan`; desktop `/` and `/pal` (cold 828 to 420 ms).
- Past the tolerance, stated plainly:

| Row | Baseline | This sweep | Allowed |
| --- | --- | --- | --- |
| mobile `/map?sel=` cold LCP | 7,924 ms | 10,696 ms | 10,301 ms |
| mobile `/map?sel=` warm LCP | 8,464 ms | 13,832 ms | 11,003 ms |
| mobile `/map` cold CLS | 0.006 | 0.053 | 0.036 |
| mobile `/today` cold and warm CLS | 0.000 | 0.035 | 0.030 |
| mobile first tappable pin on `/map` | 13,330 ms | 21,691 ms | 17,329 ms |
| mobile editable plan | 1,960 ms | 3,793 ms | 2,548 ms |
| desktop first tappable pin on `/map` | 4,713 ms | 14,363 ms | 6,127 ms |
| desktop venue sheet | 4,119 ms | 6,800 ms | 5,355 ms |
| desktop editable plan | 897 ms | 1,447 ms | 1,297 ms |
| desktop acknowledged save | 701 ms | 1,132 ms | 1,101 ms |

Mobile `/map` LCP read 1,152 ms against a baseline of 8,132 ms while the first
tappable pin got slower and the primary action never showed. The likely
reading is that LCP now lands on an early shell paint while the map itself is
slower on this box. Whether that is the box or `main` is not decided here.

### API budgets

All six probed routes sat inside their ceilings on the local server
(`/api/whats-on` median 15 ms and p95 171 ms; the other five under 25 ms at
p95). Loopback is not production, so the rows stay as they are.

## What happens next

- No ceiling moves on this evidence, up or down.
- The `/pal/chat` script growth is bisected on `main` by build output, which
  needs no browser.
- The `/map`, `/today`, `/social` and `/feed` timings and the first-pin
  regression need an A/B on one box, or the macOS job, before anyone reads
  them as the product's.
- The launch head, after PRs 2402 and 2412 merge, is swept again on macOS
  before the public build.
