# Map chrome tiers

`lib/mapChromeTiers.ts` owns the control descriptors. `MobileMapShell` renders
them within the phone map's resting-layer contract below.

| Tier | Surface | Treatment |
|---|---|---|
| 1 | **Near me** | The only primary-weight chip (`.mobileMapChipPrimary`, filled accent); on phone a round map-edge FAB |
| 2 | **Filters** | Quiet icon-button in the one top bar. The refinement count is the badge. The drink lane has its own control and sheet. |
| 3 | **TfL** | Compact 44px icon-button in `.mobileMapUtilityCorner` (fixed, right edge). |

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
