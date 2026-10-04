# Parallel venue discovery

This lane discovers missing pubs, bars and restaurants serving alcohol in every city map outside London. It adds presence records, never prices, ratings or opening hours. It is not an exhaustive census of UK hospitality venues.

## Run and resume

Load the provider key in the invoking shell: `PARALLEL_API_KEY` for `--provider=parallel`, the default, or `TAVILY_API_KEY` for `--provider=tavily`. A run refuses to start without it, so a keyless replay never records a credential failure as the outcome. The script never reads a key file. Do not copy credentials into this repository.

```sh
node scripts/discover_parallel_venues.mjs --list
node scripts/discover_parallel_venues.mjs
node scripts/discover_parallel_venues.mjs --provider=tavily --cities=manchester,liverpool
node scripts/discover_parallel_venues.mjs --check
```

Every run replays and reports every city. `--cities` names the cities that may spend, and they run first; the others replay their checkpoints without a request. Parallel pages already paid for always count. With `--provider=tavily` no Parallel request is made, and a slice the Parallel pages left incomplete is finished by Tavily.

There is no spend cap. Discovery covers every city in `scripts/fetch_city_osm_pubs.mjs`, the cities with a shipped map. A city without a map is refused: its rows would never reach the product.

Cities are queued in descending census resident population order. The priority uses administrative census areas, documented in `scripts/lib/parallelDiscoveryCities.mjs`. Those areas can exceed the map boxes: County Durham, Bath and North East Somerset, and Conwy determine the priority for Durham, Bath and Llandudno respectively. They do not change map boundaries.

## How a city is searched

One research run per city returned a handful of venues, so each city fans out. Its slices are every postcode district that holds a known venue inside the map box, times four categories: pubs, bars, cocktail bars, and restaurants with a bar, wine list, beer or cocktails. Each slice is a [Task API](https://docs.parallel.ai/task-api/task-quickstart) `pro` run with structured output and per-venue citations.

A slice pages. Each further page excludes the venues known in that district plus every name the slice's earlier pages returned. Paging stops when a page names no venue beyond the district's known venues and the slice's earlier pages, whether or not its rows pass acceptance. `--matches` sets the requested venues per page, default 30. `--concurrency` sets how many slices run at once, default 40. [FindAll](https://docs.parallel.ai/findall-api/findall-quickstart) was reviewed; Task supplies address and drinking evidence in one cited operation, and local code controls acceptance and dedupe.

The Tavily lane searches each slice with [Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search), basic depth, up to 20 results with page text, excluding the same refused domains. It reads a result only when it is permitted by `isHarvestableOperatorUrl`, states a postcode in the slice's district, and is either a recognized venue listing or names one postcode only. Robots is asked live once per host per run; an unreachable robots file leaves the slice incomplete. Page text comes from the search result when Tavily returned it, otherwise from [Tavily Extract](https://docs.tavily.com/documentation/api-reference/endpoint/extract) in batches of 20, and the landed URL is re-asked through `harvestRedirectLanding`. Up to three query variants run per slice, and the slice stops at the first that finds no unread page.

Only a settled answer is stored: the page text, a refusal by the source fence, or a page that is gone (404 or 410). A timeout, rate limit, server error or failed Extract leaves the slice incomplete, and the next run asks again.

Tavily returns text, not venues, so `pageVenues` reads entries from it without a model. An entry is a name, then the address parts running up to a postcode in the district, with no other postcode between. Its excerpt quotes that whole passage, so one quote binds the name, the street and the postcode. Labels, phone numbers and listing furniture such as CAMRA's category and beer-count lines are skipped. A page counts as a venue's own site only when its title names the venue and its host carries a distinctive word of the name; city names, words under four letters, generic words, and news or aggregator hosts never count. Otherwise only a recognized listing can vouch, so an article naming several bars adds none of them. The host and one-quote rules are checked again for every stored web row.

Task input has a documented 25,000-character limit. `taskRequest` is the one place a request is fitted to it: it adds known venue names until the limit, and says `contextIsPartial` when some were left out. Dedupe still runs against every local venue afterward.

Raw task results, Tavily searches and page reads, the earlier Firecrawl reads, per-slice checkpoints and postcode responses live under the ignored `data-harvest/parallel-venue-discovery/`. Failed runs retain checkpoints, and repeating the same command resumes. Completed cached runs replay without a key and keep their observation dates. `--refresh` starts new research for the selected cities.

## Acceptance and publication

Every accepted venue needs:

- An original source URL from its own site or a recognized venue listing, permitted by source policy. Google Maps and Google Places sources are rejected.
- Verbatim evidence found in that venue's own Task citation basis, or in the read page's own text. Parent-list or other-venue citations do not count. A web row needs one quote stating its name, every address part and its postcode, so two listing entries cannot be joined into one venue.
- Quotes stating the venue name, the full postcode and every address part before it, such as `Upstairs` and `1 Lynedoch St`. Only the city's own name may be absent. The build checks this again for every stored row.
- Pub or bar identity, or explicit restaurant alcohol evidence.
- Coordinates quoted by the source, or a postcode that resolves inside the city's box through [Postcodes.io](https://postcodes.io/).

Postcode geocoding is approximate. Rows say `coordinatePrecision: "postcode-centroid"` and keep the geocode URL, quality and observation date. Those coordinates are not building entrances.

Dedupe reads the national OSM pub, drink, food and work packs, the city OSM packs, London data and other cities' discoveries. Name matching uses the shared venue identity matcher. Distance is at most 150 metres for source coordinates, 350 metres when a postcode centroid takes part. Different postcodes stay separate beyond 50 metres. Repeats across a city's slices collapse to the first. The city builder dedupes again against city OSM rows.

A city's own earlier discoveries are kept with their original observation, and a candidate matching one is reported as `retained`, not as a duplicate. A stored row that no longer passes validation is dropped and listed under `withdrawn`.

Accepted observations live in `data/cities/<city>/parallel_venues.json`. Each names its `provider`; Parallel rows also carry the `runId` that found them. OSM files stay separate and keep their own dates and attribution. The city builder merges the two sources, keeps bar and restaurant kinds and writes unpriced pins.

```sh
node scripts/discover_parallel_venues.mjs --check
DEPLOYMENT_VERSION=local npm run build:slim
DEPLOYMENT_VERSION=local npm run build:city-slim
npm run build:city-night-areas
npm run validate-data
npm run verify
```

Local revision flags above match committed data conventions. They do not prove deployment. The build refuses malformed discovery evidence before writing a city index. Parsing, citation binding, URL policy, district slicing, request fitting, retained-versus-duplicate assembly and venue-kind publication have unit tests in `__tests__/parallelVenueDiscovery.test.ts`.

`observedAt` dates the research result retrieval, not a verified opening tonight. Cached reruns keep the date. `freshness.json` takes its stamp from the oldest accepted row, and `data/freshness_registry.json` tracks that stamp. New research cannot freshen unchanged older rows.

## Usage and cost

`usage.jsonl` records every Parallel, Tavily and Firecrawl HTTP request, its provider, status, returned usage and approximate USD cost, including failed calls and zero-cost result reads. It contains no headers or credentials. Raw vendor responses stay ignored. `reports/<city>.json` lists each city's slices, task runs, rejected, retained and duplicate candidates. `summary.json` totals the cities and every call in `usage.jsonl`, by city and provider.

Estimates use [Parallel's published pricing](https://docs.parallel.ai/getting-started/pricing), checked 4 October 2026: advanced Search is $0.005 per request including ten results; Task is $0.01 for base, $0.025 for core, $0.10 for pro and $0.30 for ultra. Tavily is costed at its pay-as-you-go $0.008 per credit: one credit per basic search, and one per five pages read by basic Extract. Firecrawl, used once and now out of the lane, is costed at $0.005 per credit, its Hobby top-up rate of 1,000 credits per $5, and a scrape with JSON extraction uses 5 credits. Task reservations are counted at successful creation, so a later failed task can make the estimate exceed the bill. Account invoices remain authoritative.

## Current state

No run is complete across every city: `summary.json` says `allCitiesComplete: false`. Oxford and Llandudno are complete, and 59 slices elsewhere wait on robots files this network could not reach; each city report lists its `incompleteSlices` with the reason. Parallel and Firecrawl are out of credit (HTTP 402) and are no longer called. Rerun `node scripts/discover_parallel_venues.mjs --provider=tavily` to resume. Measured before and after counts are in [the proof notes](../../docs/proof/parallel-venue-discovery/README.md).
