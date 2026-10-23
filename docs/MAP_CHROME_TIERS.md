# Map chrome tiers

`lib/mapChromeTiers.ts` owns the control descriptors. `MobileMapShell` renders
them within the phone map's resting-layer contract below.

| Tier | Surface | Treatment |
|---|---|---|
| 1 | **Near me** | The map's locate control. On a phone it is a round map-edge FAB on the same quiet surface as the bar: the raised panel, a hairline edge, no accent. |
| 2 | **Filters** | Quiet icon-button in the one top bar. The refinement count is the badge. The drink lane has its own control and sheet. |
| 3 | **TfL** | Not a resting control. Its everyday home is the Transit tab of More map controls. A compact 44px icon-button joins `.mobileMapUtilityCorner` (fixed, right edge, head of the column) only while a tube line is badly disrupted, and it wears that count. |

The [phone map resting-layer contract](rules/components-sheets-chrome-and-navigation.md#the-phone-map-rests-on-three-layers-and-the-bottom-card-is-the-answer)
owns Tonight's placement, List access, the bottom card and the TfL badge policy.
Mobile map action geometry belongs to `components/mobile/mobileMapShell.css`.

## Narrow desktop state

Tablet and narrow-desktop widths use a contained toolbar rather than squeezing
the complete desktop accessory row. City, search, and Plan remain available;
conditions, zone, and the other desktop extras stand down so the toolbar stays
inside the viewport and clear of the Tonight Arc. The media queries in
`components/map/mapToolbar.css` and `components/map/citySwitcher.css` own the
exact boundary and layout.

The current shell props live in
[`MobileMapShell.tsx`](../components/mobile/MobileMapShell.tsx). Its caller is
[`PubMap.tsx`](../components/PubMap.tsx).
