# map-selection-inp (2026-10-17)

Record of its day. Follow-up to `docs/proof/map-p99-vitals-tail/`, taking the
first remaining cause it ranked: the /map venue-selection frame.

## What real users show

The consent-gated `web_vital` event (PostHog, last 30 days) carries the
interaction target. On /map the commonest slow interaction is a tap on the
canvas, which is what selects a pin: n=22, p75 192 ms, p99 320 ms. Across every
route only five interactions passed 500 ms in the window: two on `/pal/chat`,
two on /map (a sheet close tap at 552 ms and one whose target was already
removed at 547 ms) and one 5.2 s tap on `/plan/[id]`. The INP p99 tail is
those outliers, not the ordinary pin tap.

## What the lab shows

Rig as in `map-p99-vitals-tail`: local production builds, 390x844 phone, 4x CPU,
Slow 4G, SwiftShader WebGL, stubbed basemap. These builds also carried
`productionBrowserSourceMaps` (local only, never committed) so that
`lab/profsel.mjs` and `lab/analyze.mjs` could name source frames.

- A trace of the tap (`lab/tracesel.mjs`) puts the main thread's first paint at
  about 350 ms after the tap, while Event Timing reports about 1 s. The gap is
  software-GL presentation of the map canvas. Lab INP on this rig is therefore
  dominated by SwiftShader and is not comparable to a phone's GPU. Main-thread
  numbers are the meaningful ones.
- After a tap the main thread stays about 100% busy for 3 s or more. The tap's
  own task is about 290 ms (React sync render plus commit). Then come the
  panel chunk's evaluation, the two per-pub reads, a resume snapshot write per
  camera settle, and a second full PubMap pass.

### Tried and NOT shipped: deferring the panel mount

Rendering the sheet and its skeleton in the tap's frame, and mounting the panel
through `useDeferredValue`, cut the longest task after a tap from 463 to 357 ms
and the tap's own task from 285 to 226 ms (8 interleaved pairs, medians). But
the panel's content painted later: median 3.28 s before against 3.64 s after on
a first open. Starting the chunk download at the tap still left it at 3.85 s
median, with three runs past 4.1 s. A deferred render is interruptible, and the
camera flight and the per-pub reads keep restarting it. Seconds of extra
skeleton is a worse product than a long task, so it was reverted.

### Shipped

1. `createMemberStabilizer` holds the filter pipeline's list while it has the
   same venue objects in the same order. A pub's own reads rebuild the venue
   signals, and before this every such rebuild re-ran the suggested crawl
   (`buildCrawlRoute`, a sort and score of every pub) and every memo below it.
2. `useCommunityPrices` holds the previous freshest-pint answer in a closure
   instead of state. The state write during render (shipped in
   `map-p99-vitals-tail`) made React run PubMap a second time on every price
   read: three runs per read instead of two, pinned by
   `__tests__/communityPriceFreshestRender.test.tsx`.

Source-mapped CPU profiles of the 4 s after the tap, 3 per arm, medians:

| work | before | after |
| --- | --- | --- |
| `buildCrawlRoute` | 133 ms | 89 ms |
| PubMap's own render | 311 ms | 259 ms |
| all component render (`renderWithHooks`) | 544 ms | 452 ms |

End to end, 6 interleaved pairs, medians, none significant (Mann-Whitney):

| metric | before | after | p |
| --- | --- | --- | --- |
| longest task in 5 s after the tap | 659 ms | 471 ms | 0.30 |
| long-task total in 5 s | 2,945 ms | 2,837 ms | 0.34 |
| the tap's own task | 291 ms | 300 ms | 0.75 |
| panel painted | 3,111 ms | 3,552 ms | 0.34 |

The change removes about 90 ms of main-thread work in a 3 s busy period. That
is real and pinned by tests, but too small to show end to end at this n.
