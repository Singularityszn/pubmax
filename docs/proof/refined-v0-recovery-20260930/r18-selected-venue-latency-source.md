# Selected venue cold latency - R18 source receipt

Checkout: `/Users/karanmanoharan/.codex/worktrees/v0-integration/pubmaxx`.
Source-only review, 2026-09-30. No runtime, browser, tests, build, network,
index or production edits. No latency fix is claimed.

## Measurement evidence supplied by root

R18 strict-five mobile warm `/map`: LCP1232ms / INP88ms; R16:1188ms /88ms.
Cold selected `/map?sel=venue-4xlgb0`: LCP median8392ms, samples
8388/8324/8464/8392/8416ms; R16 selected detail8292ms. This is persistent
product delay, not evidence of a new regression. Source review cannot attribute
that LCP element or turn a100ms comparison into causal proof.

## What the fixture actually measures

- `e2e/helpers/communitySheetFixture.ts:6-10` names Princess Louise,
  `venue-4xlgb0`. Fixture intentionally has no harvested `uk_prices` or
  `drink_price_updates` rows. Its contract does not prove a named listed pint
  price is available; do not invent one for a latency assertion.
- `e2e/cwv-baseline.spec.ts:100-110` gates selected-route readiness on visible
  `.venueInspector`. Lines125-131 navigate with `waitUntil:load`, wait for that
  selector and settle1s. Lines150-153 exercise primary action then read native
  vitals. Thus supplied8392ms is route LCP, not simply elapsed time until price.
- Separate product timing `e2e/helpers/webVitals.ts:504-509` navigates at commit,
  waits only for `.venueInspector`, returns `performance.now()`.
  `cwv-baseline.spec.ts:263-288` cold-clears each product sample separately.
- Mobile profile `webVitals.ts:82-91`:390x844, CPU4x,150ms network latency,
  download188743B/s, upload86400B/s. `coolBrowser`216 onward clears browser
  cache, cookies and origin local/session storage. It does not restart server
  or clear server module caches.

Keep these metric boundaries, budgets, fixture and device profile unchanged.
An additional diagnostic must record readable selected identity and genuine
price/availability independently rather than reinterpret current LCP gate.

## Reachable selected-venue path and actual gates

1. `app/map/page.tsx:25,34-47` is force-static, rendering `PubMaxingShell` without
   selected record. It does not read per-request query or account data. Metadata
   at31 comes from `londonMapMetadata`; that is not selected detail content.
2. `components/PubMaxingShell.tsx:22-25` dynamically loads PubMap with `ssr:false`.
   At29-33, shell module evaluation immediately warms MapLibre canvas for `/map`.
   `lib/mapWarmup.ts:242-249` schedules that import synchronously, not at idle.
   Selected URL also matches `/map`, so it starts same foreground canvas work.
3. PubMap reads selected URL only once its own module renders:
   `components/PubMap.tsx:1154` calls `buildMapSeed(currentSearch(),cityId)`;
   initial selected state is1415-1416. At4978-4982, effect starts
   `warmVenueDetail(selectedVenueId)` without checking map ready, loaded index,
   GPS or canvas state. Therefore **no explicit canvas-ready gate exists on
   curated detail HTTP**.
4. `lib/warmVenueDetail.ts:36-62` shares in-flight/resolved data per ID. It fetches
   `/api/venue/<id>`, awaits response JSON, converts record, then caches it.
   PubMap4982-5015 ignores late unmounted selection results, canonicalizes alias
   ID and merges record into detailById. `lib/lazyVenueDetail.ts:3-17` permits
   full detail records absent from slim pins, so full index is not required.
   Pointer-intent `prefetchVenue` is separate best-effort HTTP warming with120ms
   scheduler (`lib/prefetchVenue.ts:82-104`); a direct cold selected URL has no
   preceding pointer intent. Map-route warmup also explicitly excludes full venue
   detail (`lib/mapWarmup.ts:222-224`). These are not cold-link detail preload.
5. `lib/pubMap.ts:798-818` opens pending deep-link sheet even without selected
   record. PubMap5458-5466 renders skeleton until selected record exists.
   selectedVenue3135-3137 is derived from merged venueById. A record may arrive
   either through direct detail fetch or slim index; there is no Promise.all
   waiting for both.
6. Only when selected record exists does PubMap5498 mount dynamic VenueInspector.
   Import boundary is259-261; loading fallback is structured VenueSheetSkeleton.
   This creates a concrete cold waterfall: shell JS -> PubMap JS/hydration ->
   selected API or index record -> inspector JS -> real `.venueInspector` paint.
   Inspector430 supplies class used by measurement. `detailStatusFor` in
   lib/pubMap168-175 defaults to loading until full detail; PubMap5486-5498
   renders loading skeleton alongside inspector. Thus visible inspector does
   not establish full detail/pricing readiness.
7. Inspector statically imports every tab/body at
   `components/map/VenueInspector.tsx:47-55`, including Photos, Pints, Menu,
   Story, Ask and GettingHome. Those modules must load/evaluate with inspector
   even if their UI is closed. Actual exclusive bytes and parse time were not
   measured by this source review.

## Where 3D/data can interfere without a formal dependency

- Foreground MapLibre import begins earlier than selected API or inspector:
  shell29-33 versus PubMap effect4978 and render5498. Under188743B/s and CPU4x,
  overlapping chunks, compile/evaluation and WebGL initialization can compete
  with selected information. This is source-supported inference, not attribution.
- Deep-link slim loading takes canvas-bounds path. PubMap2447-2451 starts opening
  cells immediately only with no arrivalSearch; selected URL has arrivalSearch.
  `handleMapBoundsChange`2633-2678 waits for valid non-world bounds, then starts
  index request. Slim-only selected record therefore can be delayed by camera
  startup. Direct API path exists to avoid this dependency.
- `renderMapCanvas`6231-6242 mounts canvas separately and passes
  `venueDataReady`; sheet render6481-6523 is independent sibling surface.
  Existing canvasless fallback2618-2625 supplies bounds after failure, but normal
  selected detail should not need to wait for this recovery ceiling.
- Selected endpoint `app/api/venue/[id]/route.ts:35-43` awaits rate limits and
  detail lookup, then sequentially awaits price bundle58 and updates73.
  Detail index uses offset read (`lib/venueDetailIndex.ts:199-205`), not deliberate
  full dataset parse. Bundle `lib/ukPriceBundle.server.ts:43-66` and updates
  `lib/priceUpdates.server.ts:64-94` cache parsed server indexes. Browser cold
  does not clear these caches; do not assume all five8.4s samples are server cold.

## Ranked hypotheses and bounded optimization candidate

1. **Late inspector waterfall / eager closed-tab dependencies.** Prediction:
   selected record completes before inspector chunk/evaluation and LCP. Minimal
   candidate is selected-intent parallel loading: at existing shell arrival
   boundary, start shared `warmVenueDetail` and same inspector import for curated
   `sel` immediately, consuming existing promises in current owners. No duplicate
   fetch/cache, no full dataset or global inspector preload, no auth delay.
   Preserve alias canonicalization, failed/missing status and stale-selection
   guards. Keep force-static map document; changing it to dynamic is unnecessary.
2. **Foreground canvas competition.** Prediction: holding only MapLibre-exclusive
   response makes selected detail become readable earlier while API/inspector
   paths remain unchanged. If confirmed, prioritize explicit selected information
   during arrival rather than wait for first3Dpaint. Do not hide/defer essential
   map work merely to improve measurement; both surfaces still need real readiness.
3. **Selected API response/JSON cost.** Prediction: response or JSON completion
   itself is near8s. If server wait dominates, independent bundle/update reads
   after lookup can be parallelized while preserving null/unavailable semantics.
   No estimate of saving is justified without timing; cached indexes may make
   this irrelevant to repeated samples.

On-demand closed inspector tabs are a further genuine byte reduction only if
compiled graph shows material exclusive cost. Preserve tab state, stable geometry,
immediate focus and chunk-failure recovery. Do not start broad map decomposition.

## Required RED-capable browser diagnostic after runtime release

Use unchanged R18 production build and installed helper/profile. Serial cold
selected navigation, not warm map comparison. Capture:

- Resource/CDP request initiation, response, completion and initiator chain for
  document, PubMap, MapLibre-exclusive chunk, inspector-exclusive chunk, selected
  API, manifest/cells and photos. Identify current chunks via source maps, not
  hardcoded generated filenames; do not issue extra app requests for attribution.
- Existing marks (`pubmax:map-chunk-ready`, `pubmax:first-pins`,
  `pubmax:slim-venues-ready`), native LCP element/rect/time, long tasks and screenshots.
- DOM timestamps: pending sheet, Princess Louise identity, `.venueInspector`,
  full-detail loading disappearance, authentic price/standing or honest no-price
  state, and working Close/tab/native primary interaction. Record these separately
  from LCP and first-pin readiness.

First run normal cold arrival. Then same cold profile with only identified
MapLibre-exclusive response held behind bounded release, while all API/inspector
data remain real. Assert chosen detail identity becomes readable before canvas
release; preserve eventual painted pin and selection camera after release.
This distinguishes coupling/contention from general page startup. Do not claim
causality from source or use a no-WebGL fallback as faster-map proof.

If trace confirms inspector/API waterfall, prepare focused regression before
repair: hold unrelated map resources, require actual selected content and working
controls promptly, then release and require same map/selected identity; rerun
normal cold sample to show genuine latency reduction. Use independently chosen
reviewable deadline that goes RED on observed delay, not a raised baseline or
weakened existing check. Native price claim must match actual fixture evidence.

Receipt concludes diagnosis preparation only. Cold pins and selected detail remain
usability debt until measured, reproduced, repaired and independently revalidated.
