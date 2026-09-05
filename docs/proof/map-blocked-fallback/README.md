# A blocked map still gets the reader to the venue

F08/J33, measured 5 September 2026 on a production build (`next build` + `next start`),
Chromium, service worker blocked, one chunk aborted: the single served chunk whose
body carries `maplibregl`. Before shots are `origin/main` at `4a435c464`.

Spec: `e2e/map-blocked-fallback.spec.ts` (10 cases). Screenshots are captured
only under `PUBMAX_MAP_BLOCKED_SHOTS=1`, so the spec itself never fails on a
CDP screenshot call.

## What was measured

| Case | Before | After |
|---|---|---|
| `/map`, map library blocked, 390 / 768 / 1440 | the whole-app error page ("Spilled."); no venue list, no sheet, no composer | `Map couldn't load`, one sentence, six real pubs with borough and price, `Browse all pubs`, `Retry` |
| `/map?sel=venue-1vle947`, blocked, 390 | "Spilled."; the pub's sheet never opened | the pub's own sheet opens |
| `/map?sel=venue-1vle947&log=1`, blocked, 390 | "Spilled."; the Pint Drop price step never rendered | the composer's price step is on screen |
| `/map?sel=venue-does-not-exist`, blocked, 390 | "Spilled." | the venue view, with pubs listed |
| `/map?sel=venue-does-not-exist`, live map, 390 | the note painted unstyled at `{x: 0, y: 0, width: 390, height: 28}`, one clipped line over the phone top bar | a styled card clear of the chrome, inside the viewport |
| Every tile source refused, 390 | the basemap `Retry` button's own centre point was owned by `BUTTON.mobilePlanActivation` | the point is owned by `mapSoftRetryBtn` |

## The venue index, with no canvas

A canvas is the only thing that reports map bounds, and three arrival lanes wait
for that report before reading a shard. Measured with the chunk blocked, at 30s:

| Route | Before | After |
|---|---|---|
| `/map` | 141 venues, index loaded | 1,028 venues, index loaded |
| `/map?sel=venue-1vle947` | 1 venue, index still loading | 1,028 venues, index loaded |
| `/map?sel=venue-1vle947&log=1` | 1 venue, index still loading | 1,028 venues, index loaded |
| `/map?sel=venue-does-not-exist` | 0 venues, index still loading | 1,028 venues, index loaded |

## Files

`before-*.png` and `after-*.png`, named by case and viewport.
