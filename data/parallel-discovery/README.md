# Parallel venue discovery

This lane discovers missing pubs, bars and restaurants serving alcohol in every city map outside London. It adds presence records, never prices, ratings or opening hours. It is not an exhaustive census of UK hospitality venues.

## Run and resume

Load the provider key in the invoking shell: `PARALLEL_API_KEY` for `--provider=parallel`, the default, `TAVILY_API_KEY` for `--provider=tavily`, or `FIRECRAWL_API_KEY` for `--provider=firecrawl`. A run refuses to start without it, so a keyless replay never records a credential failure as the outcome. The script never reads a key file. Do not copy credentials into this repository.

```sh
node scripts/discover_parallel_venues.mjs --list
node scripts/discover_parallel_venues.mjs
node scripts/discover_parallel_venues.mjs --provider=tavily --cities=manchester,liverpool
node scripts/discover_parallel_venues.mjs --provider=firecrawl
node scripts/discover_parallel_venues.mjs --check
```

Every run replays and reports every city. `--cities` names the cities that may spend, and they run first; the others replay their checkpoints without provider requests, under either provider. `--cities=` replays every city without provider requests or keys. Missing permission records still require robots checks. Parallel pages already paid for always count. A slice the Parallel pages left incomplete replays its cached Tavily lane, and with `--provider=tavily` a selected city finishes it with new Tavily reads; no Parallel request is made. With `--provider=firecrawl` a selected city makes no search and no Parallel request: it asks robots again for each source an earlier run skipped, and reads through Firecrawl each skipped source that robots now permits. Every other page and robots answer replays as recorded, and recorded permission for published evidence is not asked again unless `--recheck-permissions` is passed.

There is no spend cap. Discovery covers every city in `scripts/fetch_city_osm_pubs.mjs`, the cities with a shipped map. A city without a map is refused: its rows would never reach the product.

Cities are queued in descending census resident population order. The priority uses administrative census areas, documented in `scripts/lib/parallelDiscoveryCities.mjs`. Those areas can exceed the map boxes: County Durham, Bath and North East Somerset, and Conwy determine the priority for Durham, Bath and Llandudno respectively. They do not change map boundaries.

Every publication checks evidence from both providers against recorded robots permission. Only permitted excerpts can establish the venue's identity, address and drinking evidence. The script withdraws a row when those excerpts are insufficient. `permissions.json` records each URL, outcome and check time. Permission checks never change `observedAt`.

A spending run checks permission live. Keyless replay reuses recorded permission, matching the Tavily checkpoint rule. `--cities= --recheck-permissions` checks permission live without new provider requests. `--check` refuses a pack whose evidence lacks recorded permission.

## How a city is searched

One research run per city returned a handful of venues, so each city fans out. Its slices are every postcode district that holds a known venue inside the map box, times four categories: pubs, bars, cocktail bars, and restaurants with a bar, wine list, beer or cocktails. Each slice is a [Task API](https://docs.parallel.ai/task-api/task-quickstart) `pro` run with structured output and per-venue citations.

A slice pages. Each further page excludes the venues known in that district plus every name the slice's earlier pages returned. Paging stops when a page names no venue beyond the district's known venues and the slice's earlier pages, whether or not its rows pass acceptance. `--matches` sets the requested venues per page, default 30. `--concurrency` sets how many slices run at once, default 40. [FindAll](https://docs.parallel.ai/findall-api/findall-quickstart) was reviewed; Task supplies address and drinking evidence in one cited operation, and local code controls acceptance and dedupe.

The Tavily lane searches each slice with [Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search), basic depth, up to 20 results with page text, excluding the same refused domains. It reads a result only when it is permitted by `isHarvestableOperatorUrl`, states a postcode in the slice's district, and is either a recognized venue listing or names one postcode only. Robots is asked live per run and its answer is recorded in the slice checkpoint. Page text comes from the search result when Tavily returned it, otherwise from [Tavily Extract](https://docs.tavily.com/documentation/api-reference/endpoint/extract) in batches of 20, and the landed URL is re-asked through `harvestRedirectLanding`. Up to three query variants run per slice, and the slice stops at the first that finds no unread page.

Before anything is read or paid for, a ranked page from a site that cannot describe a venue is filtered and recorded with its reason: public bodies and universities (`.gov.uk`, `.ac.uk`, `.nhs.uk` and similar), postcode and property lookups, care and childcare directories, job boards, transport operators, research indexes and travel aggregators. Venue listings and venues' own sites are never filtered.

Robots is never overridden. A missing robots file (404 or 410) publishes no restriction; a disallow, a 401 or a 403 refuses the source. A robots file that times out, fails DNS, or answers 429 or 5xx is asked twice more, five seconds apart, each time with a fresh checker. A host that answers keeps the checker that reached it, so each later page is judged on that host's own rules. If it still cannot be reached, that source is skipped: nothing is read from it, and the skip is recorded with its slice, host, URL, reason and the evidence of every attempt.

A page Tavily returned no text for is read through Extract at basic depth, and what basic depth cannot read is asked once more at advanced depth. A page neither reads is then asked for its own status. A 404 or 410 settles it as gone, a 401, 403 or 451 as refused and a landing outside the source fence as not ours; otherwise the source is skipped with both Extract errors and the status the page gave, or the fact that it did not answer. A timeout or server error from Tavily itself leaves the slice incomplete, and the next run asks again. Pages that batch already read, and pages that answered 404 or 410, are kept, so the next run does not pay for them again.

The Firecrawl lane reads a page once with [Firecrawl scrape](https://docs.firecrawl.dev/api-reference/endpoint/scrape), markdown of the whole page so a footer address is kept, and a PDF to at most five pages. It uses no stealth proxy and no browser actions. Its answer goes through the same landing fence, settling and skip rules as an Extract read, and a page it cannot read, including a Firecrawl 4xx or 5xx answer, is skipped with the read's error and the page's own status. Rows from a page Firecrawl read say `provider: "tavily-firecrawl"`: Tavily found the page and Firecrawl read it. One run spends at most 200 credits. Each scrape holds its worst case of six credits against that cap, one for the page and one per PDF page, until Firecrawl reports what it used. A 402, a timeout or a rate limit that outlasts the retries leaves the slice incomplete, and the next run asks again. As with Extract, the pages already read are kept.

A slice is complete when every source it ranked was read, settled, filtered or skipped with a reason. Complete with skips is not exhaustive coverage: a skipped source may describe venues the lane never saw, and nothing from it is evidence for any venue. `skips.json` lists every skip with its kind (`robots` or `extract`); each city report lists `filteredSources` and `skippedSources`.

Tavily returns text, not venues, so `pageVenues` reads entries from it without a model. An entry is a name, then the address parts running up to a postcode in the district, with no other postcode between. Its excerpt quotes that whole passage, so one quote binds the name, the street and the postcode. Labels, phone numbers and listing furniture such as CAMRA's category and beer-count lines are skipped. A page counts as a venue's own site only when its title names the venue and its host carries a distinctive word of the name; city names, words under four letters, generic words, and news or aggregator hosts never count. Otherwise only a recognized listing can vouch, so an article naming several bars adds none of them. The host and one-quote rules are checked again for every stored web row.

Task input has a documented 25,000-character limit. `taskRequest` is the one place a request is fitted to it: it adds known venue names until the limit, and says `contextIsPartial` when some were left out. Dedupe still runs against every local venue afterward.

Raw task results, Tavily searches and page reads, the earlier Firecrawl reads, per-slice checkpoints and postcode responses live under the ignored `data-harvest/parallel-venue-discovery/`. Failed runs retain checkpoints, and repeating the same command resumes. A city outside `--cities` replays its stored searches, page text and recorded robots answers and skips without any call; it stays incomplete only where a paid read is still missing. Replayed rows keep their observation dates. `--refresh` starts new research for the selected cities only and reads their pages again; every other city replays.

## Acceptance and publication

Every accepted venue needs:

- An original source URL from its own site or a recognized venue listing, permitted by source policy. Google Maps and Google Places sources are rejected.
- Verbatim evidence found in that venue's own Task citation basis, or in the read page's own text. Parent-list or other-venue citations do not count. A web row needs one quote stating its name, every address part and its postcode, so two listing entries cannot be joined into one venue.
- Quotes stating the venue name, the full postcode and every address part before it, such as `Upstairs` and `1 Lynedoch St`. Only the city's own name may be absent. The build checks this again for every stored row.
- Pub or bar identity, or explicit restaurant alcohol evidence, in quoted words other than the venue's own name. "Fuzion Noodle Bar" or "Smokestack Bar & Grill" says nothing about alcohol, so a row whose only drinking word is in its name is refused, in extraction, in parsing and again for every stored row.
- Coordinates quoted by the source, or a postcode that resolves inside the city's box through [Postcodes.io](https://postcodes.io/).

Research names a pub, bar or restaurant. At publication, `gateVenueEvidence` reads the permitted quotes and `discoveredKind` files a pub or bar row as a `club` (a social, members', sports or services club) when its name carries the word club and either the quotes say so ("This is a club", "club members", "members' bar", "members sailing club", "clubhouse") or a camra.org.uk listing labels it `Club, in <place>`. A name alone never makes a club, so Cosy Club or Junkyard Golf Club keeps its research kind. A restaurant always keeps its kind, because its drinking evidence was judged by the restaurant rule. Stored rows pass the same gate on every run, and a stored club is judged again as the bar it was filed from. The map keeps the `Club` label and shows clubs with the bar glyph, and the Bars filter shows and hides them.

Postcode geocoding is approximate. Rows say `coordinatePrecision: "postcode-centroid"` and keep the geocode URL, quality and observation date. Those coordinates are not building entrances.

Dedupe compares a discovery only with venues a map ships, because a row no map shows cannot make a discovered pub redundant: the national OSM pubs, the drink pack's bars (the rows `scripts/build_uk_base_shards.mjs` ships), every city map's OSM pubs, the London dataset and other cities' discoveries. Food, work and other drink rows still shape the district slices and tell research what is already known. Names must agree under the shared venue identity matcher. The same house number on the same street is one venue within a kilometre, whatever postcode each source gives. The same street where one source gives no number, or the same full postcode, is one venue within 800 metres, a postcode centroid's spread. Otherwise, different numbers on one street or different streets stay separate beyond 100 metres with a postcode centroid (a corner pub can carry two addresses) or 50 metres without; and a match is at most 150 metres for source coordinates, 350 metres with a postcode centroid. Repeats across a city's slices collapse to the first. The city builder dedupes again against city OSM rows with the same rule.

A city's own earlier discoveries are kept with their original observation, and a candidate matching one is reported as `retained`, not as a duplicate. A stored row that no longer passes validation, or that an existing venue now matches, is dropped and listed under `withdrawn` with the reason and the venue it matched; later replays list the matched candidate under `duplicates`. Paid Parallel pages always count: under `--provider=tavily`, `--refresh` restarts only the Tavily lane.

Accepted observations live in `data/cities/<city>/parallel_venues.json`. Each names its `provider`: `parallel`, `tavily`, or `tavily-firecrawl` for a page Firecrawl read. Rows from the first Parallel batch were stored before the field existed; the assembler names them `parallel`, which is the only lane that wrote them, and never invents the `runId` they lack. Later Parallel rows carry the `runId` that found them. OSM files stay separate and keep their own dates and attribution. The city builder merges the two sources, keeps bar, club and restaurant kinds and writes unpriced pins.

```sh
node scripts/discover_parallel_venues.mjs --check
DEPLOYMENT_VERSION=local npm run build:slim
DEPLOYMENT_VERSION=local npm run build:city-slim
npm run build:city-night-areas
PUBMAX_VERIFY_COMMITTED_DATA=1 npm run validate-data
```

`npm run validate-data` and `npm run verify` rebuild the slim packs first through `scripts/prevalidate-data.mjs`, and without `DEPLOYMENT_VERSION` that stamps every pack, London included, with the HEAD commit. Validate the committed packs with `PUBMAX_VERIFY_COMMITTED_DATA=1`, or keep `DEPLOYMENT_VERSION=local` set, so a check never restamps what it checks. Local revision flags above match committed data conventions. They do not prove deployment. The build refuses malformed discovery evidence before writing a city index. Parsing, citation binding, URL policy, district slicing, request fitting, retained-versus-duplicate assembly and venue-kind publication have unit tests in `__tests__/parallelVenueDiscovery.test.ts`. Club classification, and the fence that every committed row carries the kind its evidence gives, are in `__tests__/discoveredVenueKind.test.ts`. Page entry reading, own-site and news-host rules and name-only drinking evidence are in `__tests__/webVenueDiscovery.test.ts`; robots retries and skips, Extract failure settling and call-free replay drive the real slice in `__tests__/webSlice.test.ts`.

`observedAt` dates the research result retrieval, not a verified opening tonight. Cached reruns keep the date. `freshness.json` takes its stamp from the oldest accepted row, and `data/freshness_registry.json` tracks that stamp. New research cannot freshen unchanged older rows.

## Usage and cost

`usage.jsonl` records every Parallel, Tavily and Firecrawl HTTP request, its provider, status, returned usage and approximate USD cost, including failed calls and zero-cost result reads. It contains no headers or credentials. Raw vendor responses stay ignored. `reports/<city>.json` lists each city's slices, task runs, rejected, retained and duplicate candidates. `summary.json` totals the cities and every call in `usage.jsonl`, by city and provider.

Estimates use [Parallel's published pricing](https://docs.parallel.ai/getting-started/pricing), checked 4 October 2026: advanced Search is $0.005 per request including ten results; Task is $0.01 for base, $0.025 for core, $0.10 for pro and $0.30 for ultra. Tavily is costed at its pay-as-you-go $0.008 per credit: one credit per basic search, one per five pages read by basic Extract and two per five at advanced depth. A page basic Extract cannot read is asked once more at advanced depth. Firecrawl is costed at $0.005 per credit, its Hobby top-up rate of 1,000 credits per $5. The first Firecrawl lane used JSON extraction at 5 credits a scrape. The skipped-source lane asks for markdown only, 1 credit a page and 1 per PDF page, and records the credits Firecrawl reports for each scrape. Task reservations are counted at successful creation, so a later failed task can make the estimate exceed the bill. Account invoices remain authoritative.

## Current state

The lane retains 237 venues. On 5 October 2026 a cached replay withdrew Berlinkys (Glasgow) and Adel Tap (Leeds), because the refreshed national OSM pubs now ship them. The permission audit records 234 URLs: 215 permitted, 15 refusals and four unreachable sources. All retained records preserve their original source excerpts and observation dates.

`summary.json` says `allCitiesComplete: true`: every slice of all 11 city maps is complete, 52 of them with skips. That is completion with skips, not exhaustive coverage. The first runs skipped 83 sources, 65 for robots files this network could not reach and 18 that Tavily Extract could not read. On 5 October 2026 the Firecrawl lane asked robots again for the 65. Fourteen now answer 403, so those sources are refused and nothing is read from them. It then read the 18 Extract skips through Firecrawl for 43 credits, 27 of them for one PDF before the five-page limit existed. Fifteen pages were read. None gave a venue that passes acceptance: each candidate lacked a venue-specific citation or was a duplicate. 54 sources stay skipped: 48 whose robots file is still unreachable, three whose robots file answers 429, and three Firecrawl could not read. Many unreachable hosts reset the connection for the `PUBMAXX-harvest/1` user agent while answering others; the lane does not change its user agent, so they stay skipped. `skips.json` lists them all. Parallel is out of credit (HTTP 402) and is no longer called. Measured before and after counts are in [the proof notes](../../docs/proof/parallel-venue-discovery/README.md).
