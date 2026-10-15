# Preloading the /map canvas chunk graph from the document

The question: does naming the PubMap and PubMapCanvas chunk graph in the cold
`/map` document, so the browser fetches it while route JS wave 1 is still on
the wire, bring the first tappable pin forward on a phone without costing FCP
or LCP?

The standing rule is
[THE PRODUCT HAS A SPEED RATING](../../rules/perf-budgets-and-measured-findings.md#the-product-has-a-speed-rating-and-the-profiled-cause-was-not-the-binding-one),
rule (6), and `docs/perf/tile-cdn-2026-10-03.md`. They say a `modulepreload`
of the canvas chunk is the same bet as the reverted worker warm, and it may
ship only with an interleaved A/B that moves the first tile or the first
tappable pin, not the chunk's arrival alone. `__tests__/mapEarlyWarm.test.ts`
forbids `public/map-first-paint-init.js` fetching anything before
`pubmax:first-pins`. A document `<link rel=preload>` is not that script, so
the test does not forbid this, but the rule's A/B bar applies.

**Verdict: not shipped.** The preload brings the engine forward by about a
second on mobile, and the JS-only form costs no LCP. But the first tappable
pin could not be measured in the environment this was run in, so the bar the
rule sets was not met. Nothing in the product changes on this branch.

## The rig

| | |
| --- | --- |
| Build | one local production build (`npm run build`, Turbopack, `NEXT_DIST_DIR=.next-a`) of `origin/main` at `ab6a1f7`, served by `next start` |
| Arms | both arms served through the SAME Playwright interception of the `/map` document; arm B's copy gains one `<link rel="preload" fetchpriority="low">` per chunk in the graph, with the build's own `?dpl=` token, so the URLs are byte-identical to what the runtime loader asks for (no duplicate download in any sample, `dupJs=0`) |
| Browser | Playwright Chromium 1194 with SwiftShader (`--use-angle=swiftshader --enable-unsafe-swiftshader`) |
| Mobile | 390x844, 4x CPU throttle, Slow 4G (150 ms, 188,743 B/s down, 86,400 B/s up), `VITALS_DEVICES.mobile` |
| Desktop | 1440x900, no CPU throttle, Fast 4G (75 ms, 1,012,500 B/s down), `VITALS_DEVICES.desktop` |
| Cold | HTTP cache and origin storage cleared before every sample; one throwaway load per arm first |
| Order | six interleaved pairs per cell, order alternated each pair, the idle arm parked on `about:blank` |
| Harness | `scripts/perf-map-chunk-preload-ab.mjs` |

## Why the first pin is missing

This container's network policy denies `tiles.openfreemap.org` and
`basemaps.cartocdn.com` (proxy 403). No style loads, so no symbol is placed
and `__pubmaxPaintedMapTapPoints()` stays empty in both arms. The basemap was
not stubbed: a stubbed style removes the tile and glyph traffic that a real
preload would compete with on Slow 4G, so the stubbed figure would flatter
arm B. What is reported is everything that does not depend on the basemap.
`pubmax:map-constructed` is the last engine milestone before the style
round trip.

## Results (medians of six pairs, ms)

The graph is 30 files, about 494 KB gzipped: the PubMap dynamic entry
(21 files, 159 KB) and the PubMapCanvas loader lists (9 files, 335 KB), in
`preload-graph-all.json`. The JS-only form drops the 9 stylesheets
(`preload-graph-js.json`).

### Mobile, Slow 4G + 4x CPU

| | A (main) | B all files | B JS only |
| --- | ---: | ---: | ---: |
| FCP | 814 / 802 | 884 (+70) | 828 (+26) |
| LCP | 3,252 / 3,254 | **3,682 (+430)** | 3,242 (-12) |
| `pubmax:map-chunk-ready` | 5,878 / 5,898 | 4,447 (-1,431) | 4,480 (-1,418) |
| `pubmax:map-constructed` | 7,783 / 7,801 | 6,880 (-903) | 6,835 (-966) |
| `pubmax:first-pins` (data) | 6,652 / 6,625 | 5,199 (-1,453) | 5,412 (-1,213) |
| first tappable pin | not measurable | not measurable | not measurable |

Two A figures, one per run, because each B form ran against its own A arm.

### Desktop, Fast 4G

| | A (main) | B all files | B JS only |
| --- | ---: | ---: | ---: |
| FCP | 450 / 434 | 448 | 430 |
| LCP | 2,722 / 2,828 | 2,588 (-134) | 2,698 (-130) |
| `pubmax:map-chunk-ready` | 2,347 / 2,262 | 1,225 (-1,122) | 1,157 (-1,105) |
| `pubmax:map-constructed` | 2,328 / 2,278 | 2,217 (-111) | 2,260 (-18) |
| `pubmax:first-pins` (data) | 2,522 / 2,508 | 2,327 (-195) | 2,299 (-209) |

Raw per-sample lines: `ab-mobile.txt`, `ab-mobile-js-only.txt`,
`ab-desktop.txt`, `ab-desktop-js-only.txt`. On mobile the spread inside each
arm is about 100-300 ms on every milestone, so the deltas above sit well
outside it. "canvas chunk requested/landed" in the raw files is the largest
JS file in the sample, not always the canvas chunk itself.

## What the numbers say

1. **The stylesheet preloads cost LCP on a phone.** With the 9 CSS files in
   the graph, LCP was worse in every mobile sample (+430 ms median). Without
   them, LCP is unchanged. Any preload that ships must be JS only.
2. **The JS-only preload moves the engine about a second on mobile.** The
   chunk is ready 1.4 s earlier and the map is constructed 1.0 s earlier.
   That is less than the 2-4 s the hypothesis estimated: the 494 KB still
   shares one Slow 4G wire with wave 1, so arrival moves only about 1 s.
   On desktop the engine was never the wait, and construction does not move.
3. **Whether the pin moves is the open question, and history says check.**
   The September worker warm moved its module 6.3 s and the pin not at all.
   Since then `lib/mapFirstPinStreams.ts` holds the shard burst until the
   pins paint, so construction may now be closer to the gate than it was. A
   second earlier engine is a reason to measure the pin, not proof that it
   moves.

## What it would take to ship

1. **Measure the pin.** Re-run `scripts/perf-map-chunk-preload-ab.mjs` (JS-only
   graph) on a machine that can reach the basemap hosts, at least five pairs
   per device. Ship only if the first tappable pin moves and LCP holds.
2. **Generate the graph from the build, not from hashes.** No build-generated
   manifest Next ships carries this graph today:
   - `server/app/map/page/react-loadable-manifest.json` (Turbopack) lists
     the PubMap entry but not PubMapCanvas, whose `next/dynamic` is built
     inside `loadPubMapCanvas()`. Its keys are bare module ids, and one entry
     (`942692`) names a chunk, `376x4ev-99mgu.js`, that does not exist in
     `static/chunks/`. The same dangling name sits in every page's manifest.
   - Next's own reader of that manifest, `PreloadChunks`
     (`next/dist/shared/lib/lazy-dynamic/preload-chunks.js`), runs only for
     `ssr: true` dynamics, and it emits exactly the low-priority script
     preloads measured here.
   - The canvas lists exist only inside the client runtime: the loader
     tables in the PubMap chunk and the shell's warm chunk
     (`[...].map(t=>e.l(t))).then(()=>t(<moduleId>))`).

   So a shippable version needs one of two things. One is Next's loadable
   manifest carrying the canvas entry, read through Next's own `PreloadChunks`
   path, which also survives the hourly ISR re-render of the prerendered
   document. The other is a post-`next build` reader of Turbopack's
   minified client output, which is an undocumented format and would break
   on a bundler upgrade. Reading `.next/static` from the page at prerender
   time is not an option: the hourly ISR re-render runs where `.next/static`
   is absent and would silently drop the links.
3. **Respect Save-Data.** `/map` is CDN-cached, so the server cannot vary on
   the `Save-Data` header. The document may run inline scripts (`proxy.ts`
   gives the prerendered documents `'unsafe-inline'`). So the links would be
   added by a few bytes of inline script that skip `navigator.connection.saveData`
   and `slow-2g`/`2g`, the same gate as `shouldWarmMapIntent`
   (`lib/mapWarmup.ts`). Plain `<link>` tags cannot express that gate.
