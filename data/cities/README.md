# UK city OSM venue seed packs

Per-city OpenStreetMap pub extracts used to seed multi-city maps. Prices are **not** taken from OSM — `cheapestPrice` stays `null` until Pint Drops (community prices) fill them in.

## Layout

```
data/cities/{city}/
  osm_pubs_raw.json   # raw Overpass response
  osm_pubs.json       # normalized seed pack (ODbL)

public/data/cities/{city}/
  venues_slim.json    # slim map index (id, name, lat, lng, cheapestPrice: null, …)
```

Enabled cities: Manchester, Liverpool, Oxford, Durham, Glasgow, Bristol, Cambridge, Bath.

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

# Skip cities that already have osm_pubs_raw.json
npm run fetch:city-pubs -- --skip-if-present
```

Venue ids are city-salted (`venue-mcr-…`, `venue-glw-…`, …) so they never collide with London `venue-…` ids.

## Licence / attribution

OpenStreetMap data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licensed under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/).

When you redistribute or publicly display these packs, keep the ODbL attribution. Do not claim OSM as a price source — pint prices on PubMaxing come from Pint Drops and curated London datasets, not from OpenStreetMap.
