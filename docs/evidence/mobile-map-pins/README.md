# Mobile map pin first-impression evidence

## Verdict

Late render. Default filters were clear and venue data was present in app
memory. Mobile loading chrome retired after basemap paint, while MapLibre was
still processing and compositing the `pubs` GeoJSON source. Landmark icons use
a separate source, so they appeared first and made the unfinished map look
settled.

Before the fix, the recorded app fired `pubmax:pin-reveal` at 10,416.8 ms after
navigation and removed loading chrome at 10,517.0 ms. The recording still showed
only landmarks at its 12-second frame. The paired screenshot contains zero
cluster-colour pixels in the map crop.

After the fix, the clean recording shows loading chrome at 11.88 seconds and
coloured price clusters in the next 25 fps frame at 11.92 seconds. The settled
screenshot contains 6,651 cluster-colour pixels in the same crop. There is no
empty-and-settled frame at the handoff. If the phone cannot confirm that frame
before the readiness ceiling, it now shows the honest no-frame fallback instead
of retiring loading chrome.

## Measured timing

Measured from the first painted product frame to the first frame containing
real cluster pixels. Both boundaries come from each run's WebM recording. Three
fresh runs per viewport:

| Viewport | Run 1 | Run 2 | Run 3 | Median |
| --- | ---: | ---: | ---: | ---: |
| 390x844 mobile | 13,400 ms | 5,640 ms | 7,520 ms | 7,520 ms |
| 1440x900 desktop | 22,600 ms | 22,440 ms | 40,400 ms | 22,600 ms |

These are controlled reproduction timings, not customer-device benchmarks.
Headless Chromium used SwiftShader, and the larger desktop WebGL surface was
much slower in these runs. Every figure above comes from
[`timings.json`](./timings.json).

## Method

- Next.js production build served from the isolated worktree on localhost.
- Playwright Chromium, headless, SwiftShader WebGL.
- Fresh browser context per run, storage cleared before app code, service
  workers blocked.
- First paint was the first recorded frame with at least 20 visibly chromatic
  product pixels in a quarter-scale viewport. This excludes Playwright's blank
  recorder frame.
- Pin visibility was the first recorded frame with the shipped light cluster
  colours in the map crop. Mobile required 500 half-scale pixels and desktop
  1,000, avoiding the coloured dots in the route-loading illustration.
- Both frames were sampled on the same WebM timeline every 0.04 seconds. No
  conversion from browser clock to video clock was used. Precision is plus or
  minus 40 ms.
- Browser Paint Timing, `pubmax:first-pins`, `pubmax:pin-reveal`, loading
  transitions, pixel counts, and default filter state remain in the raw JSON as
  cross-checks.
- Clean journey recording metadata was checked in Chromium: 390x844, 17.08
  seconds.

Raw pre-fix instrumentation remains in
[`timings-before.json`](./timings-before.json). Its reveal timestamp is a
readiness proxy only, because the investigation proved that old event did not
mean pixels were visible.

## Remaining wait finding

The fix makes the wait honest; it does not make the map fast. In the clean
phone recording, first product paint is at 1.00 seconds and the first cluster
frame is at 11.92 seconds, leaving a 10.92-second visible wait.

Venue data does not dominate that wait. Browser marks from the same run put
first paint at 960.0 ms, slim pins ready at 2,919.0 ms, and the source-aware
pin reveal at 10,581.5 ms:

- Initial app and slim-data work took 1,959.0 ms after first paint.
- The MapLibre readiness and compositing lane then took 7,662.5 ms from slim
  pins ready to reveal, 79.6% of the measured browser-clock wait.
- The deliberate phone compositor guard is the final 500 ms of that lane. The
  preceding 7,162.5 ms is waiting for MapLibre's basemap, GeoJSON worker/source,
  and confirmed render path.

This run ended through the `tiles` path, not the 12-second readiness ceiling.
Current marks do not distinguish whether basemap tile paint or `pubs` source
processing was the last of those MapLibre prerequisites. Next performance
investigation should time those two signals separately. No performance fix is
attempted here.

The six timing runs also recorded three unrelated local-production failures:
`/_vercel/insights/script.js` returned 404, while
`/api/pint-drops?city=london` and
`/api/pint-drops?venueId=venue-s0go8s` returned 500. Server logs identify the
Pint Drops cause as production mode refusing an in-memory store without
Supabase. The explicit local production QA override was not set. Venue data,
map style, and pin-source requests succeeded; all failed URLs are preserved per
run in `timings.json`.

## Artifacts

- [`mobile-cold-load.webm`](./mobile-cold-load.webm): fixed cold load through
  price clusters appearing.
- [`mobile-cold-load-before.webm`](./mobile-cold-load-before.webm): reproduced
  landmarks-only handoff.
- [`mobile-pins-visible.png`](./mobile-pins-visible.png): fixed settled frame.
- [`mobile-landmarks-only-before.png`](./mobile-landmarks-only-before.png):
  reproduced empty-looking frame.

## Banner check

A separate 390x844 run mocked a severe city-status response while the city
suggestion condition was also available. Phone DOM counts were zero for both
banner classes because both are desktop-gated. No phone banner queue change was
needed.

## Scope and complexity

No phone control-row, pin-colour, price-band, or map-key code changed.
`PubMap` complexity moved from 233 to 234 for the active-city readiness guard.
`PubMapCanvas` remained 78.
