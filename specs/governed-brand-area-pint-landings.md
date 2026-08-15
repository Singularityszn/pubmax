# Governed Brand by Night Area Pint Landings

Status: ready for implementation on 2026-08-15.

## Goal

Publish search-ready answers such as `/area/victoria/drink/guinness` from
PUBMAXX Pint Price data, then let a drinker log the exact Venue and brand price
from each ranked row.

This is one independently verifiable slice. It extends existing governed Night
Area and drink-brand landing models. It does not create a second price dataset,
area catalogue, brand catalogue, or contribution flow.

## User journey

1. A drinker opens a brand-by-area page from search or a shared link.
2. Hero answers the cheapest listed price, exact publisher status, total priced
   pub count, and shared collection date.
3. Ranked rows show exact Venue, pint, price, and publisher.
4. `Open on Map` keeps Night Area and brand filters.
5. Each `Log this price` action opens Map with exact Venue, beer category,
   brand, and `log=1` contribution intent.
6. Existing Map identity and contribution code owns sign-in, return, validation,
   and submission.

## Publication contract

- Only `NIGHT_AREAS` entries that pass `isNightAreaRouteReady(area, now)` can publish.
- Assign each Venue to one nearest containing Night Area through `assignVenueToNightArea`.
- Only pub Venue kinds count.
- Only exact positive finite Pint Price rows that match a beer brand from `DRINK_BRANDS.beer` count.
- Pick one cheapest exact matching row per Venue. Break price ties by `app_price_id`, then `pint_name`.
- Publish a pair only when at least 10 unique pub Venues qualify.
- Rank by price, Venue name, then Venue id. Render at most 20 rows while hero reports full eligible Venue count.
- Use `PINT_DATASET_OBSERVED_AT` as one shared collection date. Do not describe it as live, current, updated, or a per-row observation date.
- Publisher comes only from exact displayed row through `namedLegacyPintPriceSource`.
- Missing publisher text is `Publisher not recorded`.
- Current fixture produces 14 eligible pairs. Tests derive eligibility from production data and policy. Route code and sitemap must not hardcode that count or list.

## Public interfaces

`lib/drinkBrandLanding.ts` remains owner of exact brand-row selection and publisher formatting:

```ts
export type DrinkBrandLandingPublisher = NonNullable<
  ReturnType<typeof namedLegacyPintPriceSource>
>;

export function selectDrinkBrandPriceForVenue(
  venue: Venue,
  brand: (typeof DRINK_BRANDS.beer)[number],
): VenuePrice | null;
```

`lib/drinkBrandAreaLanding.ts` owns pair governance:

```ts
export const DRINK_BRAND_AREA_PUBLICATION_FLOOR = 10;
export const DRINK_BRAND_AREA_ROW_LIMIT = 20;

export type DrinkBrandAreaLanding = {
  areaSlug: NightAreaSlug;
  areaName: string;
  brandSlug: string;
  brandLabel: string;
  collectedAt: string;
  totalPricedVenues: number;
  rows: [DrinkBrandLandingRow, ...DrinkBrandLandingRow[]];
};

export function buildDrinkBrandAreaLanding(
  areaSlug: string,
  brandSlug: string,
  venues: readonly Venue[],
  areas?: readonly NightArea[],
  now?: Date,
): DrinkBrandAreaLanding | null;

export function listDrinkBrandAreaLandings(
  venues: readonly Venue[],
  areas?: readonly NightArea[],
  now?: Date,
): DrinkBrandAreaLanding[];
```

`lib/drinkBrandAreaLanding.server.ts` owns shared dataset loading and JSON-LD. Route, static params, metadata, sitemap, and JSON-LD all consume this server owner.

## Route and metadata

- Route: `/area/[slug]/drink/[brand]`.
- `dynamicParams = false`, `revalidate = 86_400`.
- Static params come only from `loadDrinkBrandAreaLandings()`.
- Unknown, not-ready, or below-floor pairs return 404. Metadata for them is `noindex, nofollow`.
- Canonical and Open Graph URL use exact route.
- Description states eligible Venue count, area, brand, cheapest price, and exact first-row publisher status.
- JSON-LD contains one `BreadcrumbList` and one rendered `ItemList`. Breadcrumbs are Map, Night Area, brand. `ItemList.numberOfItems` equals rendered row count.
- Sitemap enumerates same loader only. Use Pint Price dataset mtime, `weekly`, and priority `0.75`.

## UI contract

- Server-rendered page. No new client bundle or fetch waterfall.
- First phone viewport shows H1, cheapest price, publisher status, collection summary, and primary Map action.
- Hero has one primary action. Contribution actions belong to exact rows because generic logging must not guess a Venue.
- Every Ledger, publisher, Map, and contribution action has visible keyboard focus.
- Primary and contribution actions have at least 44 by 44 CSS pixels.
- Page has no horizontal overflow at 320, 390, or 430 CSS pixels.
- Row action URL is `/map?q=<area>&drink=beer&brand=<brand>&sel=<venueId>&log=1` with URL encoding.
- Generic Map URL is `/map?q=<area>&drink=beer&brand=<brand>`.
- Preserve PUBMAXX visual tokens and existing drink landing hierarchy.

## SEO and data firewalls

- Use only `public/data/pint_prices_app_dataset.json` through `loadPintPriceLandingVenues()`.
- Do not import competitor records, prose, images, comments, usernames, or derived rankings.
- Do not publish thin or ungoverned combinations to grow URL count.
- Do not add generated files, migrations, external fetches, or new storage.
- Do not claim competitor user counts. Attachment audit shows 1,175 means price observations, not users.

## Verification

- Unit: unknown area, unknown brand, not-ready area, below-floor pair, unique assignment, exact-row selection, deterministic ranking, row cap, shared date, exact publisher, and production fixture pair list.
- Page: static params, 404/noindex, canonical metadata, first-row publisher, row-level contribution URLs, JSON-LD, and no root schema duplication.
- Sitemap: every and only eligible pair URL appears once.
- Browser: Chromium at 320, 390, 430, and desktop. Check above-fold answer, 44px targets, focus, overflow, row order, exact hrefs, light mode, and dark mode.
- Full: focused lint, typecheck, `git diff --check`, then `npm run verify`.

## Rejected alternatives

- Camden examples: rejected until Camden passes its Night Area route gate.
- Brand pages for every borough: rejected because borough membership is broader than governed night-out intent and would multiply weak pages.
- Price watches in this slice: rejected because notifications, consent, change authority, and expiry need a separate retention spec.
- OCR logging: rejected because confirmation, image privacy, and provenance need separate product decisions.
- Competitor data import: rejected. Only public mechanics informed this slice.

## Compatibility and migration

Hard additive route. No data migration, compatibility shim, or deploy-order dance. Existing `/drink/[slug]` and `/area/[slug]` behavior stays compatible.
