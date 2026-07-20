# Night-out place ingest

This lane adds a governed offline feed for two specific planning jobs:

- `near_pub_food`: restaurants close to an anchored pub or plan stop.
- `pre_pub_attraction`: attractions close to an anchored pub or plan stop.

It is not a general London directory. Consumers must supply a valid Greater
London latitude/longitude anchor to `GET /api/night-out-places` and choose one
of those jobs. When no row survives the quality and freshness gates, the route
returns an honest empty state.

## Trust boundary

The producer registry is
`data/night_out_place_provenance_registry.json`. Exa can discover a source URL,
and Firecrawl can retrieve that source page. Neither provider's generated
summary or search snippet becomes a fact. A row is eligible only when the
source page itself exposes a matching Schema.org JSON-LD object containing:

- a restaurant or attraction type;
- name and factual description;
- full address and Greater London coordinates;
- an HTTPS source URL;
- the real ingestion observation instant.

The description passes through `lib/slopFilter.ts`. Missing descriptions,
marketing filler, malformed provenance, non-London coordinates, and incomplete
rows are rejected. Source URLs have tracking parameters removed. Every accepted
row expires after 30 days, and the runtime drops expired, future-observed, or
over-age rows even if an old artifact is accidentally deployed.

Provider protocols follow the official [Exa Search API](https://exa.ai/docs/reference/search)
and [Firecrawl v2 scrape API](https://docs.firecrawl.dev/api-reference/endpoint/scrape).

## Owner-gated run

Required environment variables:

- `EXA_API_KEY`
- `FIRECRAWL_API_KEY`

Start with a bounded dry run:

```sh
npm run ingest:night-out-places -- --dry-run --limit 2
```

Publish a refreshed local artifact for review:

```sh
npm run ingest:night-out-places -- --limit 5
npm run validate-data
npm test -- __tests__/nightOutPlaceIngestion.test.ts __tests__/nightOutPlaces.test.ts __tests__/nightOutPlacesRoute.test.ts
```

Missing keys, HTTP 401/403, exhausted credits (402), rate/credit limits (429),
network failures, and malformed provider responses halt with a non-zero exit
and an `OWNER ACTION` message. The script writes only after every provider call
has succeeded, using an atomic rename, so a failure leaves the trusted snapshot
untouched. A successful refresh merges current existing rows and removes only
expired ones; it does not replace trusted current rows with an empty search.

No scheduled workflow is enabled yet. GitHub Actions runner allocation and the
owner-funded provider keys/credits are external blockers recorded in the
Wayfinder. Until those are ready, the committed feed intentionally contains no
rows and the product returns the honest empty state.
