# Governed priced landings - technical shape

## One seam, two families

`lib/pricedLanding.ts` is the ONE place a priced landing page's shared rules
live, because two families are two views of one contract and a second copy of
any rule is how two pages come to answer one question two ways:

- `PricedLandingRow` and `PricedLandingCandidate`.
- `comparePricedLandingRows` - cheapest, then pub name, then pub id.
- `PRICED_LANDING_PUBLICATION_FLOORS` - the floor table, one row per family.
- `publishablePricedRows` - the ONE decision that `null` means "no page exists",
  so the route, `generateStaticParams` and the sitemap cannot disagree.
- `formatPricedLandingPublisherStatus` and `pricedLandingCountLabel` - the two
  sentences these pages print about provenance and coverage.
- `assignVenueToNightArea` - memoised per area catalogue. Unmemoised it ran once
  per venue per (area x brand) pair, roughly 1.5M haversines for one
  `/sitemap.xml` request.
- `nightAreaPublishesPrices` - see "Review expiry" below.
- `pricedLandingJsonLd` - one BreadcrumbList plus one ItemList. The root layout
  still supplies the site-wide `WebSite` and `Organization` graph.

`components/drinks/PricedLandingRows.tsx` is the matching ONE list component.
Both content components render it, so `role="list"`, the rank's presentational
marking, the ledger link, the publisher disclosure and the optional row action
cannot drift between the two pages. `components/drinks/drinkBrandDirectory.css`
is the ONE stylesheet; there are no per-route stylesheets and no alias class
names, because ~24 unstyled aliases were a half-finished share.

Per-family modules stay thin: `lib/drinkBrandLanding.ts` owns brand matching and
`lib/drinkBrandAreaLanding.ts` owns area assignment, each returning candidates
into the shared publication decision.

## Dataset read

`lib/pintPriceLandingDataset.server.ts` is the ONE reader and it delegates to
`getPricedVenues()` (`lib/venuePriceIndex.ts`), the per-instance grouped index
every priced surface shares. A loader of its own would re-parse 6.7 MB on every
page render, metadata read, OG card and sitemap request, which is the defect
#1049 removed from `/pubs`.

Failure is TWO answers, not one: `loadPintPriceLandingVenues` degrades to `[]`
so a page 404s rather than 500ing, and `loadPintPriceLandingVenuesOrThrow` is
the sitemap's own read, which fails loud because a truncated sitemap deindexes
every URL it dropped.

`RUNTIME_DATA_PACKS` declares the seam (`pint-price-landing-dataset`), and
`APP_ENTRY_NAMES` carries `sitemap` so `/sitemap.xml` derives its own include
key. `__tests__/venueIndexTracing.test.ts` fails if a reader route stops
carrying the dataset.

## Routes

- `app/drink/[slug]/{page,opengraph-image}.tsx`
- `app/area/[slug]/drink/[brand]/{page,opengraph-image}.tsx`

Both declare `dynamicParams = false` and NO `revalidate`: every page reads the
per-request CSP nonce, so the document is dynamic and a revalidate window would
bound nothing. Each OG route carries `loadOgFonts()` and `OG_CACHE_HEADERS`, and
`notFound()`s an unpublished slug rather than answering a 200 branded card. The
brand-by-area page owns its own card because Next would otherwise serve the
nearest ancestor's while the page declares `twitter: summary_large_image`.

## Review expiry

`isNightAreaRouteReady` expires with the area's `reviewExpiresAt`, and every
route-ready area shares one date. That gate governs PLANNING a crawl: unchecked
transport and opening hours must stop a route. A priced list is not a route, so
the landing family reads `nightAreaPublishesPrices` instead, which drops the
expiry. Letting the review lapse would otherwise 404 URLs already in the
sitemap and deindex them.

`__tests__/nightAreaReviewRenewal.test.ts` is the alarm: it fails 30 days ahead
of the window and names the file and fields to move forward.

## Tests

| Question | Owner |
| --- | --- |
| Shared floors, order, publisher, count label, JSON-LD | `__tests__/drinkBrandLanding.test.ts`, `__tests__/drinkBrandAreaLanding.test.ts` |
| Route, metadata, 404, destinations, OG card | `__tests__/drinkBrandLandingPage.test.ts`, `__tests__/drinkBrandAreaLandingPage.test.ts` |
| Exactly the governed URL set, and no `/area/{slug}` | `__tests__/sitemap.test.ts` |
| Dataset reaches every reader function | `__tests__/venueIndexTracing.test.ts` |
| Review renewal alarm | `__tests__/nightAreaReviewRenewal.test.ts` |
| Rendered geometry, focus, both themes, exact hrefs | `e2e/drink-brand-landing.spec.ts`, `e2e/drink-brand-area-landing.spec.ts` |
