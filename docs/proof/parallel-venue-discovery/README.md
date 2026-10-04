# Parallel venue discovery, 4 October 2026

Local evidence only. This is not deployment evidence.

## Coverage, measured

Counts are rows in `public/data/cities/<city>/venues_slim.json` at base commit `0fb8308fa` and after `DEPLOYMENT_VERSION=local npm run build:city-slim`. Slices complete counts slices whose every source was read, refused, gone, or skipped for an unreachable robots file.

| City | Before | After | New venues | Slices complete | Slices with a skip | Parallel Task runs | Tavily searches | Pages taken up |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Birmingham | 295 | 425 | 130 | 166 of 168 | 12 | 675 | 155 | 630 |
| Leeds | 289 | 315 | 26 | 83 of 84 | 4 | 110 | 141 | 531 |
| Glasgow | 293 | 317 | 24 | 104 of 104 | 5 | 75 | 218 | 954 |
| Manchester | 544 | 581 | 37 | 195 of 208 | 16 | 0 | 378 | 1,109 |
| Durham | 30 | 38 | 8 | 4 of 4 | 0 | 8 | 7 | 38 |
| Liverpool | 406 | 430 | 24 | 131 of 140 | 13 | 0 | 247 | 657 |
| Bristol | 269 | 274 | 5 | 51 of 56 | 4 | 0 | 110 | 417 |
| Bath | 68 | 71 | 3 | 7 of 8 | 1 | 0 | 18 | 109 |
| Oxford | 97 | 106 | 9 | 15 of 16 | 1 | 0 | 31 | 140 |
| Cambridge | 81 | 85 | 4 | 15 of 20 | 2 | 0 | 45 | 185 |
| Llandudno | 56 | 56 | 0 | 19 of 20 | 0 | 0 | 27 | 44 |

Pages taken up counts every ranked URL a slice considered, including refusals, skips and stored reads. The 270 accepted venues are 113 pubs, 99 bars and 58 restaurants: 185 from Parallel and 85 from Tavily. Every coordinate is a postcode centroid, and every price is null. Sources, quotes and observation dates are in each city's `parallel_venues.json`; slice, rejection and duplicate detail is in `data/parallel-discovery/reports/`.

Of 3,261 researched rows, 1,356 had no verbatim citation from the venue's own site or a venue listing, 937 had no quote stating the venue's name, every address part and postcode, 212 had a postcode outside the map box and 184 lacked drinking evidence outside the venue's own name. 920 ranked pages were not read: robots refused them, they were gone, or they landed outside the source fence.

This round withdrew 14 stored rows whose only drinking word was in their name: O'Mahoney's Bar & Grill, Pushkar Cocktail Bar & Dining and The Asylum Bar and Venue (Birmingham, Parallel), Boom Battle Bar Leeds and Inkwell Bar (Leeds, Parallel), ATOMECA Wine Bar, Fuzion Noodle Bar, Studio Bar and The Lowry Bar & Kitchen (Manchester), 19Twenty Bar & Grill (Durham), Mexican Bar & Grill (Liverpool), Industry Bar & Kitchen and Westbury Park Pub & Kitchen (Bristol) and The Champagne Bar at Abbey Hotel Bath. Manchester Union Brewery Tap was added from a page read at Extract's advanced depth. Every other accepted row keeps its source URLs and original `observedAt`.

The slim builds were run with `DEPLOYMENT_VERSION=local` and the data validator with `PUBMAX_VERIFY_COMMITTED_DATA=1`. London's slim index and Llandudno's pack are byte-identical to base, and every manifest says `local`. Earlier rounds lost that because `npm run validate-data` rebuilds the packs through `scripts/prevalidate-data.mjs`, which stamps the HEAD commit when no revision is set.

## Skipped sources

60 sources across 58 slices were skipped because their robots.txt could not be reached after two retries: 55 unreachable (timeout or DNS), 3 answering 429 and 2 answering 500. Robots was never assumed to allow, and nothing was read from them. `data/parallel-discovery/skips.json` lists each with its city, district, category, URL, reason and the evidence of every attempt. By host: `www.beerintheevening.com` 27, `www.datathistle.com` 4, `themollyhouse.com` 3, `www.thevine.co.uk`, `www.mumtazleeds.co.uk`, `shoplocator.williamhill` and `licensing.bury.gov.uk` 2 each, and 18 others once each.

## Why coverage is not complete

`summary.json` says `allCitiesComplete: false`. Glasgow and Durham are complete. 38 slices in the other nine cities each wait on one page that answers our own status check but that Tavily Extract cannot read at basic or advanced depth ("Failed to fetch url" or "Error fetching content"). Extract gives no cause, so by the recorded rule those reads stay open rather than being settled; each city report lists them under `incompleteSlices`. They are council PDFs, job and care-home search pages, hotel and travel listings and a few venue pages.

Parallel ran out of credit (HTTP 402) after 868 `pro` Task runs, and Firecrawl ran out (HTTP 402) after 109 page reads; neither is called any more. Tavily never refused for credit. Rerunning resumes and spends only on the open reads:

```sh
node scripts/discover_parallel_venues.mjs --provider=tavily
```

`data/parallel-discovery/summary.json` totals every HTTP call in `usage.jsonl` by city and provider: 5,824 calls, estimated USD 108.07. Parallel accounts for USD 87.15, Tavily USD 17.90 (2,238 credits for search and Extract at the pay-as-you-go rate) and Firecrawl USD 3.02 (604 credits at the Hobby top-up rate).

## Checks

- `node scripts/discover_parallel_venues.mjs --check` validates 270 venues in ten cities and matches `freshness.json`.
- `PUBMAX_VERIFY_COMMITTED_DATA=1 npm run validate-data` and `npm run check:freshness` pass.
- `__tests__/parallelVenueSlimLoading.test.ts` loads every city pack that has discoveries through the runtime slim loader, with discovered kinds and null prices. It also holds the shipped packs to the cities `summary.json` reports, and `allCitiesComplete` to every slice of every map.
- `__tests__/webVenueDiscovery.test.ts` reads entries from own sites and CAMRA-style listings, refuses a name paired with another entry's address, concatenated news hosts as own sites, drinking evidence taken only from a name, and list numbers, labels, opening hours and closed entries.
- `__tests__/webSlice.test.ts` drives the real slice with fake I/O: a cached city replays to completion without a call, robots retries twice before a recorded skip, a cause-less Extract failure stays open until advanced depth reads it or the page answers 404, and `--refresh` starts over.

## First-batch browser evidence

These screenshots predate the fan-out. They show first-batch venues, which remain in the packs. Browser checks used `chrome-devtools-axi` with an owned profile outside the repository, against a local production build at `127.0.0.1:3326`. No Google Maps or Places content was read or copied.

- [Birmingham desktop](birmingham-desktop.png), 1440 x 900: `/map/birmingham?q=Society` resolves Society Birmingham and opens its bar sheet.
- [Leeds mobile](leeds-mobile.png), emulated 390 x 844: `/map/leeds?sel=venue-lds-1dzk9eh` opens The Cut & Craft Leeds as a restaurant.
- [Glasgow mobile](glasgow-mobile.png), emulated 390 x 844: `/map/glasgow?sel=venue-glw-1w0v1yx` opens Bossa as a bar.

Those sheets show their sourced addresses and no logged beer price. Food-hygiene responses are existing live product reads, not facts added by discovery.
