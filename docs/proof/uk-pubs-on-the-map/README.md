# UK pubs and bars on the map

Shots from a local production build (`NEXT_DIST_DIR=.next-prod`, `next start`),
Chrome for Testing headless, cold profile, first-visit cards dismissed the way
`e2e/mobile-map-chrome-fit.spec.ts` dismisses them.

| File | Viewport | What it shows |
| --- | --- | --- |
| `map-390-after.png` | 390 x 844 | `/map` with the base layer streaming. The small ringed dots are unpriced pins: pubs and, from this branch, bars. |
| `map-1440-after.png` | 1440 x 900 | The same layer on the desktop map. |

## What the shots are evidence of

The 38,215 UK pubs were never missing from the repo or from the map. They ship
as `public/data/uk_base` and stream per viewport once the camera passes
`UK_BASE_MIN_ZOOM` (12). What was missing is the 7,190 `amenity=bar` rows that
were harvested into `data/osm/uk/uk_osm_venues_drink.json` in August and never
reached a shard.

Below the zoom gate the layer fetches its manifest and no cells, so a wide
camera shows none of these pins. That is the payload contract, not a defect,
and it is the state a first visit can land in.

Neither kind carries a price. A base pin says "no price yet" by its shape and
never by a colour.

## Numbers

Built layer: 45,405 rows over 617 cells, 3,759.0 KB against a 5,120 KB ceiling,
fattest cell 122.0 KB against a 150 KB per-viewport ceiling. The fattest cell
came DOWN from 134.3 KB, because central London is now cut in four rather than
shipped over budget.

For a 390 x 844 camera at zoom 12 over Soho, padded by `BOUNDS_PAD_RATIO`:
2 cells and 214.4 KB before, 5 cells and 308.3 KB after.
