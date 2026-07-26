# Night-out place ingest

This contract governs two London place-data lanes:

- The automated offline planning feed in
  `public/data/night_out_places/latest.json` serves `near_pub_food` and
  `pre_pub_attraction`.
- The hand-curated map packs in `data/famous_venues/` serve late-night bar and
  crawl-ending food discovery.

Neither lane is a general London directory. Consumers of
`GET /api/night-out-places` must supply a valid Greater London
latitude/longitude anchor and choose one of the automated feed's jobs. When no
row survives the quality and freshness gates, the route returns an honest empty
state.

## Trust boundary

The producer registry is
`data/night_out_place_provenance_registry.json`. It owns accepted producer
roles and required row fields for both lanes.

For the automated feed, Exa can discover a source URL and Firecrawl can retrieve
that source page. Neither provider's generated summary or search snippet
becomes a fact. A row is eligible only when the source page itself exposes a
matching Schema.org JSON-LD object containing:

- a restaurant or attraction type;
- name and factual description;
- full address and Greater London coordinates;
- an HTTPS source URL that exactly matches the JSON-LD URL after canonical
  query/fragment and trailing-slash normalization, including the full path;
- the real ingestion observation instant.

The description passes through `lib/slopFilter.ts`. Missing descriptions,
marketing filler, malformed provenance, non-London coordinates, and incomplete
rows are rejected. Pages containing multiple matching place objects are treated
as ambiguous directories and rejected. Source URLs remove only an explicit
tracking allowlist (`utm_*`, `gclid`, `fbclid`, and equivalent ad identifiers);
all remaining query parameters are sorted and preserved as page identity.
Credentials, nonstandard ports, and local/literal hosts are rejected.

Local DNS resolution is an advisory early rejection of special-use addresses,
using `ipaddr.js`'s maintained range taxonomy. It cannot pin the DNS answer used
by a remote provider and is not represented as a rebinding guarantee. The
provider boundary instead requires a live Firecrawl request with `maxAge: 0`,
`storeInCache: false`, `lockdown: false`, and `skipTlsVerification: false`, then
requires the requested URL, returned `metadata.sourceURL`, final `metadata.url`,
and any returned canonical/final URL fields to have the exact same normalized
identity. Missing identity metadata, redirects, cache markers, and stale exposed
fetch timestamps fail closed. `observedAt` is the authenticated Firecrawl API
response receipt time, never the Exa search time or a cached-page timestamp.

For the hand-curated packs, the `manual` producer verifies venue-owned or award
pages directly. Each venue also carries independent fame evidence, current
trading evidence, and separate source URLs for its displayed price anchor and
story. The build validates those packs through
`lib/nightOutPlaceContract.mjs`; it does not route manual facts through the
automated JSON-LD extractor.

Every accepted row expires after 30 days. The automated runtime drops expired,
future-observed, or over-age rows even if an old artifact is accidentally
deployed. `npm run build:slim` fails when hand-curated current-trading evidence
is no longer current, so an expired venue cannot enter a rebuilt map index.

Provider protocols follow the official [Exa Search API](https://exa.ai/docs/reference/search)
and [Firecrawl v2 scrape API](https://docs.firecrawl.dev/api-reference/endpoint/scrape).

## Automated feed run

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
network failures, missing raw HTML, and malformed HTTP-200 provider responses
halt with a non-zero exit
and an `OWNER ACTION` message. The script writes only after every provider call
has succeeded, using an atomic rename, so a failure leaves the trusted snapshot
untouched. The committed `latest.json` is required, including when its status is
`empty`; a missing or invalid current snapshot fails validation and ingestion.
The existing and merged snapshots are fully validated before any temporary file
is renamed. A successful refresh merges current existing rows and removes only
expired ones; it does not replace trusted current rows with an empty search.

## Hand-curated map packs

`scripts/build_slim_index.mjs` is the publishing boundary for
`data/famous_venues/`. It validates provenance and freshness, merges accepted
rows into the existing slim index, and preserves absent `kind` as the
backward-compatible pub meaning.

Bar and late-food prices remain item-specific anchors. Map colour bands are
relative within each venue type, and compact surfaces carry the anchor label,
observed month, and source. These venues never enter pub-only Pint Drop,
community price, crawl-planning, or pint-specific saved-list flows.

No scheduled workflow is enabled for the automated feed yet. GitHub Actions
runner allocation and the owner-funded provider keys/credits are external
blockers recorded in the Wayfinder. Until those are ready, its committed
snapshot intentionally contains no rows and the route returns the honest empty
state. The manual map packs are independent of that snapshot.
