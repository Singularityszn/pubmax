# Pint Prices Extract

Source: https://www.pint-prices.com/

Scrape timestamp: `2026-07-03T23:10:47+00:00`

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
- App dataset rows: 3,097
- App dataset columns: 51
- Builder master rows: 17,673
- Pub/location map rows: 1,197
- Scrape errors: 0

## Caveat

Use `pint_prices_app_dataset.csv` as the single app-building file and `borough_pint_prices.csv` as the strict borough truth. At scrape time, Havering, Hillingdon, and Redbridge exposed a large embedded `pubsData` object but no visible leaderboard rows, so the app dataset keeps those raw signals in `boroughs_raw_embedded_site_anomaly` and `data_quality_notes` while `boroughs_visible` and `primary_borough` remain the safer app-facing borough fields.

Run the scraper again with:

```bash
python3 -u scripts/extract_pint_prices.py
python3 scripts/build_app_dataset.py
```
