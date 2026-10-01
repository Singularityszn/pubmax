# Native CWV analysis R19

Read-only source/report analysis. Only this receipt written. No browser, runtime, build, install, app/test/index edit or publication. Current strict R18 failure remains authoritative and unresolved. These diagnostics do not replace its gate or relax budgets.

Inputs:
- `/tmp/pubmaxx-r19-home-reference/report.json`: coordinator confirmed terminal EXIT0, completed=true, no errors, five valid actions/samples.
- `/tmp/pubmaxx-r19-home-attribution/report.json`: same terminal status; native additional observers explicitly add overhead.
- `/tmp/pubmaxx-r19-selected-attribution/report.json`: coordinator confirmed session25641 terminal EXIT0 at08:16:51, completed=true/no errors, five valid actions/samples.
- Current source and compiled R18 assets under `.next-e2e-recovery/static/chunks`. Referenced chunks have no adjacent source maps; ownership below comes from distinctive compiled markup and source behavior, not imagined map-file attribution.

## Home: repeated diagnostic median passes, strict failure still unexplained

| Run | Reference LCP / INP ms | Attribution LCP / INP ms |
| --- | --- | --- |
| 0 | 3896 / 264 | 3576 / 288 |
| 1 | 1428 / 88 | 1432 / 96 |
| 2 | 1432 / 88 | 1440 / 96 |
| 3 | 1436 / 88 | 1428 / 96 |
| 4 | 1432 / 96 | 1436 / 96 |
| Median | 1432 / 88 | 1436 / 96 |

Both first samples slow; later four fast in both arms. This establishes a first-sample pattern in these two loops, not a cause and not evidence that R18 median2648/376 is invalid. Cold allowance remains LCP2641.6/INP184; warm INP allowance separately232. Home byte gate remains1010KiB/45 requests; this diagnosis does not alter it.

Native LCP candidates are consistent across all five attribution samples: `h1#hero-title.screenTitle` then Blackfriar AVIF `img.landingPhoto__img`. Final image is `/landing/london/the-black-friar-640.avif`, encoded18328 bytes. First sample: resource starts199.6ms, actual request2235.4, response ends2505.9, LCP load2506.3/render3576. H1 also paints late3300ms. Later samples: image starts192-197, request1037-1041, response ends1317-1320, final render1428-1440; H1 paints1416-1428.

First stylesheet requests themselves begin1452ms versus190-196ms later. Last stylesheet completes2356.6ms versus1174.5-1182.9 later. Thus observed first-image wait includes earlier resource/stylesheet scheduling and late text paint. Photo decode alone cannot explain whole pattern. Font request completes3428.8ms first,2231-2234 later; later LCP precedes that font completion, so waiting for final font is not universal gate.

First native pointerdown target is actual primary anchor `/near?locate=1`, text “Cheapest pints near me”. Entry starts6037.1ms, duration288, input delay3.2, handler processing2.2, rounded presentation remainder282.6. Other first interaction entries share native interaction id. No long task overlaps this interval. Nearby scriptless LoAFs start6138.6/duration152.8 and6292.9/duration52.9, blockingDuration0. Native click remains trusted, scrollY0. Later pointerdowns have input delays2.0-2.8ms, processing1.5-2.8ms, rounded presentation90-92ms, durations96.

This argues against a long click handler or a long JS task as cause of this particular slow first input. LoAF zero blocking/script entries do not prove zero render/compositor cost, nor identify OS/host/GPU/decode cause. Rounded presentation remainder is derived from rounded EventTiming duration, not exact paint-phase measurement. Separate source `e2e/helpers/webVitals.ts:362-372` prevents navigation for measurement while preserving handler/render; this is not actual `/near` route/geolocation latency.

`components/landing/LandingPhoto.tsx:59-61` still uses sync decode for priority image while keeping eager/high priority. Native observations now provide concrete image paint attribution, but do not isolate synchronous decode as the culprit. No Home patch justified yet. No-source reference arm reproduces slow first sample too, so extra observers are not its sole origin; the8ms median INP difference between arms is not a statistical cause estimate.

Next falsifiable diagnostic, only after new runtime authorization: repeat untouched reference in strict Home route/context sequence while native browser tracing captures frame scheduling, raster/compositor and decode around LCP and first pointerdown. Keep original load+ready+1s/action boundary, profile, cache reset and navigation suppression. Correlate resource queue and actual frame submission, not React private hydration flags. Async decode candidate may be tested only if decode/frame attribution supports it, with same image dimensions, eager/high priority, visual correctness and strict gate afterward. Do not lengthen readiness wait or discard first sample.

## Selected venue: measured resource serialization and contention

Terminal median LCP8732/INP56. Attribution samples LCP9984/8732/8740/8648/8492, INP88/48/56/64/56. This is diagnostic overhead on known selected-venue debt, not a new production regression claim against R18 strict8392 or prior R16 strict8292.

| Run | PubMap ready mark | API start / response end | Inspector group start / last end | Inspector host observed | Final LCP |
| --- | --- | --- | --- | --- | --- |
| 0 | 6736.1 | 6752.5 / 7327.3 | 7335.7 / 9584.4 | 9748.4 | 9984 |
| 1 | 5446.2 | 5453.9 / 6054.8 | 6059.1 / 7920.7 | 8486.2 | 8732 |
| 2 | 5641.3 | 5649.7 / 6265.7 | 6271.0 / 8108.4 | 8357.3 | 8740 |
| 3 | 5492.7 | 5500.6 / 6109.5 | 6114.7 / 7960.6 | 8194.6 | 8648 |
| 4 | 5357.4 | 5366.8 / 5975.6 | 5981.4 / 7913.5 | 8250.0 | 8492 |

All times ms since navigation. Group comprises same6 JS +17 CSS resources, encoded129363 bytes (126.3KiB). Group begins4-9ms after detail API ends. Largest exclusive Inspector markup chunk `2ea1vza_70h_n.js` is50302 encoded bytes; compiled code contains actual `.venueInspector`, `.venueAddress`, `.venueTabShort`, confirming Inspector ownership. Group boundary selected by resource-start cluster immediately following actual API response, not guessed module size.

API `/api/venue/venue-4xlgb0` encoded2967 bytes. Later four requests wait337-347ms between resource start and requestStart, then responseStart is2.0-2.5ms after requestStart and body transfer completes259-267ms later. First request server interval121.7ms, still much less than multi-second presentation debt. Server API is not observed spending seconds. This is an observed network wait/transfer ordering, not proof that total user delay is entirely bandwidth contention.

MapLibre chunk `21ctu9vnullj5.js` encoded286192 bytes starts2683/2882/2723/2597ms in later four, finishes7859.6/7990.1/7850/7597.5. It overlaps both selected API and entire Inspector load. Current PubMap compiled chunk `2ooxwqap_hyx2.js` encoded45339 ends5419/5615/5466/5331, immediately before PubMap-ready mark and selected request. This matches real controller's API effect firing once module mounts (`components/PubMap.tsx:4978-4982`), not a GPS/canvas readiness gate in that effect.

Native final LCP is `p.venueAddress` text “Camden, Greater London”, not an image. Earlier candidates are “Loading London pubs…” and “Turn on location for walk times”. Inspector skeleton is present while assets/data load; Inspector host becomes present only after group end. Native action then targets actual `button#venueTab-overview`/Overview. Probe's `heading:null` is a selector limitation: it reads h1/h2, actual `VenueInspectorHeader.tsx:69` renders h3. Coordinator separately viewed `/tmp/pubmaxx-r19-selected-attribution/after.png` and confirmed Princess Louise title, **estimated £6.50**, Overview selected and Camden/Greater London. Unique identity is screenshot evidence, not the missing heading or URL alone; estimated price is not a published/listed price claim.

Map rendering also contributes concrete main-thread work. LoAF script attribution to `30ey3ucokxihb.js`, source character34403, FrameRequestCallback reports350.9ms first and201.2/135.6/235.2/199.8ms later. Distinctive compiled code at that offset is style-load critical-scene assembly. `components/map/canvas/buildScene.ts:501-522,1522` includes icon registration in that critical assembly. This does not isolate icons from all scene work. Later frames happen8173/8323/8283/7954ms, around Inspector host readiness; native map-constructed occurs7902/8039/7924/7649, and scene/icons readiness overlaps Inspector paint. Final LCP already precedes `pubmax:pins-visible`9699-9838/9469, so waiting until first visible map pins is not necessary for current final LCP. Existing pins-visible mark is separate product timing, not proof sheet completeness.

## Smallest durable candidate and falsifier

Candidate: at existing validated curated-selection controller boundary, start same existing Inspector module import concurrently with `warmVenueDetail`, instead of letting first Inspector render initiate its assets after API result. Current `PubMap.tsx:259-261` dynamic fallback and `4978-4982` API owner already define two operations; preserve their owners, cancellation/account behavior, canonical selected id, real detail response, unavailable notice, skeleton/focus frame and import-failure recovery. No auth delay, map delay, cache/budget change, placeholder price claim or hidden essential work.

Native evidence supports removing approximately600ms of API-before-Inspector serialization on later four, but does not guarantee600ms LCP gain: same bandwidth, CSS queue and map critical frame can consume that overlap. Starting both from earlier shell might remove more PubMap-before-API wait but entails broader graph ownership and validation work; do not jump there before narrow proof. Static imports of unopened Photos/Pints/Menu/Story/Ask/GetHome tabs in `VenueInspector.tsx:48-55` contribute to its group, but a tab split requires real per-tab immediate focus/loading/error behavior and is a separate measured follow-up, not an unreviewed quick fix.

Next RED-capable browser diagnostic after explicit runtime authorization: identify actual MapLibre-exclusive chunk by emitted content, hold that real response, leave real selected API/Inspector resources untouched, and assert canonical named venue plus actual labeled price state appears before release; then release and prove actual canvas, selected camera and pins. For this fixture preserve estimated £6.50 label rather than pretending a listed price exists. This falsifies a hidden render dependence on 3D map while preserving real data. Correct observer heading selector to include actual h3 and capture safe visible title/price state; no mocked API payload or fallback-render speed proof. Then compare unchanged baseline versus bounded concurrent import with same five-cold profile and exact gate boundary, resource order, native LCP element and all actions valid. No driver or production case written here.

No source repair performed. Home strict failure remains open; selected detail now has measured, actionable loading-order debt rather than only a source-inferred waterfall.
