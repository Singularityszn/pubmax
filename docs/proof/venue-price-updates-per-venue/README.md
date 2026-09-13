# The Drinks tab reads one pub's price updates, and the map names its worker

Lane 1.13 of the PlanAstra review (decision D7, amendment 4). Two items, and
nothing that `docs/proof/map-bytes-first-pin/` already records as shipped:

1. The Drinks tab read the two observed price-update packs in full, 1862 KB of
   drink rows and 1519 KB of food rows, to draw a handful about one pub.
   `GET /api/venue/[id]` now scopes both packs to that pub's own lookup keys
   and carries them beside `bundlePrices`. The browser loader is deleted.
2. The map documents name the MapLibre worker and its shared module in two
   `<meta>` tags and fetch neither, because `perf/AGENTS.md` forbids a warm
   before `pubmax:first-pins`.

## The rig

| | |
| --- | --- |
| Build | two local production builds, keyless, with the Playwright `webServer` env, each from `git archive` of its commit, served by `next start` on its own port |
| Before | `9a3fa5bd4` (main at the branch point) |
| After | this branch |
| Browser | Playwright Chromium with SwiftShader, so the map gets a real WebGL2 context |
| Phone | 390x844, DPR 1, 4x CPU throttle, Slow 4G (135 ms, 188,743 B/s down, 86,400 B/s up) |
| Cold | a fresh browser context per route |
| Settle | 25 s after `load`; on the Drinks rows, 25 s more after the tab is tapped |
| Bytes | decoded response bodies over every request the page made |

The script is `measure.mjs` in this directory. The raw figures are the four
`bytes-*.json` files.

## Decoded bytes, cold

A pub with NO overlay rows (`venue-1vle947`, the audit's own pub):

| Route | Before | After | Change |
| --- | --- | --- | --- |
| `/map` | 7168 KB over 198 requests | 7168 KB over 198 requests | none |
| `/map?sel=venue-1vle947` | 9501 KB over 223 requests | 9503 KB over 223 requests | +2 KB |
| same, Drinks tab open | 13122 KB over 247 requests | 9510 KB over 197 requests | **-3612 KB (-28%)** |

A pub WITH overlay rows (`venue-16pnwmm`, Prospect of Whitby, 53 drink rows and
77 food rows):

| Route | Before | After | Change |
| --- | --- | --- | --- |
| `/map` | 7168 KB over 198 requests | 7168 KB over 198 requests | none |
| `/map?sel=venue-16pnwmm` | 7451 KB over 185 requests | 7512 KB over 175 requests | +61 KB |
| same, Drinks tab open | 11067 KB over 202 requests | 7748 KB over 203 requests | **-3319 KB (-30%)** |

The single responses that moved:

| Response | Before | After |
| --- | --- | --- |
| `/data/drink_price_updates/latest.json` on Drinks | 1862 KB | not requested |
| `/data/food_price_updates/latest.json` on Drinks | 1519 KB | not requested |
| `/api/venue/venue-1vle947` | 3,844 B | 3,882 B |
| `/api/venue/venue-16pnwmm` | 16,175 B | 81,497 B |

## The cost this moves, stated

The rows now ride on the venue detail the sheet fetches anyway, so a reader
pays for them on the sheet open and not on the tab. For a pub with no rows that
is 38 bytes. For Prospect of Whitby, one of the richest pubs in the packs, it
is 65 KB, against the 3381 KB the same reader paid on the tab before. That is
the shape the review asked for ("through `/api/venue/[id]`, which already
carries `bundlePrices`"), and it is named here so nobody reads the `?sel=` row
as free.

## The worker pair

Both arms request `/vendor/maplibre/maplibre-gl-worker.mjs` (19 KB) and
`/vendor/maplibre/maplibre-gl-shared.mjs` (481 KB) exactly once on `/map`, at
the same point. The after documents state both URLs in
`<meta name="pubmax:maplibre-worker">` and
`<meta name="pubmax:maplibre-worker-shared">`, which cost no request. `/map`
decodes 7168 KB on both arms, so the naming bought no byte and no fetch.

## What the drinker sees

Drinks tab on Prospect of Whitby, after arm. The hub and the priced list at 390
and 768 are BYTE-IDENTICAL to the before arm. At 1440 the sheet is visually
identical and the file differs only in the live map canvas behind it.

| Width | Hub | Priced list |
| --- | --- | --- |
| 390 | `shots/drinks-hub-390.png` | `shots/drinks-list-390.png` |
| 768 | `shots/drinks-hub-768.png` | `shots/drinks-list-768.png` |
| 1440 | `shots/drinks-hub-1440.png` | `shots/drinks-list-1440.png` |

## Left alone on purpose

The Wetherspoon pack under Open now, `/plan` waiting for `composerVisible`, and
`/pal/chat` keeping its 911 KB are shipped and measured in
`docs/proof/map-bytes-first-pin/`. No ceiling in `perf/` moved.
