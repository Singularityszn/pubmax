# Honest City Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make city coverage visible and truthful on `/choose-city`, with crawlable city-list structured data.

**Architecture:** Add one pure disclosure helper derived from `CityCapabilityProfile`. Render its output inside existing city links. Build JSON-LD from the same enabled city list and existing city URL helper.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS, Vitest

**Spec:** `docs/specs/2026-08-15-honest-city-coverage.md`

## Global Constraints

- `CityCapabilityProfile` remains the only capability authority.
- Do not touch Map, Near, Tonight, or Plan interaction code.
- Do not add a client fetch or import venue packs into the browser bundle.
- Use British spelling, PUBMAXX terms, no em dashes, and no exclamation marks.
- Preserve existing navigation and preferred-city behavior.

---

### Task 1: City coverage disclosure model

**Files:**

- Create: `lib/cityCoverageDisclosure.ts`
- Create: `__tests__/cityCoverageDisclosure.test.ts`

**Interfaces:**

- Consumes: `CityCapabilityProfile`, `CityConfig`, `cityMapShareUrl`
- Produces: `cityCoverageDisclosure(cityId)`, `cityCoverageItemList(cities)`

- [ ] **Step 1: Write failing branch tests**

```ts
expect(cityCoverageDisclosure("london")).toEqual({
  available: [
    "Listed pubs",
    "Dated Pint Prices",
    "Crawls",
    "Tonight",
    "Get home",
  ],
  needed: [],
});
expect(cityCoverageDisclosure("manchester")).toEqual({
  available: ["Listed pubs", "Crawls"],
  needed: ["Pint Prices"],
});
expect(cityCoverageDisclosure("bath")).toEqual({
  available: ["Listed pubs"],
  needed: ["Pint Prices", "Crawls"],
});
```

- [ ] **Step 2: Run test and confirm missing-module failure**

Run: `npm test -- __tests__/cityCoverageDisclosure.test.ts`
Expected: FAIL because `lib/cityCoverageDisclosure.ts` does not exist.

- [ ] **Step 3: Implement minimal pure derivation**

Use only `getCityCapabilityProfile`. Add labels when each capability is `available`; add Pint Prices and Crawls to `needed` when unavailable.

- [ ] **Step 4: Add and run JSON-LD behavior test**

Assert one `ListItem` per enabled city, positions starting at 1, London at `/map`, and Manchester at `/map/manchester`.

- [ ] **Step 5: Run focused model tests**

Run: `npm test -- __tests__/cityCoverageDisclosure.test.ts __tests__/cityCapabilities.test.ts`
Expected: PASS.

### Task 2: City chooser disclosure and SEO

**Files:**

- Modify: `components/city/CityChooser.tsx`
- Modify: `components/city/cityChooser.css`
- Modify: `app/choose-city/page.tsx`
- Create: `__tests__/cityChooserCoverage.test.ts`

**Interfaces:**

- Consumes: `cityCoverageDisclosure`, `cityCoverageItemList`
- Produces: visible available and needed lines, `ItemList` JSON-LD

- [ ] **Step 1: Write failing rendered-copy test**

Add an assertion that coverage derivation used by cards keeps Manchester unpriced and Bath without crawls. Add an assertion that chooser count copy comes from `cities.length`, not a fixed nine.

- [ ] **Step 2: Run focused test and confirm failure**

Run: `npm test -- __tests__/cityChooserCoverage.test.ts`
Expected: FAIL because chooser does not render coverage yet.

- [ ] **Step 3: Render coverage inside each existing city link**

Keep city name and tagline. Add one available line and one needs line only when needed is non-empty. Replace false price-aware and fixed-count copy.

- [ ] **Step 4: Add responsive coverage styles**

Use wrapping text, `min-width: 0`, existing colour tokens, and no new animation. Keep the whole card as one link.

- [ ] **Step 5: Add JSON-LD and honest metadata**

Render escaped `ItemList` JSON-LD in `app/choose-city/page.tsx`. Metadata must say London has dated Pint Prices and other guides disclose missing coverage.

- [ ] **Step 6: Run focused verification**

Run: `npm test -- __tests__/cityChooserCoverage.test.ts __tests__/cityCoverageDisclosure.test.ts __tests__/cityCapabilities.test.ts __tests__/cityChooserSearch.test.ts __tests__/sitemap.test.ts __tests__/emDashLaw.test.ts`
Expected: PASS.

- [ ] **Step 7: Run static checks**

Run: `npm run lint && npm run typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit the slice**

```bash
git add docs/specs/2026-08-15-honest-city-coverage.md docs/superpowers/plans/2026-08-15-honest-city-coverage.md lib/cityCoverageDisclosure.ts __tests__/cityCoverageDisclosure.test.ts __tests__/cityChooserCoverage.test.ts components/city/CityChooser.tsx components/city/cityChooser.css app/choose-city/page.tsx
git commit -m "feat: show honest city coverage"
```
