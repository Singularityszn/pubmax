# Parallel venue discovery, 4 October 2026

Local evidence only. This is not deployment evidence.

## Coverage, measured

Counts are rows in `public/data/cities/<city>/venues_slim.json` at base commit `0fb8308fa` and after `DEPLOYMENT_VERSION=local npm run build:city-slim`. A slice is complete when every source it ranked was read, settled as gone or refused, filtered as a non-venue site, or skipped with a reason. Complete with skips is not exhaustive coverage.

| City | Before | After | New venues | Slices complete | Slices with a skip | Robots skips | Extract skips | Filtered pages | Parallel Task runs | Tavily searches |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Birmingham | 295 | 424 | 129 | 168 of 168 | 14 | 15 | 0 | 46 | 675 | 156 |
| Leeds | 289 | 315 | 26 | 84 of 84 | 5 | 5 | 1 | 31 | 110 | 141 |
| Glasgow | 293 | 317 | 24 | 104 of 104 | 5 | 5 | 0 | 82 | 75 | 218 |
| Manchester | 544 | 583 | 39 | 208 of 208 | 16 | 17 | 4 | 81 | 0 | 380 |
| Durham | 30 | 38 | 8 | 4 of 4 | 2 | 2 | 0 | 3 | 8 | 7 |
| Liverpool | 406 | 430 | 24 | 140 of 140 | 18 | 14 | 5 | 54 | 0 | 247 |
| Bristol | 269 | 274 | 5 | 56 of 56 | 7 | 3 | 5 | 27 | 0 | 110 |
| Bath | 68 | 70 | 2 | 8 of 8 | 2 | 1 | 1 | 5 | 0 | 18 |
| Oxford | 97 | 106 | 9 | 16 of 16 | 1 | 1 | 0 | 10 | 0 | 31 |
| Cambridge | 81 | 85 | 4 | 20 of 20 | 4 | 2 | 2 | 22 | 0 | 45 |
| Llandudno | 56 | 56 | 0 | 20 of 20 | 0 | 0 | 0 | 4 | 0 | 27 |

`summary.json` says `allCitiesComplete: true`: all 828 slices are complete, 74 of them with at least one skipped source. The 270 accepted venues are 115 pubs, 97 bars and 58 restaurants: 184 from Parallel and 86 from Tavily. Every coordinate is a postcode centroid, and every price is null. Sources, quotes and observation dates are in each city's `parallel_venues.json`; slice, rejection, duplicate, filter and skip detail is in `data/parallel-discovery/reports/`.

Of 3,265 researched rows, 1,356 had no verbatim citation from the venue's own site or a venue listing, 937 had no quote stating the venue's name, every address part and postcode, 212 had a postcode outside the map box and 185 lacked drinking evidence outside the venue's own name. 871 ranked pages were not read because robots refused them, they were gone or refused, or they landed outside the source fence. 367 ranked pages were filtered before any read: 233 from public bodies and universities, 61 job boards, 45 postcode or property lookups, 18 travel aggregators, 5 transport operators and 3 care directories.

Name stripping now ignores spelling and markup, so two more rows whose only drinking word was in their name were withdrawn: Merlin's Café Bar (Birmingham, quoted as "Merlins Café Bar") and The Bath Distillery Gin Bar (Bath, quoted in markdown bold). Earlier, 14 such rows were withdrawn. High Street Tavern and Shack (Manchester) were added from pages read this round. Every other accepted row keeps its source URLs and original `observedAt`.

The slim builds were run with `DEPLOYMENT_VERSION=local` and the data validator with `PUBMAX_VERIFY_COMMITTED_DATA=1`. In this worktree, London's slim index and Llandudno's pack are byte-identical to base and all 14 manifests say `local`. `npm run validate-data` without that flag rebuilds the packs through `scripts/prevalidate-data.mjs` and stamps the HEAD commit; that is what restamped earlier commits.

## Skipped sources

83 sources across 74 slices were skipped. Nothing was read from them, and none is evidence for any venue. `data/parallel-discovery/skips.json` lists each with its city, district, category, URL, kind, reason and the evidence of every attempt.

65 are robots skips: the robots file could not be reached on the first ask and two retries with fresh checkers, 62 unreachable (timeout or DNS) and 3 answering 429. Robots was never assumed to allow. By host: `www.beerintheevening.com` 27, `www.theheadofsteam.co.uk` 12, `www.datathistle.com` 4, `themollyhouse.com` 3, `www.thevine.co.uk` and `shoplocator.williamhill` 2 each, and 15 others once each.

18 are Extract skips: Tavily Extract failed at basic and advanced depth, and the page's own status did not settle it as gone or refused.

- leeds LS5/restaurant: `https://mindtrip.ai/restaurant/leeds-yorkshire/vesper-gate/re-Suu6nUAJ`. Tavily Extract failed at basic and advanced depth; the page answered HTTP 200.
- manchester M1/bar: `https://www.marriott.com/en-us/dining/restaurant-bar/manmp-manchester-marriott-hotel-piccadilly/7113311-loom-and-ladle-bar-bistro.mi`. Tavily Extract failed at basic and advanced depth; the page answered HTTP 200.
- manchester M4/pub: `https://marblebeers.com/the-marble-arch`. Tavily Extract failed at basic and advanced depth; the page answered HTTP 200.
- manchester M17/cocktail-bar: `https://www.iwm.org.uk/sites/default/files/files/2019-02/Summer%20party%20package_2019.pdf`. Tavily Extract failed at basic and advanced depth; the page answered HTTP 200.
- manchester SK3/pub: `https://www.almond-pubs.co.uk/pubs/the-jolly-sailor`. Tavily Extract failed at basic and advanced depth; the page answered HTTP 200.
- liverpool CH41/restaurant: `https://theguideliverpool.com/the-ultimate-guide-to-the-wirral-food-drink-festival-2019`. Tavily Extract failed at basic and advanced depth; the page answered HTTP 200.
- liverpool L15/restaurant: `https://mindtrip.ai/attraction/liverpool-merseyside/brookhouse/at-Sm6z6jDJ`. Tavily Extract failed at basic and advanced depth; the page answered HTTP 200.
- liverpool L33/bar: `https://popeyesuk.com/restaurants)wird`. Tavily Extract failed at basic and advanced depth; the page answered HTTP 200.
- liverpool L33/restaurant: `https://theguideliverpool.com/directory_category/drink/page/14`. Tavily Extract failed at basic and advanced depth; the page answered HTTP 200.
- liverpool L69/cocktail-bar: `https://bishopsgate-inst.files.svdcdn.com/production/Pride-1991_compressed.pdf?dm=1656076637`. Tavily Extract failed at basic and advanced depth; the page answered HTTP 200.
- bristol BS6/pub: `https://hmssbristol.com`. Tavily Extract failed at basic and advanced depth; the page answered HTTP 200.
- bristol BS6/cocktail-bar: `https://filthyxiii.com`. Tavily Extract failed at basic and advanced depth; the page answered HTTP 200.
- bristol BS8/cocktail-bar: `https://www.alteregobar.co.uk/contact-us`. Tavily Extract failed at basic and advanced depth; the page did not answer.
- bristol BS8/cocktail-bar: `https://hmssbristol.com`. Tavily Extract failed at basic and advanced depth; the page answered HTTP 200.
- bristol BS10/cocktail-bar: `https://www.myvue.com/cinema/bristol-cribbs-causeway/whats-on`. Tavily Extract failed at basic and advanced depth; the page answered HTTP 200.
- bath BA1/bar: `https://bills-website.co.uk/restaurants/bath`. Tavily Extract failed at basic and advanced depth; the page answered HTTP 307.
- cambridge CB2/cocktail-bar: `https://bills-website.co.uk/restaurants/cambridge`. Tavily Extract failed at basic and advanced depth; the page answered HTTP 307.
- cambridge CB5/bar: `https://cipr.co.uk/CIPR/CIPR/Events/Event_Display_Groups.aspx?EventKey=EA22071403`. Tavily Extract failed at basic and advanced depth; the page answered HTTP 200.

## Credit and cost

Parallel ran out of credit (HTTP 402) after 868 `pro` Task runs, and Firecrawl ran out (HTTP 402) after 109 page reads; neither is called any more. Tavily never refused for credit. `data/parallel-discovery/summary.json` totals every HTTP call in `usage.jsonl` by city and provider: 5,871 calls, estimated USD 108.19. Parallel accounts for USD 87.15, Tavily USD 18.02 (2,252 credits for search and Extract at the pay-as-you-go rate) and Firecrawl USD 3.02 (604 credits at the Hobby top-up rate).

## Checks

- `node scripts/discover_parallel_venues.mjs --check` validates 270 venues in ten cities and matches `freshness.json`.
- `PUBMAX_VERIFY_COMMITTED_DATA=1 npm run validate-data` and `npm run check:freshness` pass.
- `__tests__/parallelVenueSlimLoading.test.ts` loads every city pack that has discoveries through the runtime slim loader, with discovered kinds and null prices. It also holds the shipped packs to the cities `summary.json` reports, and `allCitiesComplete` to every slice of every map.
- `__tests__/webVenueDiscovery.test.ts` reads entries from own sites and CAMRA-style listings, refuses a name paired with another entry's address, named news brands as own sites while keeping venues such as The Lamp Post, drinking evidence taken only from a name however it is spelled or marked up, non-venue sites, and list numbers, labels, opening hours and closed entries.
- `__tests__/webSlice.test.ts` drives the real slice with fake I/O: a cached city replays to completion without a call, robots retries twice with fresh checkers before a recorded skip and keeps a recovered host's checker, a page Extract cannot read at either depth is skipped with both errors and its status unless it is gone, non-venue sites are filtered before any read, and `--refresh` starts over.

## First-batch browser evidence

These screenshots predate the fan-out. They show first-batch venues, which remain in the packs. Browser checks used `chrome-devtools-axi` with an owned profile outside the repository, against a local production build at `127.0.0.1:3326`. No Google Maps or Places content was read or copied.

- [Birmingham desktop](birmingham-desktop.png), 1440 x 900: `/map/birmingham?q=Society` resolves Society Birmingham and opens its bar sheet.
- [Leeds mobile](leeds-mobile.png), emulated 390 x 844: `/map/leeds?sel=venue-lds-1dzk9eh` opens The Cut & Craft Leeds as a restaurant.
- [Glasgow mobile](glasgow-mobile.png), emulated 390 x 844: `/map/glasgow?sel=venue-glw-1w0v1yx` opens Bossa as a bar.

Those sheets show their sourced addresses and no logged beer price. Food-hygiene responses are existing live product reads, not facts added by discovery.
