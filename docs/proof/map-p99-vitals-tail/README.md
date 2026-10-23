# map-p99-vitals-tail (2026-10-15)

Record of its day. The owner targets the p99: real-user PostHog `$web_vitals`,
30 days, n=199, LCP p75 1.9 s / p99 10.7 s, INP p75 180 ms / p99 2.9 s, CLS
p75 0.06 / p99 0.62. This hunt was for the CLS and INP tail.

## Rig

- Two local production builds of the same commit on private ports: `.next-before`
  (origin/main 9d7a17c) and `.next-after` (this branch), keyless, `next start`.
- Playwright Chromium with SwiftShader so the map gets real WebGL; 390x844 phone,
  `isMobile`, 4x CPU, Chrome Slow 4G (150 ms RTT, 188,743 B/s down).
- The tile CDN is unreachable from the sandbox, so the basemap style is stubbed
  exactly as `e2e/helpers/mapNetworkFixtures.ts` does it (`lab/basemap.mjs`).
  Without the stub /map measures its fallback card, not the map.
- `lab/vitals-lab.mjs`: per route, load, 12 s settle, scroll down and back up
  (scroll is not "recent input", so shifts during it count), then the route's
  main tap. Records every layout shift with its sources, CLS as web-vitals'
  session window, long tasks, and Event Timing per interaction.
- `lab/sheet-lab.mjs`: /map, close the arrival strip, select a venue from the
  peek's answer row (the same `selectVenue` a pin tap runs), then 9 s for the
  sheet to fill. `DELAY_DETAIL_MS` holds `/api/venue/[id]` so the panel chunk
  lands before the venue read, which is the order on every open after a
  session's first (the chunk is cached by then).

Run them with `node docs/proof/map-p99-vitals-tail/lab/<script> <base> <out.json> [runs]`;
`CHROMIUM_PATH` points them at a preinstalled Chromium.

## Findings and results

1. **Selecting a venue on /map: INP 1084 ms median.** A profile of the tap
   showed the pin source rebuilt and re-sent inside the tap's own frame,
   because `withForcedVenue` returned a fresh array on every selection; the
   "List view" model sorted every venue in view by distance on every camera
   frame although the list was closed; and the first open of each pub rebuilt
   the freshest-pint map with no new pint in it, which rebuilt every pin again.
   Interleaved before/after runs, same box:

   | | n | median | p75 | p90 | max |
   | --- | --- | --- | --- | --- | --- |
   | before | 18 | 1084 ms | 1142 ms | 1198 ms | 1272 ms |
   | after | 13 | 904 ms | 936 ms | 973 ms | 1024 ms |

   Mann-Whitney U = 28, p = 0.0004.

2. **The venue panel jumps into the sheet after its read: CLS 0.287.** While
   `/api/venue/[id]` is out, `renderVenuePanel` draws the read's 92dvh skeleton
   AND the already-mounted panel below it, clipped out of view. When the read
   lands the skeleton goes and the panel moves up into the sheet, seconds after
   the tap. With the read held 6 s: before 0.2870, 0.2870, 0.2870; after 0.0042,
   0.0042, 0.0042. Without the hold it surfaced in 1 run of 21 on a cold cache,
   where the chunk usually loses the race; with a warm chunk it wins every time
   the read is slower than the chunk, which is the p99 shape.

3. **Per-route CLS / INP, load + scroll + main tap, 2 runs each** (medians):

   | route | CLS before | CLS after | INP before | INP after |
   | --- | --- | --- | --- | --- |
   | /map (canvas tap mid-load) | 0 | 0 | 592 ms (n=11) | 696 ms (n=11) |
   | / | 0 | 0 | 44 ms | 40 ms |
   | /u/you | 0.0266 | 0.0266 | none | none |
   | /tonight | 0.004 | 0 | 64 ms | 48 ms |
   | /plan | 0 | 0 | 88 ms | 76 ms |
   | /out | 0.0431 | 0.0431 | none | none |
   | /places | 0 | 0.001 | none | none |
   | /pal | 0 | 0 | 284 ms | 288 ms |

   The /map canvas-tap row is a tap on empty map 18 s into a throttled load,
   beside long tasks of up to 1.4 s; the two arms do not differ (Mann-Whitney
   p = 0.65, n = 11 each). The /tonight and /places blips are early-load
   hydration shifts on surfaces this change does not touch.

## Not fixed here, ranked

See the PR body. The largest remaining /map item is the selection frame itself
(still ~900 ms on this rig: `selectVenue`'s dozen state updates re-render the
7k-line PubMap and mount the inspector synchronously, and the selected-pin
`setLayoutProperty` calls force symbol re-placement).
