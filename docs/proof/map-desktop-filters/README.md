# The venue types are one Filters control from 641px up

PlanAstra item 9, over the map's chrome overload at 768 and 1440.

## What was wrong

The five venue-type chips (Pints, Bars, Clubs, Food, Restaurants) floated over
the desktop map as a permanent band at every width from 641px up. PlanAstra
counted what a tablet met on first load: "five kind chips, a search row with
Drink: Pints, Show me, Drinks, Plan an outing and LON, Show all, Reset view, a
Visiting another city? Near me? banner, a road closures banner, the first-visit
card, the Layers button, Ask your Pub Pal, plus the zoom control ... That is 20
to 24 controls before one pin has been tapped."

## What changed

The chips are now the contents of ONE `Filters` control in the toolbar row,
which the reader opens. Nothing below 641px moved: a phone still reads the same
toggles in its own Filters sheet, and the desktop control is `display: none`
there.

The state is unchanged. The popover is a VIEW of the map's own
`venueKindVisibility`: same defaults, same experience-lens round trip, and
closing the panel writes nothing.

## Shots

Taken on a production build (`NEXT_DIST_DIR=.next-prod next build`, served with
`next start`), Chromium at deviceScaleFactor 2, onboarding and tour dismissed.

| file | what it shows |
| --- | --- |
| `before-768-map.png` | 768x1024, the chips floating over the map under the toolbar |
| `before-1440-map.png` | 1440x900, the same band |
| `after-768-map.png` | 768x1024, the map with the band gone and one `Filters` control in the row |
| `after-768-filters-open.png` | the popover open, all five chips inside it |
| `after-768-filters-count.png` | two kinds switched off, the count on the closed control |
| `after-1440-map.png` | 1440x900, at rest |
| `after-1440-filters-open.png` | the popover open |
| `after-1440-filters-count.png` | `Filters · 2` and the `Show all types` reset |

## The two judgements the shots record

1. **The word goes under 900px, the count stays.** The toolbar row is a budget
   from 641 to 900px (the top bar already drops its own "More" label in the same
   band), and the search field is what a longer label costs. The accessible name
   carries the whole sentence at every width: `Filters: venue types, 2 types
   hidden`.
2. **The camera controls did not move.** PlanAstra's inventory names `Show all`
   and `Reset view` in the same overload list, and the brief for this lane put
   them in the popover. They stayed where they are: they are camera actions
   owned by `PubMapCanvas` (a city fit and the compass), not venue filters, and
   the map-camera stack publishes its own height to the zoom column's berth in
   `mapToolbar.css`. Folding a camera reset into a filter panel would have been a
   second, riskier change wearing this lane's name. It is flagged for the
   captain rather than done quietly.

## Pins

- `__tests__/mapVenueKindFilter.test.ts` - the counting policy, the closed
  control, the reset, the 641 to 900px label rule.
- `__tests__/mapChromeOneBar.test.ts` - one home per viewport, no floating band.
- `__tests__/mapSurfaceAlignment.test.ts` - the chips claim no map surface.
- `e2e/map-desktop-filters.spec.ts` - 768 and 1440: chips absent from the head,
  present in the opened popover, the badge count, the state round trip, Escape
  returning focus; 390: the phone is exactly as it was.
- `e2e/desktop-map-rail.spec.ts` - the rendered chip geometry, now measured
  inside the popover.
