# Last orders on /tonight

30 October 2026. Browser clock frozen at Friday 30 October 2026, 22:45 London time. Shots taken by `e2e/last-orders.spec.ts` on a local production build.

| Shot | What it shows |
| --- | --- |
| [last-orders-390x844.png](last-orders-390x844.png) | Phone. No location shared, so walks are from central London. The get-home line asks for a position. |
| [last-orders-1280x800.png](last-orders-1280x800.png) | Desktop. The same list beside the Tonight rail. |
| [last-orders-soho-full-390.png](last-orders-soho-full-390.png) | The whole list beside The French House at 21:45 on Sunday 1 November. Its row reads "No price yet": its £3.40 is a half pint with no source or date, so it is not shown as a pint. |
| [last-orders-located-390x844.png](last-orders-located-390x844.png) | Phone with a shared position in Soho. The last-train answer is empty, so the line says there is no time and shows none. |

Hours are OpenStreetMap `opening_hours`, read 5 October 2026. Pint prices are the curated venue index, read 2 October 2026.

## The map filter

| Shot | What it shows |
| --- | --- |
| [map-last-orders-390x844.png](map-last-orders-390x844.png) | Phone map opened with `/map?lastOrders=1`. The Filters control counts one filter. |
| [map-last-orders-filters-390x844.png](map-last-orders-filters-390x844.png) | Phone Filters sheet with Last orders on, and the map behind it with the pins narrowed. |
| [map-last-orders-1280x800.png](map-last-orders-1280x800.png) | Desktop Filters panel with Last orders on and its caption. The shot was taken before the basemap painted, so the count it shows (6) is from a part-loaded map, not the final count. |

All shots were re-taken after the price fix that removed The French House half pint, with night dark mode on: at 22:45, a reader with no stored theme choice sees Last orders, and the map with its filter on, in the dark theme.
