# Parallel venue discovery, 4 October 2026

Local evidence only. This is not deployment evidence.

## Coverage, measured

Counts are rows in `public/data/cities/<city>/venues_slim.json` at base commit `0fb8308fa` and after `DEPLOYMENT_VERSION=local npm run build:city-slim`.

| City | Before | After | New venues | Slices complete | Task runs |
| --- | ---: | ---: | ---: | ---: | ---: |
| Birmingham | 295 | 425 | 130 | 91 of 168 | 675 |
| Leeds | 289 | 317 | 28 | 8 of 84 | 110 |
| Glasgow | 293 | 317 | 24 | 4 of 104 | 75 |
| Durham | 30 | 36 | 6 | 0 of 4 | 8 |
| Manchester, Liverpool, Bristol, Bath, Oxford, Cambridge, Llandudno | 1,521 | 1,521 | 0 | 0 of 468 | 0 |

The 188 accepted venues are 100 bars, 30 pubs and 58 restaurants. Every coordinate is a postcode centroid, and every price is null. Sources, quotes and observation dates are in each city's `parallel_venues.json`; slice, rejection and duplicate detail is in `data/parallel-discovery/reports/`.

Of 2,916 researched rows, 2,622 failed acceptance. 1,358 had no verbatim citation from the venue's own site or a venue listing. 938 had quotes that did not state the venue's name, every address part and postcode. 166 lacked drinking evidence, and 160 had a postcode outside the map box. 37 matched an existing OSM, London or other-city venue. Eight earlier discoveries were found again and kept with their original observation date.

## Why coverage stopped

The run fanned out into 828 slices: 207 postcode districts times pubs, bars, cocktail bars and restaurants. After 868 `pro` Task runs, about USD 87, Parallel answered every new run with HTTP 402: `Insufficient credit in account, please check your plan and billing details.` 725 slices stopped there, and seven cities were never reached. The script published only the verified rows of pages that completed.

Resuming needs account credit, then the same command. Checkpoints in the ignored `data-harvest/parallel-venue-discovery/` keep every completed page, so nothing already paid for is run again:

```sh
node scripts/discover_parallel_venues.mjs
```

`data/parallel-discovery/summary.json` totals every Parallel HTTP call in `usage.jsonl`: 2,605 calls, estimated USD 87.15. That includes the first batch's 33 calls, 871 accepted Task creations, 871 result reads and 823 refused creations.

## Checks

- `node scripts/discover_parallel_venues.mjs --check` validates 188 venues in four cities and matches `freshness.json`.
- `npm run validate-data` and `npm run check:freshness` pass.
- `__tests__/parallelVenueSlimLoading.test.ts` loads every city pack that has discoveries through the runtime slim loader. The loader returns every row, with discovered kinds and null prices.

## First-batch browser evidence

These screenshots predate the fan-out. They show first-batch venues, which remain in the packs. Browser checks used `chrome-devtools-axi` with an owned profile outside the repository, against a local production build at `127.0.0.1:3326`. No Google Maps or Places content was read or copied.

- [Birmingham desktop](birmingham-desktop.png), 1440 x 900: `/map/birmingham?q=Society` resolves Society Birmingham and opens its bar sheet.
- [Leeds mobile](leeds-mobile.png), emulated 390 x 844: `/map/leeds?sel=venue-lds-1dzk9eh` opens The Cut & Craft Leeds as a restaurant.
- [Glasgow mobile](glasgow-mobile.png), emulated 390 x 844: `/map/glasgow?sel=venue-glw-1w0v1yx` opens Bossa as a bar.

Those sheets show their sourced addresses and no logged beer price. Food-hygiene responses are existing live product reads, not facts added by discovery.
