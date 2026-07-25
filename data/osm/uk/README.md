# UK-wide OSM pub seed packs

Every `amenity=pub` node/way in the United Kingdom (Great Britain + Northern
Ireland), pulled from Overpass in grid chunks. These are **data packs only** —
nothing here is wired into the app. The queued runtime wave consumes them (see
[Consuming these packs](#consuming-these-packs)).

Prices are **not** taken from OSM. Everything in these packs is venue presence
and metadata; pint prices come from Pint Drops and the curated London datasets.

## Layout

```
data/osm/uk/
  raw/chunk_lat<south>_lon<west>.json   # raw Overpass response, one per grid cell
  chunks.json                           # grid definition + per-chunk element counts
  uk_osm_pubs.json                      # normalized pack (the thing to consume)
  dedupe_report.json                    # overlap vs curated London + city packs
```

`raw/` and `uk_osm_pubs.json` are written compact (no indentation) on purpose:
the pull is ~45k elements over ~130 files, and pretty-printing multiplies what
the repo carries for no readability gain on a machine-generated dump. The two
small summary files stay pretty-printed.

## Refresh

```bash
npm run fetch:uk-pubs                       # full pull; resumes automatically
npm run fetch:uk-pubs -- --refresh          # refetch every chunk from scratch
npm run fetch:uk-pubs -- --chunk=lat51.00_lon-1.00
npm run fetch:uk-pubs -- --from-raw         # re-normalize on-disk chunks, no network
npm run fetch:uk-pubs -- --list             # print the grid and exit
```

A plain `npm run fetch:uk-pubs` is the one command that produces or refreshes the
whole dataset. It **resumes by default**: any chunk that already has a raw file is
skipped, so an interrupted or rate-limited run is restarted by rerunning it.
`--refresh` is the opt-in that ignores what is on disk.

Overpass etiquette matches `scripts/fetch_city_osm_pubs.mjs`: one request at a
time, 5s between chunks (`--delay-ms=`), two endpoints, 5 attempts with
exponential backoff on 429/502/503/504. A full cold pull takes roughly an hour.

## How the query is chunked

`scripts/lib/ukOsmSeed.mjs` tiles the UK bbox `[49.8, -8.7, 61.0, 1.9]` into a
1° × 1° grid — 132 cells — so no single request carries the whole country.
Steps are tunable (`--lat-step=`, `--lon-step=`) if a cell ever gets too heavy.

Each cell's query is clipped to the UK **area** (OSM relation 62149) as well as
the bbox. The area filter is what keeps the Republic of Ireland, the Isle of Man
and the Channel Islands out of border cells — a bbox alone cannot separate
Armagh from Monaghan. Cells share edges, and Overpass bboxes are inclusive, so
elements on a shared edge come back twice; normalization dedupes by OSM id.

Taxonomy is `amenity=pub` only (nodes + ways, `out center`). Bars are a London
seed-pack concern (`data/osm/outer_london_osm_pubs.json`) and are deliberately
not pulled here.

## Normalized fields

Same shape as the per-city packs (`data/cities/{city}/osm_pubs.json`) plus:

- `outdoorSeating` — `outdoor_seating=yes` (kept, as in the city packs)
- `smoking` — every `smoking` / `smoking:*` tag **verbatim**, or `null`. A
  possible future smoking filter needs the raw OSM vocabulary (`outside`,
  `isolated`, `separated`, `dedicated_room`, …), not a boolean we would have to
  re-derive from a fresh country-wide pull.
- `postcode`, `operator` — cheap to retain, useful for later matching
- `curatedRef` — present only when the pub already exists in curated or
  previously-seeded data (see below)

## Dedupe report

`dedupe_report.json` counts how much of the UK pack the app already has, against:

| Source | Key |
| --- | --- |
| `curated-london-slim` (`public/data/venues_slim.json`) | name + distance only — curated London carries no OSM ids |
| `outer-london-osm-seed` (`data/osm/outer_london_osm_pubs.json`) | OSM id, else name + distance |
| `city:<city>` (`data/cities/{city}/osm_pubs.json`) | OSM id, else name + distance |

Name matching uses `normalisePubName` from `scripts/lib/venueMatch.mjs` (the
same normalization the price harvesters use) within 150 m — curated coordinates
and OSM coordinates disagree by a building's width, not by a street.

Matched pubs keep a `curatedRef: { source, id, matchType, distanceM }` in
`uk_osm_pubs.json`, so a consumer can drop or defer to the existing record
without recomputing the join.

## Consuming these packs

The runtime wave (slim-index sharding, CityId registry rework, map perf) is
queued separately and touches none of this. When it lands it should:

1. Read `uk_osm_pubs.json` — one file, already OSM-id unique and sorted
   south→north, so a geographic shard is a slice, not a re-sort.
2. Skip or defer every pub carrying `curatedRef`: those venues are already in
   `public/data/venues_slim*.json` or a city pack, and re-adding them would
   double-pin the map. `dedupe_report.json` has the totals for a sanity check.
3. Salt ids per shard the way `data/cities/README.md` describes
   (`venue-mcr-…`), so UK ids never collide with London `venue-…` ids.
4. Keep `cheapestPrice: null`. OSM is not a price source.
5. Re-read `chunks.json` if it needs the grid: `chunkStats[].bbox` bounds every
   raw file, and `missingChunks` must be empty for the pack to be complete.

Enrichment crons (heritage, prices, what's-on) are explicitly **not** wired to
these packs yet.

## Licence / attribution

OpenStreetMap data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
licensed under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/).

When you redistribute or publicly display these packs, keep the ODbL
attribution. Do not claim OSM as a price source.
