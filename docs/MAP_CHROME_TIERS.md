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

The map's Tonight count, cards, category choices, and onboarding use eligible
What's-on listings after duplicate removal. `filterTonightPubSurfaceRows` in
`lib/tonightOutListings.ts` applies Tonight's pub-match, check-date, and ended-event
filters. `tonightPubListingCount` counts those rows.

The phone Filters sheet labels this count **Pub listings tonight**.
The count and source caption cover What's-on only, while Tonight also accepts
Out listings. The phone count distinguishes **near you** from **in London**.
CityMCP **Pins** keep their separate count and actions.

A selected category stays selected when its eligible listings disappear.
The open lane explains that category's empty result and keeps **All** available
to clear the filter. An empty category does not mean every category is empty.
After a successful read, an empty phone Tonight sheet states that nothing is
listed unless it explains a selected category's empty result.

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

## The list beside the map

From 1024px the map shares the window with the list of the venues in view
(`components/map/MapSplitList.tsx`). The map stage starts at the list's right
edge, so every tier above is laid out in the map lane, never across the list.
From 1024 to 1279px that lane is 624 to 880px wide, so the toolbar takes the
drawer-lane treatment (search on its own line) and the right rail steps aside
while the planner is open. `components/map/mapSplitList.css` owns those widths,
and the [split view rule](rules/components-sheets-chrome-and-navigation.md#from-1024px-the-list-sits-beside-the-map-and-the-two-move-together)
owns the contract.
