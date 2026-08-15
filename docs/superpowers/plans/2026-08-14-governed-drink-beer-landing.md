# Governed beer landing implementation plan

**Goal:** Publish one clear `/drink/beer` acquisition page only when PUBMAXX has enough governed Pint Price evidence to answer it well.

**Architecture:** Build a pure server-side model from the bundled Venue Dataset. The model accepts only registered landing categories, keeps pub venues with a valid exact Pint Price row, sorts them cheapest-first, and refuses publication below a fixed evidence floor. The page renders only the model DTO, names each recorded publisher when the matching row carries one, uses one shared Venue Dataset collection date, and links every Venue through its canonical Ledger route. No competitor record enters the Venue Dataset.

**Trust rules:**

- First category is `beer`. Unsupported and thin categories return 404 and are absent from sitemap.
- Publication needs at least 20 exact Pint Price rows. Page shows the 20 cheapest rows.
- A publisher name appears only from the exact price row. Missing publisher reads `Publisher not recorded`.
- Collection date is shared page context. It is not repeated as a per-row observation date.
- Ranking uses stable Venue identity and numeric price. It never uses address-string geography.
- Page is static-data only. Community rows continue to reach map authority through existing corroboration and age gates.

## Task 1: Pin the governed model

**Create:** `__tests__/drinkLanding.test.ts`

RED cases:

1. Unsupported category returns no model.
2. Fewer than 20 exact Pint Price rows returns no model.
3. Non-pub, missing-price, and mismatched price rows do not qualify.
4. Rows sort by price, then name, then Venue ID.
5. Publisher comes only from the exact Pint Price row.
6. Missing publisher stays explicit.

**Create:** `lib/drinkLanding.ts`

Implement the smallest pure model needed to pass.

## Task 2: Pin the page and SEO contract

**Create:** `__tests__/drinkLandingPage.test.tsx`

RED cases:

1. Page heading gives the price-first answer.
2. Each row exposes Venue, area, Pint Price, pint name, and publisher state.
3. Shared collection date appears once.
4. Map CTA uses `/map?drink=beer`.
5. Canonical Venue links use `/ledger/{id}`.
6. Thin or unknown categories cannot publish metadata as indexable pages.

**Create:** `app/drink/[category]/page.tsx`

**Create:** `app/drink/[category]/drink-landing.css`

Render a compact mobile-first ranked table, JSON-LD `BreadcrumbList` and `ItemList`, canonical metadata, and honest empty refusal through `notFound()`.

## Task 3: Make the route discoverable

**Modify:** `app/sitemap.ts`

**Modify:** `__tests__/sitemap.test.ts`

Add `/drink/beer` as one static governed route. Keep `/drinks` excluded because it remains a redirect.

## Task 4: Browser proof and verification

**Create:** `e2e/drink-beer-landing.spec.ts`

Verify at 390px and 1440px:

1. No horizontal overflow.
2. First ranked Venue and map CTA are keyboard/touch reachable.
3. Shared date appears once.
4. Every visible price has a publisher disclosure.
5. `/drink/not-real` returns 404.

Run focused Vitest, sitemap, route-tracing, ESLint, TypeScript, and Playwright gates. Capture light and dark screenshots under `docs/proof/drink-beer-landing/`.
