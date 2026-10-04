# Parallel venue discovery

This lane discovers missing pubs, bars and restaurants serving alcohol outside London. It adds presence records, never prices, ratings or opening hours.

The first batch covers Birmingham, Leeds and Glasgow. The queue includes all eleven existing city packs and 21 other major UK cities. It is not an exhaustive census of UK hospitality venues.

## Run and resume

Load `PARALLEL_API_KEY` in the invoking shell. The script never reads a key file. Do not copy credentials into this repository.

```sh
node scripts/discover_parallel_venues.mjs --list
node scripts/discover_parallel_venues.mjs --city-limit=3
node scripts/discover_parallel_venues.mjs --cities=manchester,liverpool,bristol
node scripts/discover_parallel_venues.mjs --cities=birmingham --refresh
```

There is no spend cap. `--city-limit` selects a delivery batch; `--matches` sets the requested candidate count per city, default 100. Research may return fewer candidates. The default processor is `pro`; `base`, `core` and `ultra` are also supported.

Cities run sequentially in descending census resident population order. The priority uses administrative census areas, documented in `scripts/lib/parallelDiscoveryCities.mjs`. Those areas can exceed the map boxes: County Durham, Bath and North East Somerset, and Conwy determine the priority for Durham, Bath and Llandudno respectively. They do not change map boundaries.

Each city uses three [Search API](https://docs.parallel.ai/search/search-quickstart) queries, one per venue category, then a [Task API](https://docs.parallel.ai/task-api/task-quickstart) research run with structured output and citations per venue. [FindAll](https://docs.parallel.ai/findall-api/findall-quickstart) was reviewed. Task supplies the address and drinking evidence in one research operation; local code controls acceptance and dedupe. Search seeds are starting points, not a closed source list.

Task input has a documented 25,000-character limit. The script compresses known venue names to fit, reports when research exclusions are partial, and still dedupes against every local venue afterward.

Raw searches, task results, run IDs and postcode responses live under the ignored `data-harvest/parallel-venue-discovery/`. Failed runs retain checkpoints. Repeating the same command resumes. Completed cached runs can replay without a key and retain their observation dates. `--refresh` starts new research for the selected cities.

## Acceptance and publication

Every accepted venue needs:

- An original source URL from its own site or a recognized venue listing, permitted by source policy. Google Maps and Google Places sources are rejected.
- Verbatim evidence found in that venue's own Task citation basis. Parent-list or other-venue citations do not count.
- A stated venue name, street address and full postcode, plus pub/bar identity or explicit restaurant alcohol evidence.
- Coordinates quoted by the source, or a postcode that resolves inside the city's box through [Postcodes.io](https://postcodes.io/).

Postcode geocoding is approximate. Rows say `coordinatePrecision: "postcode-centroid"` and retain the geocode URL, quality and observation date. Those coordinates are not building entrances. This first batch uses postcode centroids.

Dedupe reads national OSM pub, drink, food and work packs, existing city packs, London data and prior discoveries. Name matching uses the shared venue identity matcher. Distance is at most 150 metres for source coordinates, 350 metres when a postcode centroid participates. Different postcodes remain separate beyond 50 metres. Dedupe also runs within each batch and again against city OSM rows at build time.

Accepted observations for existing maps live in `data/cities/<city>/parallel_venues.json`. OSM files remain separate and retain their original dates and attribution. The city builder merges the two sources, keeps bar/restaurant kinds and writes unpriced pins.

Cities without a shipped map stage accepted records under `data/parallel-discovery/cities/`. These records do not appear in the product yet. Shipping those cities also needs the existing city configuration, ID prefixes, bounds and pack registration. Stage status is explicit in each report and in `--list`.

```sh
node scripts/discover_parallel_venues.mjs --check
DEPLOYMENT_VERSION=local npm run build:slim
DEPLOYMENT_VERSION=local npm run build:city-slim
npm run build:city-night-areas
npm run validate-data
npm run verify
```

Local revision flags above match committed data conventions. They do not prove deployment. The build refuses malformed discovery evidence before writing a city index. Parsing, citation binding, URL policy, geocoding preconditions, dedupe and venue-kind publication have unit tests in `__tests__/parallelVenueDiscovery.test.ts`.

`observedAt` dates the research result retrieval, not a verified opening tonight. Cached reruns retain the date. `freshness.json` derives its stamp from the oldest accepted row, and `data/freshness_registry.json` tracks that stamp. New research cannot freshen unchanged older rows.

## Usage and cost

`usage.jsonl` records every Parallel HTTP request, status, returned usage and approximate USD cost, including failed calls and zero-cost polling. It contains no headers or credentials. Raw vendor responses remain ignored. City reports list rejected and duplicate candidates.

Estimates use [Parallel's published pricing](https://docs.parallel.ai/getting-started/pricing), checked 4 October 2026: advanced Search is $0.005 per request including ten results; Task is $0.01 for base, $0.025 for core, $0.10 for pro and $0.30 for ultra. Task reservations are counted at successful creation, so a later failed task can make the estimate exceed the bill. Account invoices remain authoritative.

First batch used 33 HTTP calls: 10 successful Search calls, three successful Task creations, one rejected oversized Task request and 19 status/result reads. Estimated cost was $0.350. Of 29 researched candidates, 14 passed and 15 were rejected. Follow-up batches remain queued; no claim of complete UK coverage is made.
