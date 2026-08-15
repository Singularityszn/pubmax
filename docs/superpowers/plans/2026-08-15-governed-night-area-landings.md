# Governed Night Area Landing Pages

## Goal

Publish useful `/area/[slug]` pages only when a Night Area is crawl-ready and has at least 10 listed pubs with Pint Prices. Keep ranking, publisher disclosure, metadata, and sitemap output derived from one server-owned model.

## Public contract

- Publish Clapham, Victoria, Piccadilly & Soho, and Canary Wharf while their route-ready review is current.
- Assign every London Venue to at most one Night Area. Consider all 20 Night Areas, keep only centres whose radius contains the Venue, then choose the nearest centre. Break an exact distance tie by slug.
- Build each page from priced Venues assigned to that area. Do not publish a page below 10 priced Venues.
- Rank by cheapest Pint Price, then Venue name, then Venue id.
- Bind each displayed price to its exact cheapest price row.
- Name and link a publisher only from that price row. Current `pint-prices.com` rows display `Pint Prices`. An unmapped row displays `Publisher not recorded` with no source link.
- Use the shared listed-price collection date. Do not imply that each row has its own observation date.
- Unknown, stale, unreviewed, and thin areas return 404 and stay out of static params and sitemap.

## Surface

- One H1: `Cheapest Pints in {area}`.
- One concise count and collection date.
- Primary action: open the area on Map.
- Secondary action: open Plan.
- Semantic cheapest-first table with rank, pub, pint, price, and publisher.
- On phones, keep rank and price visible without horizontal scrolling. Publisher wraps below pub details.
- Links have visible focus and at least 44 px touch height where they act as row or page actions.
- Product copy says `area` or `patch`, never internal `Night Area` or gate language.

## Implementation

### 1. Domain model

Create `lib/nightAreaLanding.ts`:

- `NIGHT_AREA_LANDING_PRICE_FLOOR = 10`
- `assignVenueToNightArea(venue, areas)`
- `nightAreaPricePublisher(row)`
- `buildNightAreaLanding(area, venues, now)`
- `listNightAreaLandings(venues, areas, now)`
- exact DTO types for ranked price rows and page model

Keep functions pure. Accept `now` and catalogues as inputs for expiry and negative-path tests.

### 2. Server loader

Create `lib/nightAreaLanding.server.ts`:

- Read `public/data/pint_prices_app_dataset.json`.
- Group rows with `groupVenuePrices`.
- Return one landing or all publishable landings.
- Fail closed on malformed or empty data.

### 3. Route

Create:

- `app/area/[slug]/page.tsx`
- `app/area/[slug]/area.css`
- `app/area/[slug]/opengraph-image.tsx`

Use `generateStaticParams`, `generateMetadata`, canonical `/area/{slug}`, BreadcrumbList, and ItemList JSON-LD. Unknown or ineligible slugs call `notFound()`.

### 4. Sitemap

Add publishable `/area/{slug}` entries from the same server loader. Count and eligibility must not be restated in `app/sitemap.ts`.

### 5. Tests

Add:

- `__tests__/nightAreaLanding.test.ts` for assignment, counts, rank stability, price-row binding, publisher mapping, expiry, and floor.
- `__tests__/nightAreaLandingPage.test.tsx` for metadata, static params, 404, copy, links, source disclosure, table semantics, and JSON-LD.
- Update `__tests__/sitemap.test.ts` for exactly four governed area URLs.
- `e2e/night-area-landing.spec.ts` at 390 px and 1440 px for layout, focus, no horizontal overflow, Map destination, and publisher disclosure.

## Verification

1. Run new unit tests in RED before implementation.
2. Run focused unit, typecheck, and lint gates.
3. Run browser proof at 390 px in light and dark modes and at 1440 px.
4. Review new UI against Web Interface Guidelines.
5. Run `npm run verify`.
6. Run `git diff --check` and voice-law checks before commit.
