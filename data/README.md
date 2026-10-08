# Pint Prices Extract

Source: https://www.pint-prices.com/

First full extract: `2026-07-03T23:10:47+00:00`

Last price re-collection: `2026-10-02T11:48:33+00:00`

The machine-readable collection stamp lives in `data/freshness_registry.json`
(the `pint_prices` entry), anchored at noon UTC on the collection's UTC day
(`2026-10-02T12:00:00Z`). `lib/dataFreshness.ts` `PINT_DATASET_OBSERVED_AT` is
derived from it at build time (a drift test pins them together); the export
pipeline rewrites it via `scripts/export_app_dataset_json.py --collected-at
<ISO>`. Both timestamps above are documentation of the raw reads, not
independently-authored sources.

That stamp is the day the DATASET was last collected. It is not the date a pub
shows. Every row carries its own `scraped_at_values`, the instant that row was
last read at its source, and a surface that dates one pub's price dates it by
that row's own read (`legacyPintPriceObservedAt` in `lib/drinks.ts`): a price's
standing ages from that real instant, and each caption prints its London day. A
caption over several prices (the brand pages, the borough FAQ, the tonight and
today pint cards) prints the oldest of their reads, or no day when any of them
records none (`oldestPintRead`). A dataset-level line (the Near Me list caption,
the borough fact block) dates the dataset, never a price. A re-collection
re-dates only the rows its source still states. A row it did not read keeps
the day it was read, and a row that records no read (the outer-London gazetteer
seed, for one) claims no listing and prints no collection day. A shared stamp is
never applied to an unread row.

## Re-collecting the prices

`node scripts/refresh_pint_price_observations.mjs` re-reads the same 32 borough
pages and 932 pub pages the first extract read. For every row the source still
states, it writes the figure the source states and stamps the row's
`scraped_at_values` with the run's instant, whether or not the figure moved. It
can neither add a row nor remove one, so the layered artifact below keeps every
row it holds. The CSV is read against the source by each record's own pub,
address and pint, never by the bundle's `app_price_id`: a later build reassigned
the CSV's ids, so they no longer name the records the bundle's ids name. Then
stamp the registry:

    python3 scripts/export_app_dataset_json.py --collected-at <ISO> --stamp-only

The registry names `export:data -> canonicalize:venues -> build:slim` as the
refresh workflow, and that workflow re-collects nothing: `export:data` re-exports
this same CSV. It is also NOT a safe way to regenerate the bundle on its own,
because `public/data/pint_prices_app_dataset.json` is LAYERED - the outer-London
OSM merge, the Wikipedia London list and the two gazetteer seeds add rows the CSV
does not carry. A plain re-export publishes 2,719 rows over the 3,761 committed
ones, so the export now refuses that loss unless `--allow-row-loss` says it is
intended. The amenity cells stamped from each pub's own website are layered too:
the CSV does not carry them and the row-loss guard cannot see them, so after a
re-export run `npm run harvest:pub-website-amenities -- --restamp`. It stamps
`data/amenities/london_pub_website_evidence.json` back onto the dataset with no
fetch and no model call; the script header owns the details. Pages and quotes
proven chain-wide stay in `data/amenities/london_pub_website_chain_pages.json`,
with every pub that has read each page or stated each quote, so a later
harvest skips those pages, no stamp uses them and a page or quote seen by pubs
on different runs is still proven.

`data/amenities/london_pub_website_hours_dogs.json` holds the dog policy and
opening hours that a pub's own page states. `npm run harvest:pub-website-hours-dogs`
reads the page texts the amenity harvest kept, with no fetch and no model call.
The [Context.dev London harvest](harvest/contextdev-whats-on/README.md) also publishes
opening hours from fresh permitted pages into this same file. Each row keeps the page, the day it
was read and the passage that states each fact. The
[product features](../README.md#features) describe their display.
The [CLI header](../scripts/harvest/pub-website-amenities/hours-and-dogs.mjs)
owns the checkpoint, carry-forward and publication rules.

The 2026-09-04 re-collection read 964 pages with no errors and re-observed 2,624
of the 2,788 priced rows (94.1%); 55 prices had moved. The other 164 priced rows
keep the figures they held: 67 of them (the outer-London gazetteer and OSM rows)
never came from this publisher at all, and the rest are pubs or pints the source
no longer states. That run recorded no per-row read, so the rows it re-read are
dated by what was recorded: the first full extract (`2026-07-03T23:10:47+00:00`)
for a row whose figure did not move, and `2026-09-04T22:16:47+00:00` for the 55
whose figure did.

The 2026-10-02 re-collection read all 32 borough pages and all 932 pub pages
(964 pages) with data, 3,106 distinct pub and pint observations. It re-observed
2,623 of the 2,787 priced rows (94.1%, above the 85% refusal floor) and moved 0
prices. Those 2,623 rows are dated 2 October 2026, among them Bradley's Spanish
Bar (MAHOU £6.00) and the seven pints the Cheshire Cheese's own page lists on
Crutched Friars (LONDON PRIDE £5.90 among them). The other 164 priced rows keep
their older dates: 65
outer-London gazetteer rows, which record no read and print no collection day
(The Harrow Inn among them); 4 outer-London rows priced from the pub's own site
(Boom Battle Bar, Small Beer and Langham Working Mens Club on 18 July 2026,
Tattoo Bar on 21 August 2026); and 95 Pint Prices rows whose pub or pint the run
could not match to a figure the source states today, which keep the first full
extract's instant, `2026-07-03T23:10:47+00:00` (10 past midnight on 4 July in
London, which is the day their captions print). The Cheshire Cheese's HEINEKEN
row, read from a second page, is one of them.
The same run found 55 CSV records holding a figure the source does not state:
the 2026-09-04 run had written its moved prices into the CSV by the bundle's
`app_price_id`, onto the wrong records. Each now holds the figure its own pub
states. The bundled JSON was not affected.

## Files

- `borough_pint_prices.csv`: canonical borough extract from visible borough leaderboard rows. Use this for borough-level analysis.
- `pint_prices_app_dataset.csv`: recommended single CSV for building an app. It dedupes the extracted sources into one row per pub/location/pint/price and folds source coverage, boroughs, pub metadata, amenities, and map coordinates into one table.
- `pint_prices_canonical_enriched.csv`: best single clean dataset for building an app. It contains the canonical borough price rows enriched with pub metadata, amenities, and map coordinates.
- `pint_prices_builder_master.csv`: full source-preserving master CSV. It includes canonical enriched rows, raw embedded map rows, and individual pub-page rows, with source flags.
- `pub_locations_map_data.csv`: pub/location marker dataset for map layers.
- `borough_leaderboard_pint_prices.csv`: same data as `borough_pint_prices.csv`, retained with the source-specific name.
- `borough_embedded_pint_prices.csv`: raw rows from each borough page's embedded `pubsData` object. This includes pub metadata, amenities, coordinates, and pints.
- `pub_page_pint_prices.csv`: rows scraped from the 932 individual pub pages listed in the sitemap.
- `all_pint_prices_combined.csv`: stacked borough and pub-page extracts with a `source_dataset` column.
- `summary_by_borough.csv`: canonical borough row and pub counts.
- `summary.json`: scrape counts, borough metadata, and scrape caveats.
- `borough_embedded_pint_prices.json` and `pub_page_pint_prices.json`: JSON copies of the two richer extracts.

## Counts

- Sitemap URLs: 1,223
- Borough pages: 32
- Pub pages: 932
- Canonical borough price rows: 3,020
- Canonical enriched rows: 3,020
- Pub-page price rows: 2,258
- Combined rows: 5,278
- App dataset rows: 3,085
- App dataset columns: 51
- Builder master rows: 17,673
- Pub/location map rows: 1,197
- Scrape errors: 0

## Caveat

Use `pint_prices_app_dataset.csv` as the single app-building file and `borough_pint_prices.csv` as the strict borough truth. At scrape time, Havering, Hillingdon, and Redbridge exposed a large embedded `pubsData` object but no visible leaderboard rows, so the app dataset keeps those raw signals in `boroughs_raw_embedded_site_anomaly` and `data_quality_notes` while `boroughs_visible` and `primary_borough` remain the safer app-facing borough fields.

`all_pint_prices_combined.csv` (5,278 rows) and
`pub_locations_map_data.csv` (1,197 rows) preserve scraper evidence. Neither is
a product input. The app builder reads the canonical enriched, embedded-price,
and pub-page extracts listed above, then publishes
`pint_prices_app_dataset.csv`. Quarantine entries keep exact `file:line`
`sourceRows` references into preserved price and location evidence. Some
embedded-only price observations never entered `all_pint_prices_combined.csv`,
so their exact price references point to
`borough_embedded_pint_prices.csv`; every quarantined location points to
`pub_locations_map_data.csv`.

## Postcode-coordinate gate

`npm run validate-data` treats a postcode and map point that identify different
areas as contradictory product data. The gate builds robust outward-code
reference points from the committed UK OpenStreetMap pub extract and fails once
a product row is more than 5 km away. That boundary came from the measured
separation in this dataset: correct rows had a 99th percentile of 3.65 km and
ended at 3.87 km, while the first contradiction started at 5.44 km. A
provenance or quality marker never bypasses the gate.

Genuinely odd but verified geography belongs in
`postcode_coordinate_exceptions.json`. An exception must exactly identify the
app price row, name, full postcode and coordinates, and state why evidence
establishes the row despite the distance. Stale, partial, duplicate, reasonless,
or no-longer-contradictory exceptions fail validation.

Unresolved rows belong in `postcode_coordinate_quarantine.json`. Each `rows`
entry names exactly one `appPriceId`, `pubName`, full `postcode`, `latitude`,
`longitude`, and substantive `reason`. `scripts/build_app_dataset.py` assigns
app price IDs before publication decisions, applies evidence-backed
`postcode_coordinate_corrections.json` decisions, validates every quarantine
entry against the complete pre-publication row, then omits the exact row. It
prints one `[postcode-coordinate quarantine]` line with the reason for every
skip. A stale, partial, duplicate, reasonless, identity-mismatched, or
no-longer-contradictory entry stops the build.

Raw scrape files, including `borough_embedded_pint_prices.csv`, remain unchanged
so they continue to record what the source said. Corrections and quarantine are
publication decisions, not rewrites of source evidence. Each successful build
writes `postcode_coordinate_build_report.json`, which fingerprints all raw
inputs and decision registries and records every applied row. `npm run
validate-data` checks those fingerprints and exact dispositions. Editing a
source or registry without rebuilding fails validation instead of silently
dropping or restoring a venue.

Run the scraper again with:

```bash
python3 -u scripts/extract_pint_prices.py
python3 scripts/build_app_dataset.py
```

## Shapes

Six committed files are probed by hand often enough to write down. Paths are from the repo root.

| File | Top-level shape | Fields a row carries | Gotcha |
| --- | --- | --- | --- |
| `public/data/pint_prices_app_dataset.json` | bare array | `app_price_id`, `pub_name`, `pint_name`, `price_gbp`, `latitude`, `longitude`, `scraped_at_values` | Not `{rows}`, `{venues}` or `{data}`. `price_gbp` is on every row and is null when that row is not priced. Coordinates are `latitude` / `longitude`. |
| `public/data/venues_slim.json` | `{revision, rows, generatedAt}` | `id`, `name`, `lat`, `lng`, `cheapestPrice` | `lat` / `lng`, not `latitude` / `longitude`. |
| `public/data/venues_slim.core.json`, `public/data/venues_slim.cell.*.json`, `public/data/cities/*/venues_slim.json`, `public/data/cities/*/venues_slim.core.json` | `{revision, rows}` | `id`, `name`, `lat`, `lng` | Same row pack as the index, without `generatedAt`. |
| `public/data/venues_slim.manifest.json` | `{version, revision, grid, shards}` | shard: `id`, `core`, `partition`, `url`, `count`, `bbox` | The list is `shards`, not `files` or `cells`. `grid` is the step (`originLat`, `originLon`, `latStep`, `lonStep`), not the cells. A city manifest (`public/data/cities/*/venues_slim.manifest.json`) is `{version, revision, shards}` with no `grid`. |
| `data/osm/uk/chunks.json` | object | `chunkStats` rows: `id`, `bbox`, `elements`, `timestamp` | `chunks` is a count, not an array. The cells are `chunkStats`. There is no `grid` key. |
| `data/coffee_pilot/shoreditch.json` | `{version, area, checkedOn, rows}` | `venueId`, `venueName`, `drink`, `priceGbp`, `sourceUrl`, `observedAt`, `standing` | `rows` may be empty. `drink` is `flat white`, `latte` or `matcha latte`. `standing` is `listed`. No `cheapestPrice`. The map's coffee lane reads it through `lib/coffeePilotLoader.ts` and draws each cafe with its own drinks; no pint surface reads it. |
