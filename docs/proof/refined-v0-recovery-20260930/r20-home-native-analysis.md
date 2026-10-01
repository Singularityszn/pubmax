# R20 Home native frame assessment

Report/source-only. Only this receipt written; no runtime, browser, tests, build, install, network, repository/index edits or publication. Five trace files parsed sequentially. Strict R18 CWV RED remains unresolved; no Home patch justified by this evidence.

Inputs: `/tmp/pubmaxx-r20-home-frame-trace/report.json`, five `sample-{0..4}-trace.json` files, and unmodified driver `/tmp/pubmaxx-home-frame-trace-r20.mjs`. Terminal report has `completed=true`, `errors=[]`, all five interactions valid. Native timeline capture is extra diagnostic overhead and not the strict gate.

## Clock mapping established

Trace metadata clock domain is `MAC_MACH_ABSOLUTE_TIME`, timestamps microseconds. Select URL-bearing main-frame `navigationStart` for `http://localhost:3351/` and matching LCP navigationId, not second empty-URL navigation marker.

For each sample, independent metric-clock origin `pointerdown.ts - EventTiming.data.timeStamp *1000` equals selected navigationStart.ts exactly. Origins0..4: `96057704057`, `96063740626`, `96069650053`, `96075557232`, `96081470873` microseconds. Therefore `(trace.ts-origin)/1000` and EventTiming data milliseconds share navigation-relative timeline. Native LCP candidate timestamps and reported LCP differ by about1-3ms precision; no arbitrary clock shift used.

## Valid diagnostic samples

| Run | Report LCP / INP ms | Native image LCP ms | Pointerdown input delay / processing / presentation remainder ms |
| --- | --- | --- | --- |
|0|2572 /304|2570.111|3.653 /2.610 /294.570|
|1|1436 /88|1432.936|3.227 /1.493 /84.975|
|2|1444 /96|1441.158|2.758 /1.422 /92.762|
|3|1428 /104|1425.758|2.918 /2.412 /94.739|
|4|1428 /88|1424.948|3.297 /2.209 /78.507|

Presentation remainder calculated from raw EventTiming duration minus input delay and handler processing, not rounded report INP. Run0 pointerdown raw duration300.833ms versus reported INP304; click/pointerup same interactionId4684 and raw300.796ms. Native events all point node89, click coordinates166,547. Original helper owns `[data-primary-action]` click and suppresses link navigation; these timings are Home interaction/frame behavior, not subsequent Near/GPS latency.

## First sample chronology

Hero is actual `IMG.landingPhoto__img`, `/landing/london/the-black-friar-640.avif`,18328-byte body, high-priority link preload. Native image discovery193.1ms, load start1229.8ms, load end1500.7ms. ResourceFinish reports same successful18328-byte decoded body. Native H1 candidate2374.904ms; image candidate2570.111ms. Final image paint follows load end by1069.411ms.

AVIF decode is not a demonstrated one-second operation: first substantive `Decode Image`1509.082-1511.048ms,1.966ms wall /0.466ms thread CPU. Earlier AVIF decode event is0.007ms. Later samples corresponding substantive decode1.735-1.953ms. Recorded raster-worker tile tasks around first decode are individually small (largest around1.3ms); their nested spans must not be summed as independent cost.

First renderer-main layout1421.3ms lasts25.91ms, document Paint1451.9ms lasts3.96ms. Largest pre-LCP renderer RunTask41.34ms. Later document layout2354.87ms lasts10.75ms, Paint2368.49ms2.01ms. No multi-second renderer handler/decode found in this interval.

GPU process supplies concrete long wall intervals: `RasterDecoderImpl::DoEndRasterCHROMIUM`1462.53ms245.42ms,1796.153ms533.005ms,2345.67ms194.33ms. Last ends about2540ms, near final image candidate2570ms. The533ms span has only6.25ms thread CPU. These are native wall-time pipeline/flush spans overlapping delayed presentation, not proof533ms CPU execution or a particular image's raster ownership. Trace does not isolate shader compilation, GPU/backend wait, OS scheduling or external contention.

At input, pointerdown starts5037.188ms, processing5040.841-5043.451ms. Click handling ends5044.940ms; renderer commit finishes5069.744ms; matching EventTiming ends5338.021ms. Renderer maximum RunTask overlapping interaction23.685ms. Thus the roughly301ms interaction is dominated by post-processing/presentation, not a long handler queue.

GPU raster flush5079.366-5304.671ms lasts225.305ms wall with2.090ms thread CPU, followed5305.166ms52.823ms wall /0.263ms CPU. This overlaps presentation tail. Matching compositor frame presentation span reaches5338.021ms, corroborating event endpoint. The overlapping225ms flush is a concrete lead, not yet a causal assignment to Home CSS, image decode or another process.

Later samples' input GPU flush spans are roughly50-54ms wall /0.17-0.24ms CPU instead of225ms; renderer handler input delay remains2.8-3.3ms. Their final image paint occurs~112-124ms after load end, not first sample's1069ms. This distinguishes first-sample presentation behavior from universally expensive AVIF decode or input processing.

## Host and evidence limits

Coordinator reports external self-hosted Actions browser profile `QwEWp5`, born09:00:02UTC, remained active beyond09:12 in `actions-runner-pubmax-2`. It overlapped every timed R20 sample despite agent lease and was correctly left untouched because not owned. Current trace cannot attribute external process's exact CPU/GPU effect. First sample is clean only of core's later unit/type checks, not a proven idle-host sample.

Core94-unit run and tsc began09:04:53UTC; trace mtimes0..4 were09:04:35/41/47/52/58. Final sample4 overlaps owned validation, so it too is confounded; earlier four avoid that specific overlap. All samples still have external runner and tracing overhead. No host-noise verdict, production regression verdict or strict gate replacement follows from this trace. Diagnostic median1436/96 passing a ceiling would not clear strict R18 cold Home2648/376 failure.

## Smallest next causal test

After coordinator verifies no external runner browser and grants runtime, repeat exact original five-cold Home reference boundary in a fresh browser with existing warmup/profile, recording host ownership before/during. If first-input presentation outlier recurs, capture same native frame trace for that clean instance, retaining clock mapping and correlating EventTiming commit/presentation with GPU flush wall-versus-thread time. Existing trace categories do not resolve underlying wait reason; add narrowly targeted GPU/backend attribution only if that repeated interval remains the lead. Keep resource payloads, action, budgets and timing unchanged. This tests whether long first presentation survives a genuinely idle host before proposing any Home code patch.
