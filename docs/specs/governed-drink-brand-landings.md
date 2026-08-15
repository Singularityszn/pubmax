# Governed Drink Brand Landings

## Outcome

Publish useful London brand-price pages from PUBMAXX Pint Price evidence. A search arrival gets one immediate answer, can open the same brand lens on Map, and can contribute a new Pint Price.

## Data Boundary

- Use only `public/data/pint_prices_app_dataset.json` and existing PUBMAXX taxonomy.
- Do not import or retain Cheapest Pint records.
- Publish only beer brands registered in `DRINK_BRANDS.beer`.
- Publish a brand only when at least 20 unique pub Venues carry one valid matching Pint Price row.
- Show at most the 20 cheapest matching Venues.
- Count one Venue once. Within one Venue, use its cheapest matching brand row. Break an equal-price row tie by `app_price_id`, then `pint_name`.
- Exclude non-pub Venues, non-numeric prices, zero or negative prices, and rows that do not match the requested brand.
- Rank by price, Venue name, then stable Venue ID.

## Trust Contract

- Every displayed figure comes from the exact matching Pint Price row.
- Publisher label and link come only from that row through `namedLegacyPintPriceSource`.
- Missing publisher reads `Publisher not recorded` and has no source link.
- The page shows `PINT_DATASET_OBSERVED_AT` once as shared collection context. It does not present that date as a per-row observation date.
- The route does not claim that bundled rows are PUBMAXX community submissions.
- Community prices continue to reach Map authority only through existing identity, corroboration, freshness, and moderation rules.

## Public Routes

- Route family: `/drink/[slug]`.
- Current eligible slugs: `guinness`, `neck-oil`, `estrella`, `peroni`, `amstel`, `madri`, `camden-hells`, and `birra-moretti`.
- Unsupported and below-floor brands return 404, use noindex metadata, stay out of static params, and stay out of sitemap.
- Canonical URL: `/drink/{slug}`.
- Map URL: `/map?drink=beer&brand={slug}`.
- Contribution URL: `/map?drink=beer&brand={slug}&log=1`. The log flow opens Venue selection and keeps the brand lens. It never chooses a Venue implicitly.

## Mobile Surface

- One H1: `Cheapest {brand} Pints in London`.
- One immediate `From {lowest listed price}` answer above the fold.
- One concise count and shared collection date.
- One primary button: `Find {brand} on Map`.
- One secondary text link: `Log a {brand} Pint Price`.
- One cheapest-first semantic list with rank, Venue, borough, exact pint name, publisher, and price.
- Rank and price remain visible at 320, 390, and 430 px with no horizontal page scroll.
- Action and row navigation targets are at least 44 px.
- Every interactive element has visible focus.
- Light and dark themes use existing PUBMAXX tokens and respect reduced motion.

## Search Surface

- Valid pages expose canonical, Open Graph, and Twitter metadata.
- JSON-LD contains only `BreadcrumbList` and the rendered `ItemList`.
- Sitemap entries come from the same governed loader as static params and pages.
- Runtime tracing includes the shared Pint Price landing data reader for page, sitemap, and Open Graph functions.

## Proof

- Domain and page tests prove exact row binding, publisher binding, floor, stable sorting, 404, metadata, Map and contribution destinations, collection date, and JSON-LD.
- Sitemap tests prove the exact governed route set.
- Browser proof covers 320x844, 390x844 light and dark, 430x932, and 1440x900. It proves above-fold answer and actions, touch sizes, keyboard focus, no horizontal overflow, Map lens state, brand-preserving log flow, Back restoration, console errors, and unknown-brand 404.
