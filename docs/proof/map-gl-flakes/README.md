# Three map browser specs, five repeats each on a production build

Measured 5 October 2026. Each run built the app with `next build` and served it
with `next start` (Playwright's own `webServer`, `NEXT_PUBLIC_SW_VERSION=local`),
then ran the specs with one worker and no retries:

```
PW_PORT=3740 PW_SKIP_KEYLESS_WEBSERVER=1 npx playwright test \
  --project=chromium-gl --project=chromium-sw-gl \
  -g "keeps Manchester cluster markers mounted after granted location settles|target worker replaces the pre-fix controller|granted location paints a dot that moves without moving the camera" \
  --repeat-each=5 --workers=1 --retries=0
```

The "before" column is the branch head before the cluster fix below
(`d7ad1db03`), which already carried this branch's earlier fixes. It is not
`main`.

| Spec | Before | After |
|---|---|---|
| `e2e/map-gl.spec.ts` "keeps Manchester cluster markers mounted after granted location settles" (chromium-gl) | 0 of 5 | 5 of 5 |
| `e2e/map-service-worker.spec.ts` "target worker replaces the pre-fix controller and purges poisoned tiles" (chromium-sw-gl) | 5 of 5 | 5 of 5 |
| `e2e/map-you-are-here.spec.ts` "granted location paints a dot that moves without moving the camera" (chromium-gl) | 5 of 5 | 5 of 5 |

The same build then ran `e2e/map-gl.spec.ts`, `e2e/map-console-health.spec.ts`
and `e2e/map-desktop-arrival-chrome.spec.ts` once each with two workers: 30 of 30
passed.

## The Manchester cluster flicker was a product defect

Every failed repeat sampled donut counts like
`28,28,28,0,28,28,28,28,0,28,...` on a still map at z10.8. A temporary log in
`components/map/canvas/donutClusters.ts` showed what cleared them: an `idle`
event about every 500 ms whose `querySourceFeatures("pubs")` returned no
clusters, while `isSourceLoaded("pubs")` was true and the map was not moving.

Below `PIN_MIN_ZOOM` (12), the GL cluster disc and its count are the only layers
on the `pubs` source. The donut sync hid both with `visibility: none` while the
donuts drew. MapLibre then counts the source as unused and drops its tiles, so
the next settled query was empty. The sync cleared every donut and showed the GL
layers again. The source loaded again, the donuts came back and hid the layers,
and the loop repeated with no input. A desktop reader saw the city's clusters
blink.

The fix swaps the layers' filter (`CLUSTER_FILTER`, or `false` while donuts
draw) and leaves visibility to the pin-reveal gate alone, so the source stays in
use. Pin: `__tests__/canvas-donutClusters.test.ts`.
