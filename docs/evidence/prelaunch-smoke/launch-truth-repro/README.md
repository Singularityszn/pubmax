# Launch truth defect reproduction

Reproduced on 31 July 2026 from a fresh signed-out browser. Live-site captures
use the requested 1440x900 and 390x844 viewports. Deterministic MapLibre
reproductions use the real app with only basemap network responses replaced.

## 1. False map-background failure

The current live deployment did not reproduce the toast in this later pass. At
1440x900 I saw a full-size MapLibre canvas with background and pins, and no
`.mapSoftRetry` element. That observation is captured in
`01-map-false-failure-desktop.png`; it is not presented as a failing capture.

I reproduced the reported condition against the pre-fix code using a
deterministic MapLibre style with one visible raster source returning a tile and
one secondary raster source left pending. The canvas rendered. After the
12-second readiness ceiling, `.mapSoftRetry` appeared with:

> Map background couldn't load. Tap Retry to try again.

The pre-fix unit regression failed with a `timeout` reveal where it expected a
`tiles` reveal. The pre-fix Playwright regression failed because
`.mapSoftRetry` had count 1 where it expected 0.

Cause: first-paint success required every tiled source to settle. One painted
source plus one pending source was therefore reported as total background
failure.
