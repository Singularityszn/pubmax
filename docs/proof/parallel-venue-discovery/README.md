# Parallel venue discovery, 4 October 2026

Local evidence only. This is not deployment evidence.

## Coverage, measured

Counts are rows in `public/data/cities/<city>/venues_slim.json` at base commit `31c92e2a9` and after `DEPLOYMENT_VERSION=local npm run build:city-slim`. A slice is complete when every source it ranked was read, settled as gone or refused, filtered as a non-venue site, or skipped with a reason. Complete with skips is not exhaustive coverage.

| City | Before | After | New venues | Slices complete | Slices with a skip | Robots skips | Extract skips | Filtered pages | Parallel Task runs | Tavily searches |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Birmingham | 295 | 411 | 116 | 168 of 168 | 14 | 15 | 0 | 46 | 675 | 156 |
| Leeds | 289 | 314 | 25 | 84 of 84 | 5 | 5 | 1 | 31 | 110 | 141 |
| Glasgow | 293 | 314 | 21 | 104 of 104 | 5 | 5 | 0 | 82 | 75 | 218 |
| Manchester | 544 | 577 | 33 | 208 of 208 | 16 | 17 | 4 | 81 | 0 | 380 |
| Durham | 30 | 38 | 8 | 4 of 4 | 2 | 2 | 0 | 3 | 8 | 7 |
| Liverpool | 406 | 426 | 20 | 140 of 140 | 18 | 14 | 5 | 54 | 0 | 247 |
| Bristol | 269 | 274 | 5 | 56 of 56 | 7 | 3 | 5 | 27 | 0 | 110 |
| Bath | 68 | 70 | 2 | 8 of 8 | 2 | 1 | 1 | 5 | 0 | 18 |
| Oxford | 97 | 102 | 5 | 16 of 16 | 1 | 1 | 0 | 10 | 0 | 31 |
| Cambridge | 81 | 85 | 4 | 20 of 20 | 4 | 2 | 2 | 22 | 0 | 45 |
| Llandudno | 56 | 56 | 0 | 20 of 20 | 0 | 0 | 0 | 4 | 0 | 27 |

`summary.json` says `allCitiesComplete: true`: all 828 slices are complete, 74 of them with at least one skipped source. The 239 accepted venues are 99 pubs, 77 bars, 15 clubs and 48 restaurants: 167 from Parallel and 72 from Tavily. Every coordinate is a postcode centroid, and every price is null. Sources, quotes and observation dates are in each city's `parallel_venues.json`; slice, rejection, duplicate, filter and skip detail is in `data/parallel-discovery/reports/`.

Of 3,265 researched rows, 1,356 had no verbatim citation from the venue's own site or a venue listing, 937 had no quote stating the venue's name, every address part and postcode, 212 had a postcode outside the map box and 185 lacked drinking evidence outside the venue's own name. 871 ranked pages were not read because robots refused them, they were gone or refused, or they landed outside the source fence. 365 ranked pages were filtered before any read: 233 from public bodies and universities, 61 job boards, 45 postcode or property lookups, 18 travel aggregators, 5 transport operators and 3 care directories.

Name stripping now ignores spelling and markup, so two more rows whose only drinking word was in their name were withdrawn: Merlin's Café Bar (Birmingham, quoted as "Merlins Café Bar") and The Bath Distillery Gin Bar (Bath, quoted in markdown bold). Earlier, 14 such rows were withdrawn. Shack (Manchester) was added from a page read in that round; High Street Tavern, read in the same round, was later withdrawn as a duplicate of OSM node/5066958728 (below). Every other accepted row keeps its source URLs and original `observedAt`.

Dedupe now treats the same house number on the same street, the same street where a number is missing, or the same full postcode, as one venue whatever postcode or centroid each source gives. It compares discoveries only with venues a map ships: the national OSM pubs, the drink pack's bars (the rows the UK base layer shows), each city map's OSM pubs and the London dataset. Nine stored discoveries were withdrawn as venues already on the map: Royal Standard and Britannia (Oxford), Kingfisher and Allerton Hall (Liverpool), High Street Tavern, Middleton Archer, Jolly Hatters and Lancashire Fold (Manchester) and Pilgrim Inn (Bristol). Their pins are gone from the slim packs, and each city report lists each one under `duplicates` with the OSM venue it matched.

Apostrophes now join letters before the existing punctuation normalization. Six more stored discoveries matched pubs already on maps and were withdrawn: Nags Head (Manchester), Foghertys (Liverpool), The Butcher's Arms and Cricketer's Arms (Oxford), McDwyers (Birmingham) and Saracens Head (Bath). The five reported pairs failed regression tests before the fix. Tests cover all six real pairs, straight and curly apostrophes, other punctuation, and separate branches at different house numbers. The cached replay completed all 828 slices without keys or provider calls. All 258 retained records are byte-identical to their earlier observations. The usage ledger and all 83 source skips are unchanged.

Four venues had been held back only by OSM rows no map shows, and now ship with their original evidence and observation dates: Velopark Cafe (Manchester, against a food-pack cafe; an earlier round had withdrawn it and wrongly called that row on the map), Beeses Bar & Tea Gardens (Bristol, a food-pack cafe), De La Vies (Birmingham, a drink-pack restaurant row) and Wolf Wine (Bath, a drink-pack `other` row). All were derived by replays that made no provider call; every other accepted row is unchanged.

One likely pair stays unresolved: Sun Inn, 210 Guide Lane, Audenshaw M34 5BR (Manchester, from CAMRA) sits 454 m from OSM node/705944807 "The Sun Inn". That OSM node states no street, postcode, website or phone, so the cached evidence cannot show it is the same building, and the discovery is kept rather than matched on a common name alone.

The slim builds were run with `DEPLOYMENT_VERSION=local` and the data validator with `PUBMAX_VERIFY_COMMITTED_DATA=1`. Measured on the tree handed to this round's commit: London's slim index and Llandudno's pack are byte-identical to base `31c92e2a9`, and the London manifest, core and full index and all 11 city manifests say `local`. `npm run validate-data` without that flag rebuilds the packs through `scripts/prevalidate-data.mjs` and stamps the HEAD commit; that is what restamped earlier commits.

## Review corrections

The final permission audit checked 234 evidence URLs with the same robots gate used by Tavily. It recorded 215 permitted URLs, 15 refusals and four unreachable sources. Seventeen rows lacked sufficient permitted evidence and were withdrawn. `data/parallel-discovery/permissions.json` records the decisions. Each city report names its withdrawals and their blocked sources.

The audit also withdrew Black Lion Hotel in Manchester and Hillfoot Hotel in Liverpool as mapped venue-type name variants. Tests reproduced both duplicates before the fix. Type-word matching requires the same street plus overlapping numbered addresses or matching postcodes. Different numbered branches remain separate. The 350 m centroid tolerance now precedes the exact-coordinate postcode rejection. Tests cover adjacent-postcode centroids and the real Royal Standard pair.

Thirty-one discoveries carried the word club in their name, and every one was filed as a pub, bar or restaurant. `discoveredKind` now files 15 of them as `club`: 14 in Birmingham, such as Ward End Social Club and Olton Mere Sailing Club, and Dunelm Club in Durham. Their quotes say they are members' clubs, or their camra.org.uk listing labels them `Club`. The other 16 keep their kind. Cosy Club Birmingham, The Rectory 180 Club, Arcade Club Leeds, The Erdington Club, Hall Green H.G. Club, Tyseley Working Mens Club, Kings Heath Cricket & Sports Club, Edgbaston Golf Club, Harborne Cricket Club, Oscott Social Club, Aston Manor Cricket Club and Smethwick Labour Club stay bars, because a name alone never makes a club and nothing quoted says club. The Oyster Club and Cosy Club Durham stay restaurants, because a restaurant keeps its kind. Ukrainian Club and Club Faith stay pubs, because CAMRA lists them as pubs. The 15 pins stay on the map with a `Club` label and the bar glyph, and the Bars filter shows and hides them. No row's evidence, address or observation date changed.

The cached replay completed all 828 slices. All 239 retained records are unchanged from the previous commit, except the `kind` field of the 15 rows filed as clubs. The 5,871-call provider ledger and all 83 original source skips are unchanged. This correction has no new live browser evidence.

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

- `node scripts/discover_parallel_venues.mjs --check` validates 239 venues in ten cities and matches `freshness.json`.
- `PUBMAX_VERIFY_COMMITTED_DATA=1 npm run validate-data` and `npm run check:freshness` pass.
- `__tests__/parallelVenueSlimLoading.test.ts` loads every city pack that has discoveries through the runtime slim loader, with discovered kinds and null prices. It also holds the shipped packs to the cities `summary.json` reports, and `allCitiesComplete` to every slice of every map.
- `__tests__/webVenueDiscovery.test.ts` reads entries from own sites and CAMRA-style listings, refuses a name paired with another entry's address, named news brands as own sites while keeping venues such as The Lamp Post, drinking evidence taken only from a name however it is spelled or marked up, non-venue sites, and list numbers, labels, opening hours and closed entries.
- `__tests__/parallelVenueDiscovery.test.ts` matches each of the nine withdrawn discoveries to its OSM venue with the real addresses and coordinates, keeps same-name branches with different street addresses and postcodes apart, and withdraws a stored row an existing venue matches. It also holds the real Velopark Cafe pair through `venueBases`, the split `discover_parallel_venues.mjs` uses: a food, work, restaurant, `other` or hotel lounge row stays in research context but cannot withdraw it, while the same row as a national pub, drink-pack bar or city pub does, and so does a London row.
- `__tests__/discoverRunSlice.test.ts` drives `runSlice` with fake lanes: under the default Parallel provider a city outside `--cities` replays its cached Tavily lane, `--refresh` touches only the selected city, and `--cities=` spends nowhere.
- `__tests__/webSlice.test.ts` drives the real slice with fake I/O: a cached city replays to completion without a call, robots retries twice with fresh checkers before a recorded skip and keeps a recovered host's checker, a page Extract cannot read at either depth is skipped with both errors and its status unless it is gone, non-venue sites are filtered before any read, and `--refresh` starts over.

## Browser gate follow-up

CI on `8ab4ca525` reported a flaky 390 px landing hierarchy test. Its class locator matched two navigation elements during hydration. The retry passed, but the browser gate correctly refused the flaky result.

The test now selects the visible `Primary` navigation and requires exactly one before measuring its box. Its existing overlap and tap assertions remain. The original test passed five local runs, so the captured CI failure is the reproduction evidence. The corrected test passed 30 local production-browser runs with installed Chrome: ten each at 1440 x 900, 390 x 844 and 320 x 568. Retries were disabled. This is focused landing proof, not a repeat of the nine earlier venue journeys.

## First-batch browser evidence

These screenshots predate the fan-out. They show first-batch venues, which remain in the packs. Browser checks used `chrome-devtools-axi` with an owned profile outside the repository, against a local production build at `127.0.0.1:3326`. No Google Maps or Places content was read or copied.

- [Birmingham desktop](birmingham-desktop.png), 1440 x 900: `/map/birmingham?q=Society` resolves Society Birmingham and opens its bar sheet.
- [Leeds mobile](leeds-mobile.png), emulated 390 x 844: `/map/leeds?sel=venue-lds-1dzk9eh` opens The Cut & Craft Leeds as a restaurant.
- [Glasgow mobile](glasgow-mobile.png), emulated 390 x 844: `/map/glasgow?sel=venue-glw-1w0v1yx` opens Bossa as a bar.

Those sheets show their sourced addresses and no logged beer price. Food-hygiene responses are existing live product reads, not facts added by discovery.
