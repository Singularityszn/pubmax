# Home CWV failure - R18 source-only receipt

Checkout: `/Users/karanmanoharan/.codex/worktrees/v0-integration/pubmaxx`.
Reviewed 2026-09-30. Ownership: this temporary receipt only. No repo edits,
tests/build/browser/runtime/install/network/index/publication. No cause or fix
is claimed from source review.

## Actual result and comparison

R18 strict sweep terminal EXIT1. Root reports all90 route samples valid and
Home budget unchanged1010KiB/45requests. Failure is not an invalid-sample fallback.

Evidence:

- `/tmp/pubmaxx-final-cwv5-r18-strict.log:11-14,99-100`.
- `/tmp/pubmaxx-final-cwv5-r18-strict-results/cwv-baseline-Core-Web-Vita-561b5-CLS-and-the-product-timings-chromium-cwv/cwv-run.json`.
- `/tmp/pubmaxx-final-cwv5-r16-strict.log:10-13` and corresponding R16 strict
  results `cwv-run.json` in same spec subdirectory.

| Mobile Home | R16 strict | R18 strict |
| --- | --- | --- |
| Cold LCP samples, ms |3892/1424/1428/1420/1428|4560/1564/1624/3020/2648|
| Cold INP samples, ms |288/88/88/80/80|360/144/624/536/376|
| Cold median LCP / INP, ms |1428/88|2648/376|
| Warm median LCP / INP, ms |1424/96|1748/160|
| Warm INP samples, ms |88/88/96/96/96|312/160/496/120/96|

Cold LCP exceeds2032*1.30=2641.6ms by6.4ms. Cold INP exceeds184ms allowance
by192ms, with four of five individual cold samples over184. Warm baseline152ms
has its own232ms allowance; two warm samples312/496 exceed232 while warm median
160 remains within allowance. This is a material input
latency failure, not just a marginal LCP rounding issue.

Fast LCP sample1624ms coexists with worst INP624ms. A single slow image download
does not explain that relationship by itself. Desktop Home remains near prior
figures: R18 cold700/96, warm684/96 versus R16 cold688/104, warm696/104.
That is consistent with mobile-throttle sensitivity, not proof of host noise.

## Source delta and measurement boundaries

R16 production receipt `/tmp/pubmaxx-persistent-recovery-r16.log` stamps release
`ab1b289`. Comparing `ab1b289da` to current HEAD `5de246205` shows only validation,
docs and browser tests: no Home production handler/layout change in that range.
Current working diff is scoped map kind/filter and associated tests. Explicit
diff of landing components, app/page, app/layout, AuthProvider, mapWarmup and
analytics against R16 is empty. This is source equality for those paths, not
proof that compiled chunk scheduling or browser/host conditions are identical.

Commit58d6b5f84 moves aggregation into validating helpers and logs raw samples.
`lib/webVitalsBaseline.ts:273-288` rejects invalid/uninteracted samples and then
uses ordinary median on each metric. `e2e/cwv-baseline.spec.ts` diff retains
sampleRoute load/settle/interaction steps. Valid five-sample medians are not
inflated by this change. No observer/primary-action method change found here.

Current measurement:

- `e2e/helpers/webVitals.ts:112-119` seeds returning-visitor dismissals and denies
  analytics on every document. No PostHog consented collection is expected.
- LCP observer138-141 stores latest native candidate time; event observer154-167
  keeps worst duration with nonzero interactionId, including pointer/click stages.
  Current artifacts store durations, not target, processing phases or task source.
- `e2e/cwv-baseline.spec.ts:125-153` waits load, visible main,1s settle, then native
  primary click. It does not explicitly assert React hydration completion.
- Home primary `webVitals.ts:315-318` selects first `[data-primary-action]` link.
  `components/landing/LandingHero.tsx:313-320` renders it as Next Link
  `/near?locate=1` (`lib/landingHero.ts:86`),
  prefetchfalse, with analytics click callback. It is NOT Near-me geolocation
  button and NOT map warm control.
- `webVitals.ts:362-372` adds capture listener preventing navigation only. Next
  Link/default navigation is suppressed while React analytics handler runs.
  `lib/analytics.ts:371-374` returns before sanitizer/payload/network when consent
  denied. No expensive geolocation, venue-index rank or route transition is
  intentionally part of measured Home click.
- `LandingPage.tsx:78-85` map warming handlers belong to map links and only exist
  with preferred city. Cold origin storage is cleared; primary has none of these.

## Ranked, falsifiable causes to attribute

1. **Queued startup work or selective hydration delays first input.** SSR primary
   is visible before a proven hydrated state. Link and whole hero live in client
   component (`LandingHero.tsx:1,208-225,313-320`); mandatory auth and other startup
   tasks can overlap tap. Prediction: Event Timing input-delay or script processing
   dominates, with native long-task/trace attribution to hydration/module evaluation.
   This is plausible, not established. Preserve eager auth bootstrap.
2. **Paint/decode contention near primary action.** `LandingHero.tsx:421` marks
   anchor photo priority; `LandingPhoto.tsx:59-61` requests synchronous decode,
   eager loading and high fetch priority. Prediction: observed LCP or click frame
   points to that image with decode/paint work dominating presentation delay.
   No current LCP element is recorded, so do not assume photo is LCP.
3. **Mobile host/resource scheduling variation.** Cold/warm variability, stable
   desktop and first cold outlier in both runs fit contention, but there is no
   host telemetry or browser task attribution in receipts. Prediction: slowdown
   repeats without relevant app work, correlates with scheduler stalls and changes
   under controlled serial same-build repetition. Calling it noise now would waive
   real failure. All valid samples remain included.

Deferred feed is existing genuine viewport boundary:
`components/landing/DeferredPintDropStrip.tsx:17-29` imports only when within240px
of viewport. Do not alter threshold or add settle waits to make probe cheaper.
Check whether Playwright scroll and feed intersection coincide with slow tap.

## Concrete conditional candidate, not approved patch

If native trace attributes delay to synchronous anchor-image decode, smallest
durable candidate is asynchronous decode in LandingPhoto while retaining eager
loading, high fetch priority, dimensions, identical image and authentic content.
This changes real paint scheduling without hiding content, delaying auth or
moving measurement boundary. Prove native image readiness and LCP do not worsen.

If trace instead proves selective hydration/client reconciliation dominates, image
change is wrong fix. Next candidate is existing static hero frame/heading/map
ownership on server with only interactive CTA and near-answer card as client
islands, preserving actual navigation and analytics. That is broader source work
and needs separate review; no such extraction is recommended solely from scalar
INP. Do not substitute native full navigation simply to bypass measured handler.

## Required native attribution diagnostic after runtime release

One serial unchanged-build mobile Home loop, same installed helper/profile,
consent/dismissals, load+main+1s boundary and navigation suppression. Five cold
samples retain all values; capture first sample separately rather than discard.
Do not clear server caches, extend settle time, disable auth or change budgets.

Before navigation, add native buffered observers that record:

- Event Timing name/target/interactionId/startTime/processingStart/processingEnd/
  duration. Split input delay, handler processing and presentation delay; group
  pointerdown/up/click by actual interaction rather than infer handler time from
  total duration. Keep exact sampled primary identity/href and click timestamp.
- LCP element selector/rect/url/size/renderTime/loadTime, screenshot and current
  image complete/naturalWidth/currentSrc. Preserve text/font candidates too.
- Long tasks and supported Long Animation Frame script attribution, plus short
  CDP timeline around startup and tap for compile/evaluation, decode, layout and
  paint. Record actual request timings and scripts completing near interaction.
- Primary bounds, scrollY, focus/active element and feed-intersection timing to
  distinguish auto-scroll/paint work from click handler. Verify handler hydrated,
  current document retained and actual target still same control.

Diagnostic must reproduce INP>184ms on original code with actual primary input
and attribute its phase before selecting repair. If unchanged build cannot
reproduce, retain strict failure receipt and report uncertainty; do not reclassify
old failure as green. After confirmed minimal repair, rerun identical diagnostic,
real native `/near?locate=1` navigation separately, then strict five-sample gate.

Home bytes being1010/45 does not prove fast input or paint. Current strict CWV
gate remains RED; source receipt prepares reproduction, not completion.

## Unrun attribution driver source review

`/tmp/pubmaxx-cwv-attribution-r18.ts` reviewed and extended by authorization.
Reference mode retains installed helpers, original `/plan` warmup, SwiftShader
launch flags, Desktop Chrome context overridden by mobile profile, blocked service
workers, five cold loads, main-ready+1s and original native action. Screenshot is
after measured loop. No runtime validation occurred.

Attribution mode adds supported native Long Animation Frame script timings,
Event Timing phase splits, trusted click target/timestamp, scroll/primary/image
readiness snapshots and CDP wallTime/loaderId. Fixed selected-state observer to
read sibling venue skeleton; removed irrelevant selected-sheet mutation observer
from Home. Input callbacks avoid geometry reads; snapshot/LCP geometry and extra
evaluate roundtrips still add overhead, explicitly labeled. Rounded Event Timing
presentation delay is an estimate, not precise renderer time. Do not infer
hydration from React internals or turn native click dispatch into hydration proof.
Compare with uninstrumented reference; strict failure remains authoritative.
