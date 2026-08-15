# Governed Drink Brand Landings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish trustworthy London Pint Price pages for every sufficiently covered registered beer brand, with one-tap Map continuation and contribution return.

**Architecture:** A pure domain model selects exact brand-matching Pint Price rows and refuses thin routes. One fail-loud cached server reader supplies page, static params, Open Graph, and sitemap. Server-rendered pages consume only the model DTO and use one shared mobile-first presentation component.

**Tech Stack:** Next.js 16 App Router, React 19 server components, TypeScript, Vitest, Playwright, CSS modules by route convention, Next `ImageResponse`.

**Spec:** `docs/specs/governed-drink-brand-landings.md`

## Global Constraints

- Use only `public/data/pint_prices_app_dataset.json` and existing PUBMAXX taxonomy. No competitor record enters PUBMAXX.
- Publication floor is exactly 20 unique pub Venues. Render at most exactly 20 ranked rows.
- Current governed slugs are derived, never copied into page or sitemap code.
- Every figure, pint name, and publisher comes from the exact brand-matching Pint Price row.
- Collection date is shared page context and appears once, never once per row.
- Primary action opens `/map?drink=beer&brand={slug}`. Secondary text link opens `/map?drink=beer&brand={slug}&log=1`, preserves the brand lens, and never chooses a Venue implicitly.
- Unsupported or thin brands return 404, noindex, and no sitemap entry.
- Use British spelling, PUBMAXX ubiquitous language, no em dash, and `docs/VOICE.md` price disclosure rules.
- Mobile widths are 320, 390, and 430 px. Lowest listed figure and both actions remain above the fold. All action and row-navigation targets are at least 44 px. Page has no horizontal overflow.
- Use existing design tokens. Support light, dark, reduced motion, keyboard focus, browser zoom, and safe-area insets.

---

### Task 1: Governed Brand Model and Shared Data Reader

**Files:**
- Create: `__tests__/drinkBrandLanding.test.ts`
- Create: `lib/drinkBrandLanding.ts`
- Create: `lib/pintPriceLandingDataset.server.ts`
- Modify: `lib/nightAreaLanding.server.ts`
- Modify: `lib/venueIndexTracing.mjs`
- Modify: `__tests__/venueIndexTracing.test.ts`

**Interfaces:**
- Consumes: `DRINK_BRANDS.beer`, `haystackMatchesBrand`, `namedLegacyPintPriceSource`, `PINT_DATASET_OBSERVED_AT`, `groupVenuePrices`, `isPubVenueKind`.
- Produces: `DRINK_BRAND_LANDING_PUBLICATION_FLOOR`, `DRINK_BRAND_LANDING_ROW_LIMIT`, `DrinkBrandLanding`, `DrinkBrandLandingRow`, `buildDrinkBrandLanding(slug, venues, options?)`, `listDrinkBrandLandings(venues)`, `loadPintPriceLandingVenues()`.

- [ ] **Step 1: Write failing domain tests**

```ts
expect(buildDrinkBrandLanding("not-real", [])).toBeNull();
expect(buildDrinkBrandLanding("guinness", belowFloor)).toBeNull();
expect(model?.rows.map((row) => row.venueId)).toEqual([
  "cheap",
  "alpha-a",
  "alpha-b",
]);
expect(model?.rows[0].publisher).toEqual({
  label: "Pint Prices",
  url: "https://www.pint-prices.com/pub/exact",
});
```

Cover non-pubs, invalid prices, wrong brands, one Venue with several matching rows, equal-price tie order, publisher absence, 20-row cap, and real dataset counts for all current eligible brands.

- [ ] **Step 2: Run RED**

Run: `npx vitest run __tests__/drinkBrandLanding.test.ts`

Expected: FAIL because `@/lib/drinkBrandLanding` does not exist.

- [ ] **Step 3: Implement pure selection model**

```ts
export const DRINK_BRAND_LANDING_PUBLICATION_FLOOR = 20;
export const DRINK_BRAND_LANDING_ROW_LIMIT = 20;

export function buildDrinkBrandLanding(
  slug: string,
  venues: readonly Venue[],
  options: { publicationFloor?: number; rowLimit?: number } = {},
): DrinkBrandLanding | null;

export function listDrinkBrandLandings(
  venues: readonly Venue[],
): DrinkBrandLanding[];
```

Choose the cheapest valid matching row per Venue. Break an equal row-price tie by `app_price_id`, then `pint_name`. Rank Venue rows by price, name, then ID. Return `collectedAt: PINT_DATASET_OBSERVED_AT.toISOString()`.

- [ ] **Step 4: Add one shared fail-loud cached data reader**

```ts
export const loadPintPriceLandingVenues = cache(async (): Promise<Venue[]> => {
  const rows = JSON.parse(await fs.readFile(file, "utf8"));
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("price landing: Pint Price dataset is empty or malformed");
  const venues = groupVenuePrices(rows as VenuePrice[]);
  if (venues.length === 0) throw new Error("price landing: grouped Venue set is empty");
  return venues;
});
```

Move Night Area loading to this reader. Register only this shared reader in one runtime data pack so import-graph discovery carries both route families and sitemap.

- [ ] **Step 5: Verify GREEN and tracing**

Run: `npx vitest run __tests__/drinkBrandLanding.test.ts __tests__/nightAreaLanding.test.ts __tests__/nightAreaLandingPage.test.ts __tests__/venueIndexTracing.test.ts`

Expected: PASS with real current brand counts `347`, `148`, `114`, `121`, `210`, `82`, `30`, and `95` in registered brand order.

- [ ] **Step 6: Commit Task 1**

```bash
git add __tests__/drinkBrandLanding.test.ts __tests__/venueIndexTracing.test.ts lib/drinkBrandLanding.ts lib/pintPriceLandingDataset.server.ts lib/nightAreaLanding.server.ts lib/venueIndexTracing.mjs
git commit -m "feat: govern drink brand price landings"
```

### Task 2: Mobile Brand Page, Metadata, and Open Graph

**Files:**
- Create: `__tests__/drinkBrandLandingPage.test.ts`
- Create: `components/drinks/DrinkBrandLandingContent.tsx`
- Create: `lib/drinkBrandLanding.server.ts`
- Create: `app/drink/[slug]/page.tsx`
- Create: `app/drink/[slug]/drink.css`
- Create: `app/drink/[slug]/opengraph-image.tsx`

**Interfaces:**
- Consumes: Task 1 `DrinkBrandLanding`, `buildDrinkBrandLanding`, `listDrinkBrandLandings`, `loadPintPriceLandingVenues`.
- Produces: `loadDrinkBrandLanding(slug)`, `loadDrinkBrandLandings()`, `drinkBrandLandingJsonLd(model)`, static page route, metadata, and Open Graph image.

- [ ] **Step 1: Write failing page tests**

```ts
expect(await generateStaticParams()).toEqual([
  { slug: "guinness" },
  { slug: "neck-oil" },
  { slug: "estrella" },
  { slug: "peroni" },
  { slug: "amstel" },
  { slug: "madri" },
  { slug: "camden-hells" },
  { slug: "birra-moretti" },
]);
expect(html).toContain("Cheapest Guinness Pints in London");
expect(html).toContain("From £3.09");
expect(html).toContain('href="/map?drink=beer&amp;brand=guinness"');
expect(html).toContain('href="/map?drink=beer&amp;brand=guinness&amp;log=1"');
expect(html.match(/Collected 3 July 2026\./g)).toHaveLength(1);
```

Also assert 20 semantic list rows, exact publisher links, `Publisher not recorded`, Ledger links, canonical metadata, two JSON-LD types, and unknown-brand noindex plus 404.

- [ ] **Step 2: Run RED**

Run: `npx vitest run __tests__/drinkBrandLandingPage.test.ts`

Expected: FAIL because page and content modules do not exist.

- [ ] **Step 3: Implement server route and metadata**

```ts
export const revalidate = 86_400;
export const dynamicParams = false;

export async function generateStaticParams() {
  return (await loadDrinkBrandLandings()).map(({ slug }) => ({ slug }));
}
```

Implement `loadDrinkBrandLanding(slug)` and `loadDrinkBrandLandings()` in `lib/drinkBrandLanding.server.ts` by composing Task 1's shared Venue reader and pure model. Load one model once per request path, call `notFound()` for null, and publish canonical `/drink/{slug}` metadata. JSON-LD contains only `BreadcrumbList` and the rendered 20-row `ItemList`.

- [ ] **Step 4: Implement mobile-first content**

Use semantic `<header>`, `<section>`, and `<ol>`. Put `From {lowest listed price}` and both actions above the fold at 320, 390, and 430 px. Primary action is a button-shaped Link. Secondary contribution action is a text Link. Each row keeps rank and price visible, wraps Venue and publisher text, and gives Ledger navigation at least 44 px.

- [ ] **Step 5: Implement Open Graph image**

Use `CardShell`, `Wordmark`, `priceStamp`, and current brand model. Show brand, cheapest listed figure, priced Venue count, and `/drink/{slug}`. Do not label the shared date as a row date.

- [ ] **Step 6: Verify GREEN, voice, type, and focused lint**

Run: `npx vitest run __tests__/drinkBrandLanding.test.ts __tests__/drinkBrandLandingPage.test.ts __tests__/emDashLaw.test.ts __tests__/frictionVoice.test.ts __tests__/landingPriceHonesty.test.ts`

Run: `npm run typecheck`

Run: `npx eslint app/drink/'[slug]'/page.tsx app/drink/'[slug]'/opengraph-image.tsx components/drinks/DrinkBrandLandingContent.tsx lib/drinkBrandLanding.ts lib/pintPriceLandingDataset.server.ts`

- [ ] **Step 7: Commit Task 2**

```bash
git add __tests__/drinkBrandLandingPage.test.ts app/drink/'[slug]' components/drinks/DrinkBrandLandingContent.tsx lib/drinkBrandLanding.server.ts
git commit -m "feat: publish drink brand price pages"
```

### Task 3: Governed Sitemap Discovery

**Files:**
- Modify: `app/sitemap.ts`
- Modify: `__tests__/sitemap.test.ts`

**Interfaces:**
- Consumes: Task 2 `loadDrinkBrandLandings()` and each model's `slug`.
- Produces: exactly one weekly sitemap entry per current governed brand route.

- [ ] **Step 1: Write failing sitemap assertion**

```ts
expect(urls.filter((url) => url.startsWith(`${SITE}/drink/`))).toEqual([
  `${SITE}/drink/guinness`,
  `${SITE}/drink/neck-oil`,
  `${SITE}/drink/estrella`,
  `${SITE}/drink/peroni`,
  `${SITE}/drink/amstel`,
  `${SITE}/drink/madri`,
  `${SITE}/drink/camden-hells`,
  `${SITE}/drink/birra-moretti`,
]);
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run __tests__/sitemap.test.ts`

Expected: FAIL because no `/drink/` entries exist.

- [ ] **Step 3: Add landings to existing parallel sitemap load**

```ts
const [..., drinkBrandLandings] = await Promise.all([
  ...,
  loadDrinkBrandLandings(),
]);
for (const landing of drinkBrandLandings) {
  entries.push({
    url: `${SITE_URL}/drink/${landing.slug}`,
    lastModified: pricesModified,
    changeFrequency: "weekly",
    priority: 0.75,
  });
}
```

- [ ] **Step 4: Verify GREEN and tracing**

Run: `npx vitest run __tests__/sitemap.test.ts __tests__/venueIndexTracing.test.ts`

- [ ] **Step 5: Commit Task 3**

```bash
git add app/sitemap.ts __tests__/sitemap.test.ts
git commit -m "feat: index governed drink brand pages"
```

### Task 4: Browser Proof and Full Gate

**Files:**
- Create: `e2e/drink-brand-landing.spec.ts`
- Create: `docs/proof/drink-brand-landing/README.md`
- Create: `docs/proof/drink-brand-landing/guinness-390-light.png`
- Create: `docs/proof/drink-brand-landing/guinness-390-dark.png`
- Create: `docs/proof/drink-brand-landing/guinness-1440-light.png`

**Interfaces:**
- Consumes: `/drink/guinness`, `/drink/not-real`, Map deep link, contribution deep link.
- Produces: reproducible mobile and desktop acceptance evidence.

- [ ] **Step 1: Add browser acceptance test**

At 320x844, 390x844, and 430x932 with mobile and touch context, assert status 200, exact H1, above-fold `From £3.09`, 347-priced-Venue summary, both above-fold actions, 20 rows, first result `J.J. Moon's - JD Wetherspoon` at `£3.09`, one collection date, 20 publisher disclosures, 44 px targets, visible keyboard focus, no horizontal overflow, and no console or page errors. Click the primary route and prove active brand Map state, then Back restores `/drink/guinness`. Click the secondary route and prove Venue selection opens while `drink=beer`, `brand=guinness`, and `log=1` remain in the URL. Capture 390 px light and dark plus 1440x900 light. Assert `/drink/not-real` returns 404.

- [ ] **Step 2: Run focused browser proof**

Run: `npx playwright test e2e/drink-brand-landing.spec.ts --project=chromium --workers=1`

Expected: PASS and three controlled proof images.

- [ ] **Step 3: Review against current Web Interface Guidelines**

Check semantic navigation, focus visibility, 44 px targets, safe areas, no disabled zoom, no `transition: all`, `Intl` formatting, long Venue names, dark theme, and reduced motion. Fix every finding before proceeding.

- [ ] **Step 4: Run final verification**

Run: `npm run verify`

Run: `git diff --check`

Expected: all unit tests, lint, typecheck, coverage, audit, browser proof, and diff checks pass with no new warnings.

- [ ] **Step 5: Commit Task 4**

```bash
git add e2e/drink-brand-landing.spec.ts docs/proof/drink-brand-landing
git commit -m "test: prove drink brand landing journey"
```

## Plan Self-Review

- Spec coverage: every data, trust, route, mobile, search, and proof requirement maps to Tasks 1 through 4.
- Placeholder scan: no deferred behavior, TODO, or unnamed error path remains.
- Type consistency: `slug`, `brandLabel`, `collectedAt`, `totalPricedVenues`, `rows`, `publisher`, `loadDrinkBrandLanding`, and `loadDrinkBrandLandings` retain one spelling across tasks.
- Shared-file scan: Task 1 owns data and tracing; Task 2 owns page contracts; Task 3 consumes the loader in sitemap; Task 4 changes only browser proof and proof assets.
