# Mobile map pin first-impression evidence

## Verdict

Late render. Default filters were clear and venue data was present. Mobile
loading chrome retired after basemap paint, while MapLibre was still processing
and compositing the `pubs` GeoJSON source. Landmark icons use a separate source,
so they appeared first and made the unfinished map look settled.

Before the fix, the recorded app fired `pubmax:pin-reveal` at 10,416.8 ms after
navigation and removed loading chrome at 10,517.0 ms. The recording still showed
only landmarks at its 12-second frame. The paired screenshot contains zero
cluster-colour pixels in the map crop.

After the fix, the same recording review shows loading chrome in the 15.20-second
video frame and coloured price clusters in the next sampled frame at 15.25
seconds. The settled screenshot contains 7,305 cluster-colour pixels in the same
crop. There is no empty-and-settled frame at the handoff.

## Measured timing

Measured from browser `first-paint` to the first visual frame after the
source-aware reveal. Three fresh runs per viewport:

| Viewport | Run 1 | Run 2 | Run 3 | Median |
| --- | ---: | ---: | ---: | ---: |
| 390x844 mobile | 6,802.0 ms | 5,372.5 ms | 5,716.3 ms | 5,716.3 ms |
| 1440x900 desktop | 16,550.5 ms | 14,643.2 ms | 12,308.7 ms | 14,643.2 ms |

These are controlled reproduction timings, not customer-device benchmarks.
Headless Chromium used SwiftShader, and the larger desktop WebGL surface was
slower in these runs. Every figure above comes from
[`timings.json`](./timings.json).

## Method

- Next.js production build served from the isolated worktree on localhost.
- Playwright Chromium, headless, SwiftShader WebGL.
- Fresh browser context per run, storage cleared before app code, service
  workers blocked.
- Browser Paint Timing supplied `first-paint`.
- Pin visibility boundary was the first animation frame after
  `pubmax:pin-reveal`. That event now follows slim-index settlement,
  `map.isSourceLoaded("pubs")`, a render with visible pub layers, and the
  phone compositor guard.
- Recording metadata was checked in Chromium: 390x844, 16.84 seconds.
- Screenshot pixel check used the shipped light cluster colours with an
  18-channel tolerance over the 390x510 map crop beginning at y=180.

Raw pre-fix instrumentation remains in
[`timings-before.json`](./timings-before.json). Its reveal timestamp is a
readiness proxy only, because the investigation proved that old event did not
mean pixels were visible.

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
