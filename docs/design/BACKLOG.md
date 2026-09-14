# Design backlog

Open design debt and raised design decisions. A `docs/proof/` directory records
one finished measurement and nobody re-reads one, so anything still OPEN when a
review lane closes belongs here instead. `docs/DESIGN_SYSTEM.md` points at this
file from its "Where each law is fenced" index.

A row leaves this file when it is shipped or withdrawn, and the commit that
closes it says which. A row is not a plan: it names the defect, where it is,
and the one thing that makes it hard.

## Open debt

The three rows this file opened with shipped together in the design-review
follow-ups lane; the measurement is
[`docs/proof/design-review-followups/`](../proof/design-review-followups/), and
each row is in Closed below. The rows here were measured on 14 September 2026
at 1440 and 1280 with a venue drawer open over a mapped two-stop route.

| Defect | Where | What makes it hard |
|---|---|---|
| The route chip stacks 10px above the bottom-left status banner, and with the drawer open the two pills overlap sideways with ragged left edges. | `.mappedRouteChip` (`bottom: 82px`, `app/globals.css`) beside `.cityStatusStack` moved to the bottom-left lane by `components/map/mapBannerStaging.css`. | The status stack has no fixed height and opens into a panel, so a fixed lift is a guess; the bottom chips and the banner need one shared flow. |
| Escape from the drawer's last control, opened from List view, leaves the drawer open; `e2e/map-accessibility.spec.ts` "keeps desktop drawer focus inside" is red at that step on main. | `components/map/pubmap/useMapKeyboardShortcuts.ts` calling the surface trail's Back. | Back from a pub opened out of List view has to decide whether the drawer closes or the list returns under it. |
| At 1280 the search placeholder is cut mid-word, and the zoom buttons do not show beside `Recenter`. | The desktop map toolbar and camera controls. | Both sit in the 641 to 1280 chrome budget other lanes have already cut. |

## Decisions raised and still open

| Key | The question | Where it stands |
|---|---|---|
| `consent-before-answer` | The analytics consent card is the first thing a new reader meets at 320 and 360, over the answer card on `/` and over the first list on `/near` and `/tonight`. PlanAstra section 3 moves it to the third screen. | Its own lane. A flow decision rather than a defect, so no sweep may take it in passing. |
| `map-kind-chips-behind-filters` | The kind chips row at 641px and up belongs behind a desktop `Filters` control (PlanAstra item 9). | A map lane. It needs a new control and it moves every spec that clicks a chip today. |

## Closed

| Key | Answer | Where |
|---|---|---|
| `head-primary-on-form-screens` | A form screen paints no head primary: the form's own submit, beside the field it submits, is the one painted control. | Captain, 7 September 2026; applied in #1597 and written into `docs/design/LAUNCH_SCREENS.md`'s rules list. |
| The profile editor's own form buttons | Every text button on `/u/you` is the Button primitive in its quiet variant, and the surface's stylesheet paints none of them. A destructive action is the primitive's `danger` fill rather than a box of its own. | The design-review follow-ups lane; proof `docs/proof/design-review-followups/`. |
| One family for number-square chips | The planner's pub-stop count and the /pubs fare-zone picker both render `Chip variant="number"`, painted from the `--control-*` row by `components/ui/chip.css`. The map's segmented zone picker keeps its own recorded treatment. | Same lane. |
| The five quick price chips wrapping 4 + 1 at 390 | `lib/priceChipLadder.ts` owns the column count and the composer's grid reads it: four across at every width, so the fifth chip starts the second row in the first column. Four rather than five because the desktop drawer's row is 238px and five 44px targets need 244px. | Same lane. |
