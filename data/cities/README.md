# UK city OSM venue seed packs

Per-city OpenStreetMap pub extracts seed multi-city maps. Separate [Parallel web discovery observations](../parallel-discovery/README.md) can add evidence-backed pubs, bars, clubs and restaurants. The [pin contract](#what-a-pin-says-it-knows) governs published fields and price evidence.

## Layout

```
data/cities/{city}/
  osm_pubs_raw.json     # raw Overpass response
  osm_pubs.json         # normalized seed pack (ODbL)
  parallel_venues.json  # web discoveries, where a city has any (see ../parallel-discovery)

public/data/cities/{city}/
  venues_slim.json             # complete slim index
  venues_slim.core.json        # compatibility first-read shard
  venues_slim.manifest.json    # shard manifest
```

Which packs ship, and therefore which cities browse, is
`lib/cityVenuePacks.mjs`. Every shipped pack is validated on each build by
`npm run validate-data`. City packs currently use one compatibility core shard;
London uses spatial cells for location-first loading.

## Two ways a pack is made

A pack is either **queried** (its own Overpass request for its bbox) or **promoted** (cut out of the committed UK base snapshot in `data/osm/uk`). `promoteFromUkBase` on the city definition in `scripts/fetch_city_osm_pubs.mjs` decides which, and a promoted pack spends no request at all.

Promote whenever the base layer already carries the area. It takes the SAME rows the base layer holds rather than a second observation that could disagree, it keeps the snapshot's own `fetchedAt` because a promotion looks at nothing new, and it lets `scripts/build_uk_base_shards.mjs` hand each base row to its curated pin by exact OSM id, so no pub is pinned twice. Two OSM objects for one building under one name are collapsed, and every collapse is listed in the pack as `droppedDuplicateObjects`.

## What a pin says it knows

OSM pins take `name`, position and address from OSM. Their area label uses the pub's stated locality (`addr:city` and its siblings), with the pack's display name as the fallback. A pack that covers several towns must not label every pub with the pack's name. Web discoveries retain their cited address and observation date in `parallel_venues.json`. The slim builder publishes their name, position, venue kind and city label. No website or opening hours reaches `venues_slim.json`.

`scripts/build_city_slim_index.mjs` reads recorded prices from `public/data/uk_prices/rows.json`. It matches listed beer rows by exact venue ID and admits pint evidence through `lib/comparablePint.mjs`. A qualifying pub pin carries its recorded pint price, drink label, publisher and date. The builder stores the measure as a pint and the date as a calendar day. A pub without qualifying evidence keeps `cheapestPrice: null`. Bars, clubs and restaurants remain unpriced in this pack. OSM and venue discovery do not supply prices.

A pub without a qualifying recorded pint can carry a separate `estimate` from
the UK price bundle, matched by exact venue ID. This object contains
`priceGbp`, `basis`, `sampleSize` and `computedAt`. It does not populate
`cheapestPrice` or establish a price band. The [sampled UK estimate rules](../../docs/rules/lib-prices-trust-and-drinks.md#sampled-uk-estimates)
own the model and display conditions.

The `city_venue_packs` check in `scripts/validate-data.mjs` enforces the price evidence contract. It also requires the compatibility core to match the canonical pack exactly. `__tests__/citySlimIndex.test.ts` covers both checks.

## Refresh

```bash
# One city
npm run fetch:city-pubs -- --city=manchester
npm run build:city-slim -- --city=manchester

# All enabled cities (Overpass etiquette: one at a time + delay)
npm run fetch:city-pubs
npm run build:city-slim

# Re-normalize from an existing raw dump (no network)
npm run fetch:city-pubs -- --city=manchester --from-raw

# A promoted city needs no flag and no network; it re-cuts from data/osm/uk
npm run fetch:city-pubs -- --city=llandudno

# Skip cities that already have osm_pubs_raw.json
npm run fetch:city-pubs -- --skip-if-present
```

Venue ids are city-salted (`venue-mcr-…`, `venue-glw-…`, …) so they never collide with London `venue-…` ids.

A city venue id is derived from the pub's name, address and point, so an OSM edit can give the same pub a new id. Every `fetch:city-pubs` run records each id it superseded, and each pub that left OSM with no successor as retired, in `public/data/cities/venue_id_aliases.json` (`scripts/lib/cityVenueIdAliases.mjs`). Commit that file with the pack: a stored pint drop, save or crawl stop resolves through it.

## Licence / attribution

OpenStreetMap data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licensed under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/).

When you redistribute or publicly display these packs, keep the ODbL attribution. Do not claim OSM as a price source. See the [pin contract](#what-a-pin-says-it-knows) for city price evidence.
