# UK base-pub shards (generated)

Every `amenity=pub` in the UK that the curated datasets do **not** already
carry, cut into one file per grid cell so the map can stream the layer a
viewport at a time.

**Generated. Do not hand-edit.** `npm run build:uk-base` rebuilds the whole
directory from `data/osm/uk/uk_osm_pubs.json`; it also runs inside `prebuild`
and `prevalidate-data`, so a pack refresh and a CI run both regenerate it.

## What is here

```
manifest.json          # { version, grid, generatedFrom, shards[] }
<lat>_<lon>.json       # one cell: { version, cell, pubs[] }
```

A shard row is a tuple, not an object — `[osmRef, name, address, lat, lng]`.
These bodies are fetched while the user pans, so repeating five keys tens of
thousands of times is paid for in the one place it is felt. The decoder and the
`venue-uk-…` id salting live in [`lib/ukBasePubs.ts`](../../../lib/ukBasePubs.ts);
`__tests__/ukBasePubs.test.ts` pins the shape.

`manifest.json` parses as the same `ShardManifest`
[`lib/slimShards.ts`](../../../lib/slimShards.ts) already defines, so the client
reuses that module's bbox geometry rather than shipping a second copy of the
grid.

## What is deliberately absent

- **Prices.** OSM is not a price source (`data/osm/uk/README.md`). A base pub
  has no price by construction; it is the canvas the community prices in.
- **Pubs the curated index already has.** Every pack entry carrying
  `curatedRef` is dropped at build time, so a deduped pub renders exactly once,
  as its curated pin.

## Budgets

Enforced by both the builder and `scripts/validate-data.mjs`, which also checks
that every pub sits inside its own cell's bbox (a pub outside it would be
invisible rather than loudly broken), that ids are unique, and that no base id
collides with a `venues_slim` id. Current counts and sizes print from
`npm run build:uk-base`.

## Licence / attribution

OpenStreetMap data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
licensed under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/).
The unverified pub sheet carries this attribution in the UI.
