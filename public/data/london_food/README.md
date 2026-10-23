# London food pack

`food.json` holds every `food` row of the London venue shards
(`public/data/london_venues/`, see its README) in one file: the fast-food
counters OpenStreetMap tags with alcohol or 24/7 hours. Today that is 46 rows,
41 of them McDonald's, 38 of those inside a London borough. The layer is cut by
a box around Greater London, so the soft drinks page lists only the counters
with a borough.

`food.json` is generated. This README is hand-written and survives rebuilds.
`npm run build:london-venues` writes the pack after every shard publish, and
`npm run build:london-food` writes it on its own from the committed shards.

## Who reads it

A counter is a price target for one lane: a community soft-drink price whose
drinker says it was a Coke Zero or a Diet Coke (`lib/londonFoodPlaces.ts`).
Three readers need to know which `venue-osm-…` ids are counters:

- `/api/price-submit`, which admits a counter's id only when this pack holds it
  (`lib/londonFoodIndex.server.ts`, declared for file tracing as
  `london-food-pack` in `lib/venueIndexTracing.mjs`);
- the map, which opens a counter's sheet for a `?sel=` link
  (`components/map/LondonFoodPlaceSheet.tsx`);
- `/soft-drinks-and-water`, which lists London McDonald's under the Lucia 🐐
  lens.

The rows are a few KB, where the shards they sit in are several MB of cafes, so
all three read this projection rather than the layer.

## What a row may say

A row is the shard tuple, unchanged, then a borough:
`[osmRef, name, address, lat, lng, kind, borough]`, with `kind` always `food`.
No price, no band and no opening claim. `isPubVenueKind("food")` is false, so a
counter's price reaches no pint band, pin colour, cheapest bucket or Pint Index.
`__tests__/londonFoodPack.test.ts` holds the committed pack to the committed
shards.

## Why only 46

The UK venue extract takes `amenity=fast_food` only where OSM states alcohol or
24/7 hours (`late_fast_food` in `scripts/lib/ukOsmVenueSeed.mjs`), so a
McDonald's that closes at night is not in the shards and cannot be here. Taking
every McDonald's needs a new taxonomy row and a fresh Overpass fetch, which is a
source decision, not a rebuild.

## Attribution

OSM data is © OpenStreetMap contributors, ODbL 1.0.
