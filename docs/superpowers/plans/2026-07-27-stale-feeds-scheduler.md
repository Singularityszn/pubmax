# Stale Feeds Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move cheapest-pint price refresh and Night Signal candidate ingestion onto existing Vercel cron plane without reporting fake freshness.

**Architecture:** Keep reviewed `night_signals` snapshot human-gated and describe it as episodic, while retaining existing daily Vercel candidate sweep. Add server-safe price-source collection seam shared with manual price script, then call it from authenticated Vercel cron route. Write `feed_freshness` only when collection yields valid rows, and overlay that stamp onto `price_updates`.

**Tech Stack:** Next.js App Router route handlers, TypeScript, Node ESM, Vitest, Vercel Cron, existing dual-backend freshness store.

## Global Constraints

- Use existing Vercel cron plane and shared `CRON_SECRET` auth.
- No-op price run must leave prior freshness stamp unchanged and log fetched-nothing result plainly.
- Reviewed Night Signal snapshot remains human-gated and gets no machine-cadence budget.
- Remove dead GitHub Actions schedules for these feeds.
- Do not touch freshness-audit tracing, map canvas, or Pint Index archive.
- Run `npm run verify` before completion.

---

### Task 1: Price cron regression seam

**Files:**
- Create: `__tests__/cronRefreshPricesRoute.test.ts`
- Create: `scripts/price_source_fetchers.mjs`
- Create: `scripts/price_source_fetchers.d.mts`
- Create: `lib/priceRefresh.server.ts`
- Modify: `scripts/refresh_prices.mjs`

**Interfaces:**
- Consumes: `isValidPriceUpdate(value, now)` from `lib/priceUpdates.ts`.
- Produces: `fetchPriceUpdates(deps?) -> Promise<{ updates, fetchedRows, droppedRows, sourcesChecked, failedSources }>` and shared `fetchFromSource(source)`.

- [ ] **Step 1: Write failing route tests**

Cover shared cron auth, success stamping, and no-op behavior. Seed old `price_updates` stamp, return zero rows from mocked collector, invoke route, then assert old stamp remains and warning includes fetched-nothing explanation.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/cronRefreshPricesRoute.test.ts`

Expected: FAIL because `app/api/cron/refresh-prices/route.ts` does not exist.

- [ ] **Step 3: Extract shared source stub and implement server collector**

Move current stub into `scripts/price_source_fetchers.mjs`:

```js
export async function fetchFromSource(source) {
  void source;
  return [];
}
```

Import it from manual script and server collector. Server collector filters `data/price_sources.json` to `first-party-official` and `open-data`, isolates each source failure so remaining sources still run, validates rows with `isValidPriceUpdate`, and returns counts, failures, plus valid rows.

- [ ] **Step 4: Run collector and existing price tests**

Run: `npm test -- __tests__/priceUpdates.test.ts`

Expected: PASS.

---

### Task 2: Authenticated Vercel price route with honest stamping

**Files:**
- Create: `app/api/cron/refresh-prices/route.ts`
- Modify: `__tests__/cronRefreshPricesRoute.test.ts`

**Interfaces:**
- Consumes: `assertCronRequest`, `fetchPriceUpdates`, `feedFreshnessStore`.
- Produces: authenticated `GET /api/cron/refresh-prices`.

- [ ] **Step 1: Implement minimum route**

On zero valid rows, return `200` with:

```ts
{ ok: true, feed: "price_updates", fetchedRows: 0, retrievedRows: 0, freshnessAdvanced: false }
```

Log that no rows were fetched and freshness stayed unchanged. On non-zero valid rows, stamp `price_updates` with current time and row count. Return `502` on collection failure and `503` on failed durable stamp.

- [ ] **Step 2: Run route tests to green**

Run: `npm test -- __tests__/cronRefreshPricesRoute.test.ts`

Expected: PASS.

---

### Task 3: Freshness overlay and truthful registry

**Files:**
- Modify: `lib/freshnessStoreOverlay.ts`
- Modify: `__tests__/freshnessRoute.test.ts`
- Modify: `data/freshness_registry.json`

**Interfaces:**
- Consumes: `feedFreshnessStore().read("price_updates")`.
- Produces: `price_updates` store stamp visible from `GET /api/freshness`.

- [ ] **Step 1: Add failing freshness route test**

Seed a `price_updates` memory stamp with literal `2026-07-27T07:00:00.000Z`, call `GET /api/freshness`, and assert returned `price_updates.observedAt` equals that stamp.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- __tests__/freshnessRoute.test.ts`

Expected: FAIL because overlay does not read `price_updates`.

- [ ] **Step 3: Add overlay mapping and revise registry**

Add `PRICE_UPDATES_FEED_KEY` and `PRICE_UPDATES_DATASET_ID` to overlay. Keep price feed weekly with 336-hour budget but point cadence and workflow at Vercel route. Change reviewed `night_signals` to `episodic`, set budget to `null`, and state that approved human publish is only advancement path. Keep daily candidate cron entry separate.

- [ ] **Step 4: Run freshness tests**

Run: `npm test -- __tests__/freshnessRoute.test.ts __tests__/freshness.test.ts __tests__/cronFreshnessAuditRoute.test.ts`

Expected: PASS.

---

### Task 4: Scheduler wiring, dead workflow retirement, and runbook

**Files:**
- Modify: `vercel.json`
- Delete: `.github/workflows/price-refresh.yml`
- Delete: `.github/workflows/night-signal-refresh.yml`
- Delete: `.github/workflows/night-signal-ingest.yml`
- Modify: `docs/CRON_PLANE_RUNBOOK.md`
- Modify: `docs/WAYFINDER_LIVE_DATA.md`

**Interfaces:**
- Produces: weekly Vercel cron call to `/api/cron/refresh-prices`; no GitHub workflow remains that claims these feeds are scheduled there.

- [ ] **Step 1: Add Vercel schedule**

Add `{ "path": "/api/cron/refresh-prices", "schedule": "0 7 * * 1" }`.

- [ ] **Step 2: Remove dead workflows**

Delete price refresh, reviewed Night Signal refresh, and duplicate Night Signal candidate ingestion workflows. Existing Vercel candidate route remains only machine schedule for Night Signals.

- [ ] **Step 3: Update canonical operational docs**

Explain two boundaries: price cron advances freshness only after valid rows are retrieved, while reviewed Night Signal snapshot advances only through approved human publication. Point exact schedule roster to `vercel.json`.

- [ ] **Step 4: Run focused scheduler suite**

Run: `npm test -- __tests__/cronRefreshPricesRoute.test.ts __tests__/cronRefreshNightSignalsRoute.test.ts __tests__/cronAuth.test.ts __tests__/freshnessRoute.test.ts __tests__/freshness.test.ts`

Expected: PASS.

---

### Task 5: Verify, review, and commit

**Files:**
- Review all modified files.

**Interfaces:**
- Produces: committed branch ready for firstmate validation.

- [ ] **Step 1: Run full gate**

Run: `npm run verify`

Expected: PASS, including validation, lint, typecheck, coverage, and audit.

- [ ] **Step 2: Review working tree**

Run: `git diff --check`, `git status --short`, and inspect `git diff`. Confirm no freshness-audit tracing, map canvas, Pint Index, generated changelog, `next-env.d.ts`, or install-script churn changed.

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/refresh-prices/route.ts lib/priceRefresh.server.ts lib/freshnessStoreOverlay.ts scripts/price_source_fetchers.mjs scripts/price_source_fetchers.d.mts scripts/refresh_prices.mjs __tests__/cronRefreshPricesRoute.test.ts __tests__/freshnessRoute.test.ts data/freshness_registry.json vercel.json docs/CRON_PLANE_RUNBOOK.md docs/WAYFINDER_LIVE_DATA.md docs/superpowers/plans/2026-07-27-stale-feeds-scheduler.md .github/workflows/price-refresh.yml .github/workflows/night-signal-refresh.yml .github/workflows/night-signal-ingest.yml
git commit -m "fix(cron): move stale feeds to Vercel scheduler"
```
