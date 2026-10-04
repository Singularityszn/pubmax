# Parallel venue discovery, 4 October 2026

Local evidence only. This is not deployment evidence.

## Coverage, measured

Counts are rows in `public/data/cities/<city>/venues_slim.json` at base commit `0fb8308fa` and after `npm run build:city-slim`.

| City | Before | After | New venues | Slices complete | Parallel Task runs | Tavily searches | Pages read |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Birmingham | 295 | 425 | 130 | 91 of 168 | 675 | 0 | 0 |
| Leeds | 289 | 317 | 28 | 8 of 84 | 110 | 0 | 0 |
| Glasgow | 293 | 317 | 24 | 4 of 104 | 75 | 0 | 0 |
| Manchester | 544 | 546 | 2 | 107 of 208 | 0 | 229 | 280 |
| Durham | 30 | 38 | 8 | 0 of 4 | 8 | 0 | 0 |
| Liverpool | 406 | 406 | 0 | 71 of 140 | 0 | 141 | 76 |
| Bristol | 269 | 269 | 0 | 23 of 56 | 0 | 56 | 35 |
| Bath | 68 | 68 | 0 | 2 of 8 | 0 | 8 | 8 |
| Oxford | 97 | 97 | 0 | 7 of 16 | 0 | 16 | 12 |
| Cambridge | 81 | 81 | 0 | 6 of 20 | 0 | 20 | 14 |
| Llandudno | 56 | 56 | 0 | 16 of 20 | 0 | 20 | 5 |

Pages read counts every URL a slice took up, including cached reads and pages refused by robots. The 192 accepted venues are 104 bars, 30 pubs and 58 restaurants. Every coordinate is a postcode centroid, and every price is null. Sources, quotes and observation dates are in each city's `parallel_venues.json`; slice, rejection and duplicate detail is in `data/parallel-discovery/reports/`.

Of 3,408 researched rows, most failed acceptance: 1,707 had no verbatim citation from the venue's own site or a venue listing, 951 had quotes that did not state the venue's name, every address part and postcode, 182 lacked drinking evidence, 164 had a postcode outside the map box and 105 had no geocodable address. 66 pages were not read, most because robots refused `FirecrawlAgent`.

Manchester's first replay held eight web rows. Six came from articles (a football blog, a wine blog, a culture guide and a travel aggregator) whose extracted `website` was the article itself. The extractor's own-site claim is now replaced: a page counts as a venue's own site only when its host carries a distinctive word of the venue's name. Those six rows are gone; BOX Deansgate (its own site) and ATOMECA Wine Bar (SquareMeal) remain.

## Why coverage stopped

No city is complete; `summary.json` says `allCitiesComplete: false`.

- Parallel: 868 `pro` Task runs, about USD 87, then HTTP 402 `Insufficient credit in account` on every new run.
- Firecrawl: the plan's monthly credit ran out after 109 page reads (604 credits), then HTTP 402.
- Tavily: 490 basic searches, every slice of the seven cities Parallel never reached. Their results are cached, so a resumed run reads their pages without searching again.

Resuming needs Firecrawl or Parallel credit, then:

```sh
node scripts/discover_parallel_venues.mjs --provider=tavily-firecrawl
```

`data/parallel-discovery/summary.json` totals every HTTP call in `usage.jsonl` by city and provider: 3,223 calls, estimated USD 94.09. Parallel accounts for USD 87.15, Tavily USD 3.92 (490 credits at the pay-as-you-go rate) and Firecrawl USD 3.02 (604 credits at the Hobby top-up rate).

## Checks

- `node scripts/discover_parallel_venues.mjs --check` validates 192 venues in five cities and matches `freshness.json`.
- `npm run validate-data` and `npm run check:freshness` pass.
- `__tests__/parallelVenueSlimLoading.test.ts` loads every city pack that has discoveries through the runtime slim loader, with discovered kinds and null prices. It also holds the shipped packs to the cities `summary.json` reports, and `allCitiesComplete` to every slice of every map.

## First-batch browser evidence

These screenshots predate the fan-out. They show first-batch venues, which remain in the packs. Browser checks used `chrome-devtools-axi` with an owned profile outside the repository, against a local production build at `127.0.0.1:3326`. No Google Maps or Places content was read or copied.

- [Birmingham desktop](birmingham-desktop.png), 1440 x 900: `/map/birmingham?q=Society` resolves Society Birmingham and opens its bar sheet.
- [Leeds mobile](leeds-mobile.png), emulated 390 x 844: `/map/leeds?sel=venue-lds-1dzk9eh` opens The Cut & Craft Leeds as a restaurant.
- [Glasgow mobile](glasgow-mobile.png), emulated 390 x 844: `/map/glasgow?sel=venue-glw-1w0v1yx` opens Bossa as a bar.

Those sheets show their sourced addresses and no logged beer price. Food-hygiene responses are existing live product reads, not facts added by discovery.
