# R20 diagnostic source review

Source-only review. Both drivers remain UNRUN. No browser, server, tests, builds, network or repository changes performed. Review owns this receipt only. Current driver corrections made by parent were reread before this receipt.

## Corrections already present

`/tmp/pubmaxx-inspector-order-r20.mjs:29-51` now limits request accounting and route holds to exact origin, holds API plus core/manifest/cell and whole `/data/venues_slim.json`, journals fulfilled carriers, and reasserts zero Inspector plus zero deliveries immediately before releasing data. Whole-index fallback exists in `lib/slimShards.ts` when manifest unavailable; omitting it was a coverage gap, not proof it was reached in this particular run.

These checkpoints preserve a RED-capable unchanged baseline: an Inspector request required while API/slim bodies remain withheld and no Inspector exists. With original record-gated dynamic rendering, that requirement should time out. This remains a source prediction until the unchanged build is run. Exactly one acquisition/request additionally checks duplication; do not reinterpret a failure there as an ordering pass.

`/tmp/pubmaxx-inspector-map-hold-r20.mjs:34-58` now limits hold to exact origin, imposes 16 seconds from navigation, rejects expiration, and requires no `.mapFallback` before proof. Navigation precedes PubMap's 18-second readiness watchdog, so this bound is conservative. Earlier sequential timeout totals alone did not establish a pre-watchdog proof.

Both drivers validate visible `Princess Louise` heading with default accessible role lookup, which excludes hidden headings. Mobile visible title is `MobileSharedSheet` h2; Inspector h3 is hidden by mobile CSS. Recording hidden h3 text is metadata only. Estimated trust pill asserts both `est. £6.50` and `Estimated`; this correctly proves estimate presentation, not a listed price.

## Remaining concrete correction

Map-hold `finally` (lines 76-80 in reviewed draft) does not clear `holdCeiling`. Failure before explicit release leaves its 16-second callback alive after browser closure/final receipt flush. It can extend process lifetime and mutate in-memory errors/released state after saved terminal report. Clear this timer in `finally`; set cleanup release state explicitly, with cleanup distinct from successful measured release if reporting semantics require it. Duplicate clear in success path can be removed. This does not need a loader framework.

Both outer 90-second watchdogs bound owned browser activity, and normal/error paths close browser. Their timers begin after launch; startup itself relies on Playwright launch timeout. Route fetch/fulfill remains real-response preservation. In map-hold, `held` increments before `route.fetch()` resolves: it proves a blocked real request, not yet a fetched complete response. If receipt claims the latter, add response-ready/status accounting or correct wording. This does not undermine the canvas-withheld dependency check.

## Scope of map proof

Current map-hold checks no canvas before release, actual canvas afterward, and positive `__pubmaxPaintedMapTapPoints()` count. That probe includes ordinary pins and clusters, so it proves actual painted tappable map features, not specifically Princess Louise's selected pin. Camera and marks are captured without assertions. Keep claims at that scope unless adding selected-intent proof.

For a bounded selected proof, use real detail response `venue.id`, `venue.latitude`, `venue.longitude`, require actual `camera-intent:venue` plus finite settled camera, then inspect the selected point at projected real coordinates. Camera center equality is unsuitable: venue framing accounts for sheet/chrome and offsets. Do not mistake an arbitrary positive point count or merely present camera snapshot for successful selected framing. Parent is preparing this source-only extension independently.

## Build ownership and evidentiary limits

Ordering discovers one Inspector chunk from local emitted `venueAddress` + `venueTabShort` markers and fails ambiguous ownership. Map-hold pins R18 `21ctu9vnullj5.js`, validates local `maplibregl` marker and labels unchanged R18. Both require local dist to match actually served build; local marker check alone does not prove server identity. Rediscover MapLibre owner for any fresh build before rerunning. Neither driver yields a Core Web Vitals/budget verdict.

Source corrections improve diagnostic validity only. No baseline RED, warmed GREEN, held-map dependency or successful cleanup has been executed by this review.
