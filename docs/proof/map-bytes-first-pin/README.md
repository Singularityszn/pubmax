# The bytes a map asks for, and the sheet that moved while it waited

The captain's standing question for PlanAstra is speed and reliability. The
review that opened this lane measured `/map` decoding 11 MB and `/map?sel=`
18 MB, and put `/map?sel=` CLS at 0.32. This is the measurement of both, the
change, and the measurement again.

Three findings, and they are separate:

1. **Three committed packs were read on mount by surfaces that would not draw
   them.** The national Wetherspoon directory answers the Open now filter and
   nothing else; the drink and food price-update overlays are drawn by the
   Drinks tab alone; the slim venue index feeds the plan composer's Stop rows,
   which describe-first has not drawn. Every one of them was fetched anyway.
2. **The phone venue sheet moved the page twice on the way in.** It is
   bottom-anchored, so changing its HEIGHT moves every pixel inside it, and
   Chrome scores that. The entrance sprang the height from a sliver, and then
   the box grew again when the venue panel's own chunk landed.
3. **A restored country-wide viewport made `/map` ask for the whole city, one
   shard cell at a time.** 335 requests against a ceiling of 160, reproduced to
   the request here and on the Avrea runner. That one is below, under "The
   request count".

## The rig

| | |
| --- | --- |
| Build | local production build (`NEXT_DIST_DIR=.next-prod`), keyless, served by `next start`; the before arm is commit `5bf044f55` built the same way into `.next-before` and served on its own port |
| Browser | Playwright Chromium with SwiftShader, so the map gets a real WebGL2 context and the run measures the map rather than its fallback |
| Phone | 390x844, DPR 1, 4x CPU throttle, Slow 4G (135 ms latency, 188,743 B/s down, 86,400 B/s up) — the same figures `e2e/helpers/webVitals.ts` pins |
| Cold | a fresh browser context per route, so every sample is a first-ever visit |
| Settle | 25 s after `load`, then the response log is totalled |
| Bytes | decoded response bodies over every request the page made, same-origin and third-party alike, which is what "the route decodes N MB" means |
| CLS | `layout-shift` entries with `hadRecentInput` false, buffered from before first paint, summed, with each entry's `sources` resolved to the element that moved |

## Decoded bytes, cold, per route

| Route | Before | After | Change |
| --- | --- | --- | --- |
| `/map` | 9092 KB over 189 requests | 6993 KB over 187 requests | **−2099 KB (−23%)** |
| `/map?sel=venue-1vle947` | 15032 KB over 173 requests | 9553 KB over 169 requests | **−5479 KB (−36%)** |
| `/plan` | 3554 KB over 55 requests | 1733 KB over 53 requests | **−1821 KB (−51%)** |
| `/pal/chat` | 2692 KB over 72 requests | 2697 KB over 72 requests | unchanged, and why is below |

The single responses that moved, all of them committed packs:

| Response | Before | After |
| --- | --- | --- |
| `/data/wetherspoons/pubs.json` on `/map` | 2098 KB | not requested unless Open now is on |
| `/data/drink_price_updates/latest.json` on `/map?sel=` | 1862 KB | not requested unless the Drinks tab is open |
| `/data/food_price_updates/latest.json` on `/map?sel=` | 1519 KB | not requested unless the Drinks tab is open |
| `/data/venues_slim.json` on `/plan` | 1821 KB over TWO requests | not requested until the composer is on screen |

Nothing is dropped and nothing new is fetched. Each read still happens, in full,
the moment the surface that draws it is on screen; the loaders behind all four
cache per session, so opening the filter or the tab a second time costs nothing.

## Layout shift, cold, per route

| Route | Before | After |
| --- | --- | --- |
| `/map` | 0.0024 | 0.0024 |
| `/map?sel=venue-1vle947` | **0.3141** | **0.0000** |
| `/tonight` | 0.0225 | 0.0225 |

Every point of the `/map?sel=` figure was attributed to one element,
`section.mapDrawer.mobileSharedSheet.right` — the phone venue sheet itself. A
frame-by-frame trace of that element's own box said why:

```
before:
  6181ms top=778 h=  2  maxH=0px       bodyScrollH= 107  sheet-half sheet-settling
  6225ms top=607 h=173  maxH=317.7px   bodyScrollH= 107  sheet-half sheet-settling
  8373ms top=316 h=464  maxH=464.2px   bodyScrollH=1135  sheet-half
```

Two travels: the entrance spring (0.0723) and the box growing when the venue
panel's chunk landed and the body went from 107 px to 1135 px (0.2418).

```
after:
  5900ms top=780 h=464  maxH=464.2px   bodyScrollH= 898  sheet-half sheet-entering
  ...    top slides 780 -> 316 on a transform over 340 ms ...
  6304ms top=316 h=464  maxH=464.2px   bodyScrollH= 898  sheet-half
  8238ms top=316 h=464  maxH=464.2px   bodyScrollH=1135  sheet-half
```

The box is its resting size on the first painted frame, which is an insertion
rather than a move, and the arrival is a transform, which is one of the two
properties exempt from the score. When the panel's chunk lands the body grows
inside a box that does not.

`/tonight` is unchanged and is reported rather than fixed. The brief named the
weather line, the chip row and the first card; the attribution says otherwise.
Its 0.0225 is two shifts, `div.tonightPrimary` at 0.0143 and
`section.tonightSoftPlans` at 0.0082, both at the moment the listings replace
the idle block's own `min-height: min(640px, 75vh)` reservation with real rows.
The conditions strip never appears as a source. The figure is already a fifth of
the 0.1 target, and closing it means making a reservation match a list whose
height varies by night, so it is left measured rather than guessed at.

## The first tappable pin

Median of three cold runs on the same phone rig, over
`window.__pubmaxPaintedMapTapPoints().length > 0`:

| Route | Before | After |
| --- | --- | --- |
| `/map` | 10896 ms (10624 / 10896 / 11775) | **10163 ms** (10539 / 10163 / 9783) |
| `/map?sel=venue-1vle947` | no pin inside the 60 s ceiling | no pin inside the 60 s ceiling |

`/map` improves by 733 ms, which is a small share of the 2.1 MB the route no
longer asks for: on this wire those bytes are about 11 s of transfer, but they
were already held behind the canvas handover, so most of them were never in
front of the pin. What they were in front of is everything a reader does next.

The `/map?sel=` row is a FINDING and not a regression: it reads the same on the
before arm, so it predates this change. The probe answers only marks with no app
chrome over them, and on that route the sheet owns the lower half of the screen
while the top bar and the ambient banners own the upper. Whether that is the
probe's geometry or a real "no pin a thumb can hit" is the next lane's question;
it is stated here rather than left for the next reader to rediscover.

## The request count

`perf/route-budgets.json` caps `/map` at 160 requests before it is interactive.
PR #1589 measured 335 on two machines and named #1561 as the likeliest cause;
the gate had not executed since 4 September, so 55 commits sat unmeasured.

Reproduced here with the spec the job runs (`PUBMAX_PERF_BUDGET=1`), 335 to the
request. It is not #1561, and it is not the byte work above. It is a SAVED
SESSION:

```
localStorage after the sweep's warm-up load, "pubmaxx.mobile-map-session.v1":
  {"viewport":{"center":[-3.3999999999999773,55.800319462599134],
               "zoom":4.899002162618559,"pitch":0,"bearing":0}, …}
```

That is the middle of Britain at zoom 4.9 — the whole island. The sweep blocks
every third party, so the basemap tiles never arrive, the camera never settles
on London, and the country-wide view it is left at is what the session stores.
The next load restores it, and the OPENING shard read takes it literally: 243
`venues_slim.cell.*` requests in the first second, all distinct, before anything
has painted.

`viewportNamesNowhere` (`lib/slimShards.ts`) already existed to refuse a read
from a viewport that is about nowhere, but it only caught the placeholder
(centre [0, 0] at zoom 0). A real centre at a country zoom walked past it. It
now also refuses a viewport below `SHARD_READ_MIN_ZOOM`, which is DERIVED from
the `SHARD_READ_MAX_SPAN_DEGREES` ceiling beside it rather than typed: a 390px
phone spans 2 degrees at zoom 8.1, so 8 is the floor. No pin paints below zoom
12, so every cell such a read fetches draws nothing.

The CAMERA is untouched. A reader still opens where they left off; only the
shard read is scoped to a place.

| route | metric | ceiling | before | after |
| --- | --- | ---: | ---: | ---: |
| `/map` | requests | 160 | **335** | **123** |
| `/map` | LCP (ms) | 900 | 716 | 792 |
| `/map` | JS decoded (KB) | 3400 | 3021 | 3021 |
| `/map` | server render (ms) | 150 | 5 | 7 |
| `/pubs` | requests | 68 | 68 | 68 |

Both arms measured on this Mac with `npx playwright test
e2e/performance-budget.spec.ts --project=chromium` under `PUBMAX_PERF_BUDGET=1`,
the same spec the CI job runs, three samples per route after a drained warm-up.
The before arm is commit `5bf044f55`. The whole sweep FAILS before (one breach,
`/map` requests, +109%) and PASSES after, with no ceiling touched.

The shard-cell count behind the `/map` figure, isolated: 171 distinct cells
before, 33 after, in the same warm load.

`/map`'s LCP spread is wide on this box (916 / 792 / 580 across three samples),
which is why the median moved up while the run stayed inside its ceiling.
`/pubs` read 69 against its ceiling of 68 on one run and 68 on the next: its JS
bytes are identical on both arms (1114 KB) and the extra request is a route
DOCUMENT prefetch racing the interactive boundary, so it is jitter on a route
with no headroom rather than a cost this branch added.

## What was measured and left alone

**`maplibre-gl-shared.mjs` is fetched once, not three times.** MapLibre 6.6.0
sets `WorkerPool.workerCount = 1` on every engine but Safari, where it is up to
three. Measured on this rig, `/map` requests
`/vendor/maplibre/maplibre-gl-shared.mjs` exactly once, 478 KB, served
`public, max-age=3600, s-maxage=31536000`. Three fetches is what a three-worker
pool costs, so the observation stands for Safari and there is nothing to fix on
Chromium. Cutting the pool further, or warming the module ahead of the map,
would both have to answer `__tests__/mapEarlyWarm.test.ts`, which forbids
fetching anything before `pubmax:first-pins` for a reason
`docs/PERFORMANCE_BUDGETS.md` records.

**`/pal/chat` keeps its 911 KB, and the reason is that it draws it.** That read
is the cheapest-pint glance card on the empty transcript — a real pub, a real
price, ranked through the same `rankNearMe` Near me serves. Deferring it would
take content off the first paint; reading a shard instead of the monolith would
change which pubs the glance ranks over, which is a product decision and not a
performance one. It is named here as the follow-up rather than taken quietly.

**`/data/tfl_lines.json`, 419 KB on `/map`.** The map draws the Tube layer, so
those bytes are on the first paint by design. Left alone.

## The browser suites

`npx playwright test --project=chromium` over the eight suites that pin what
this branch touches: `price-colour-law`, `smoke`, `map-deep-link-pin`,
`map-surface-history`, `mobile-map-chrome-fit`, `mobile-map-shell-matrix`,
`venue-sheet-tablet-command-bar`, `plan-single-stop`. 58 passed, 13 failed, and
every failure is measured to be somebody else's:

| Failure | Verdict |
| --- | --- |
| `mobile-map-shell-matrix` "coordinated map shell" x8 | PRE-EXISTING. It asserts four Primary nav links and the product paints six (`PRIMARY_NAV_ITEMS`: Now, Map, Places, Out, Social, You). Fails identically on `5bf044f55`. |
| `mobile-map-shell-matrix` "London basemap hierarchy" x2 | PRE-EXISTING. Writes zoom 10 into the saved session and reads 12 back. Fails identically on `5bf044f55`. |
| `smoke.spec.ts:344` | PRE-EXISTING, and already fixed in #1589: #1517 folded the sticky strip's `Add price` into the Overview's one door and the pin has not run since. |
| `map-surface-history` x2 | CONTENTION. Eight suites in parallel on one box; the file passes 8/8 on its own re-run on this branch, and 8/8 on `5bf044f55` in the same parallel run. |

The baseline arm was measured by checking `components`, `lib`, `__tests__` and
`e2e` out at `5bf044f55` and running the same two suites: 10 failed, 12 passed,
and the ten are the ten above.

## Files

| File | What it holds |
| --- | --- |
| `bytes-before.json` / `bytes-after.json` | every response the four routes made, totalled, with each response over 40 KB named |
| `cls-before.json` / `cls-after.json` | every layout-shift entry with its value, its time and the element it moved |
| `sheet-trace-before.txt` / `sheet-trace-after.txt` | the phone sheet's own box, frame by frame, on a `/map?sel=` arrival |
| `first-pin.json` | the three cold runs per arm behind the table above |
| `shots/` | `/map` and `/map?sel=` at 320, 390, 768 and 1440 on the after build |

## The fences

| Fence | What it holds |
| --- | --- |
| `__tests__/firstPaintCityBundles.test.ts` | each of the three packs is read by the surface that draws it and by nothing earlier |
| `__tests__/venueSheetLayoutStability.test.ts` | the entrance is a transform, the height is set at once, and the panel's chunk waits behind a skeleton that fills the sheet |
| `__tests__/sheetSnap.test.ts` | the retired height-entrance helper is gone and `SHEET_ENTRANCE_MS` is the one duration |
| `__tests__/shardReadBoundsGuard.test.ts` | a country-wide viewport names no place, and the zoom floor is derived from the span ceiling |
| `e2e/performance-budget.spec.ts` | the gate itself: `/map` inside 160 requests and 900 ms LCP |
