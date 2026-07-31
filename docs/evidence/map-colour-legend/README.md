# Map colour key evidence

Review target: Manchester landing view at zoom 11.2.

## Decision

Desktop keeps a small Key control on the map. Phone puts Key first in the existing More sheet. The phone map stays unchanged until someone opens the sheet, and returns in one tap. No control was added to the top bar.

The desktop cluster donut already showed its known price mix at zoom 11.2. Individual pins begin at zoom 12, 0.8 above the landing view. Phones and large cluster sets used solid circles whose colour meant cluster size. They now use the most common known price band inside each cluster. Grey means that cluster has no known price. Cluster radius, count, zoom limits and collision rules did not change.

The key derives from committed scene state. The coordinator in
`components/map/canvas/pubSourceRevision.ts` tags each `pubs` update and
publishes only after its worker and source settle and a later render crosses;
source errors publish nothing. That commit hands the same revision to desktop
donut reconciliation and to `deriveMapRenderedState` in
`lib/mapRenderedState.ts`, so cluster paint and key rows cannot advance on
different requested objects. Mobile clusters remain in MapLibre layers and use
the same source revision.

## Legend authority

The live Map key is the authoritative user-facing explanation of current price bands, clusters, pin shapes, dots, rings, and route states. `lib/mapPriceLegend.ts` owns its wording and trust distinctions; `components/map/MapKey.tsx` renders every colour beside a visible symbol and text. The key names similar-looking marks separately instead of relying on colour or shape alone.

## Captures

Before:

- [Desktop dark, 1440 by 900](before-desktop-dark.png)
- [Desktop light, 1440 by 900](before-desktop-light.png)
- [Phone dark, 390 by 844 at 3x](before-mobile-dark.png)
- [Phone light, 390 by 844 at 3x](before-mobile-light.png)

After, map key open:

- [Desktop dark, 1440 by 900](after-desktop-dark.png)
- [Desktop light, 1440 by 900](after-desktop-light.png)
- [Phone dark, 390 by 844 at 3x](after-mobile-dark.png)
- [Phone light, 390 by 844 at 3x](after-mobile-light.png)

After, unobscured phone map at the same landing zoom:

- [Phone dark, 390 by 844 at 3x](after-mobile-dark-map.png)
- [Phone light, 390 by 844 at 3x](after-mobile-light-map.png)

The after phone captures measure 390 CSS pixels wide with a 390-pixel document width. All five sheet tabs fit between x=4 and x=388. Tabs and disclosure controls have 44-pixel touch targets. Accessibility snapshots expose Map controls as a dialog, Key as the selected tab, price bands as text, and Pin shapes, Dots and rings, and Routes as disclosures. The desktop Key is a native button; Escape closes it and Enter reopens it with focus retained.

Code authorities: `lib/mapPriceLegend.ts` owns the key,
`lib/mapRenderedState.ts` owns its committed-scene input,
`components/map/canvas/pubSourceRevision.ts` owns publication, and
`components/map/canvas/donutClusters.ts` owns the desktop revision fence.
`components/map/canvas/buildScene.ts` owns map density and collision contracts.
Community-price authority remains with
`components/map/communityPriceSignals.ts`.
