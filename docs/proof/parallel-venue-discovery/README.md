# Parallel venue discovery, 4 October 2026

Local evidence only. This is not deployment evidence.

## Coverage, measured

Counts are rows in `public/data/cities/<city>/venues_slim.json` at base commit `0fb8308fa` and after `DEPLOYMENT_VERSION=local npm run build:city-slim`.

| City | Before | After | New venues | Slices complete | Parallel Task runs | Tavily searches | Pages taken up |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Birmingham | 295 | 428 | 133 | 154 of 168 | 675 | 135 | 559 |
| Leeds | 289 | 317 | 28 | 80 of 84 | 110 | 140 | 503 |
| Glasgow | 293 | 317 | 24 | 99 of 104 | 75 | 215 | 948 |
| Manchester | 544 | 584 | 40 | 192 of 208 | 0 | 361 | 1,053 |
| Durham | 30 | 39 | 9 | 2 of 4 | 8 | 7 | 25 |
| Liverpool | 406 | 431 | 25 | 127 of 140 | 0 | 231 | 639 |
| Bristol | 269 | 276 | 7 | 53 of 56 | 0 | 107 | 427 |
| Bath | 68 | 72 | 4 | 7 of 8 | 0 | 17 | 109 |
| Oxford | 97 | 106 | 9 | 16 of 16 | 0 | 31 | 145 |
| Cambridge | 81 | 85 | 4 | 19 of 20 | 0 | 44 | 220 |
| Llandudno | 56 | 56 | 0 | 20 of 20 | 0 | 27 | 47 |

Pages taken up counts every ranked URL a slice considered, including robots refusals and stored reads. The 283 accepted venues are 113 pubs, 111 bars and 59 restaurants. Every coordinate is a postcode centroid, and every price is null. Sources, quotes and observation dates are in each city's `parallel_venues.json`; slice, rejection and duplicate detail is in `data/parallel-discovery/reports/`. London's slim index and every revision stamp match base: only the ten cities that gained venues changed.

Of 3,310 researched rows, 1,356 had no verbatim citation from the venue's own site or a venue listing, 937 had no quote stating the venue's name, every address part and postcode, 215 had a postcode outside the map box and 191 lacked drinking evidence. 1,092 ranked pages were not read: robots refused them, Tavily could not fetch them, or they landed outside the source fence.

The Tavily lane added 92 venues: 82 from CAMRA listings (one on a CAMRA branch site), 3 from DesignMyNight and VisitBath, and 7 from venues' own sites. Parallel rows account for 190. One Firecrawl row, ATOMECA Wine Bar (SquareMeal), passes the corrected rules and stays. BOX Deansgate was withdrawn: `box` is too short to tie theboxbar.co.uk to the venue.

## Why coverage is not complete

`summary.json` says `allCitiesComplete: false`. Oxford and Llandudno are complete. 59 slices in the other nine cities each wait on one or two pages whose robots file this network could not reach, so the rule keeps them incomplete rather than reading those pages or calling the slice done. `curl` gets no answer in 20 seconds from the same hosts. The hosts are `www.beerintheevening.com` (26 slices), `www.theheadofsteam.co.uk` (8), `www.datathistle.com` (4), `www.thevine.co.uk`, `themollyhouse.com` and `licensing.bury.gov.uk` (2 each), and 15 others with one slice each. Each city report lists its incomplete slices and the reason.

Credit is not the limit. Parallel ran out (HTTP 402) after 868 `pro` Task runs, and Firecrawl ran out (HTTP 402) after 109 page reads; neither is called any more. Tavily was still answering when the run settled. Rerunning resumes from the checkpoints and spends only on what is still unread:

```sh
node scripts/discover_parallel_venues.mjs --provider=tavily
```

`data/parallel-discovery/summary.json` totals every HTTP call in `usage.jsonl` by city and provider: 5,034 calls, estimated USD 105.53. Parallel accounts for USD 87.15, Tavily USD 15.36 (1,920 credits for search and Extract at the pay-as-you-go rate) and Firecrawl USD 3.02 (604 credits at the Hobby top-up rate).

## Checks

- `node scripts/discover_parallel_venues.mjs --check` validates 283 venues in ten cities and matches `freshness.json`.
- `npm run validate-data` and `npm run check:freshness` pass.
- `__tests__/parallelVenueSlimLoading.test.ts` loads every city pack that has discoveries through the runtime slim loader, with discovered kinds and null prices. It also holds the shipped packs to the cities `summary.json` reports, and `allCitiesComplete` to every slice of every map.
- `__tests__/webVenueDiscovery.test.ts` reads entries from own sites and CAMRA-style listings, refuses a name paired with another entry's address, news and aggregator hosts as own sites, list numbers, labels, opening hours and closed entries, and settles a page read only when it is gone or refused.

## First-batch browser evidence

These screenshots predate the fan-out. They show first-batch venues, which remain in the packs. Browser checks used `chrome-devtools-axi` with an owned profile outside the repository, against a local production build at `127.0.0.1:3326`. No Google Maps or Places content was read or copied.

- [Birmingham desktop](birmingham-desktop.png), 1440 x 900: `/map/birmingham?q=Society` resolves Society Birmingham and opens its bar sheet.
- [Leeds mobile](leeds-mobile.png), emulated 390 x 844: `/map/leeds?sel=venue-lds-1dzk9eh` opens The Cut & Craft Leeds as a restaurant.
- [Glasgow mobile](glasgow-mobile.png), emulated 390 x 844: `/map/glasgow?sel=venue-glw-1w0v1yx` opens Bossa as a bar.

Those sheets show their sourced addresses and no logged beer price. Food-hygiene responses are existing live product reads, not facts added by discovery.
