# London restaurant pack

`restaurants.json` holds every `restaurant` row of the London venue shards
(`public/data/london_venues/`, see its README) in one file. The map reads it to
draw London restaurants that serve alcohol as fork pins from zoom 12
(`lib/londonRestaurants.ts`).

`restaurants.json` is generated. This README is hand-written and survives
rebuilds. `npm run build:london-venues` writes the pack after every shard
publish, and `npm run build:london-restaurants` writes it on its own from the
committed shards.

## Why one file

A phone at zoom 12 over central London covers about 48 shard cells once the
read is padded, and those cells are mostly cafes. Reading them to draw the
restaurants would cost well over a megabyte. The restaurants alone are about
118 KB, or 37 KB on the wire, so the map reads them in one request, once, after
the priced pins have painted.

## Why its own directory

The shard publisher deletes every `*.json` in its own root that is not
`manifest.json`, so a pack written beside the shards would be removed by the
next build. The desk pack (`public/data/london_desks/`) lives apart for the same
reason.

## What a row may say

A row is the shard tuple, unchanged, then a borough:
`[osmRef, name, address, lat, lng, kind, borough]`, with `kind` always
`restaurant`. The borough is the London borough polygon the point falls in, by
the lookup that places curated pins (`scripts/lib/boroughFromPoint.mjs`), or ""
outside every borough. Map search matches it, as it matches a curated pin's
borough. A search for an area no row names, such as Soho or Shoreditch, keeps
the restaurants within 400 m of a curated pin whose address or borough names
it (`lib/londonRestaurants.ts`), so the pack carries no neighbourhood column.
`layer` names the shard generation the pack was cut from.
`__tests__/londonRestaurantPack.test.ts` holds the committed pack to the
committed shards and to every restaurant in
`data/london_restaurant_drinks/evidence.json`.

A restaurant is on the layer only when it serves alcohol: OpenStreetMap tags it
with a bar or alcohol, or its own website says so. No row carries a price, a
band or an opening claim.

## Attribution

OSM data is © OpenStreetMap contributors, ODbL 1.0. The map carries the credit
(`OSM_ATTRIBUTION` in `components/map/canvas/tokens.ts`), and the restaurant
sheet credits it again (`components/map/LondonRestaurantSheet.tsx`).
