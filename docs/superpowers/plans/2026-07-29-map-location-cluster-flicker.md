# Map Location Cluster Flicker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep desktop price-band donut clusters stable after granted geolocation moves the map outside London.

**Architecture:** Preserve donut markers across transient empty `querySourceFeatures` snapshots emitted by MapLibre render ticks. Treat settled map events as authoritative for an actually empty cluster view, so panning or zooming can still return cleanly to the permanent MapLibre cluster layers.

**Tech Stack:** Next.js 16, React 19, TypeScript, MapLibre GL, Vitest, Playwright

## Global Constraints

- Reproduce before changing implementation.
- Do not change map density, cluster zooms, cluster radius, or symbol collision policy.
- Preserve accessible in-view venue navigation, drawer focus trap, and existing contrast.
- Do not redesign basemap or bundle dependency changes.
- Use a desktop 1600 by 1000 viewport, granted geolocation, Manchester position, and suppressed tours for browser evidence.
- Record trigger, masking condition, visible symptom, counterfactual, falsifier, and pre-MapLibre-6 comparison.

---

### Task 1: Lock Browser Reproduction

**Files:**

- Modify: `e2e/map-gl.spec.ts`

**Interfaces:**

- Consumes: `/map`, `/map/manchester`, `CitySuggestBanner` granted-permission reuse, `.donut-cluster-marker`, and `Show all of Manchester`
- Produces: Playwright regression proving active donut clusters never disappear during a settled city-cluster observation window

- [ ] **Step 1: Add failing location-to-cluster regression**

Add a Playwright test that:

```ts
test("desktop clusters stay stable after granted location moves outside London", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await context.setGeolocation({ latitude: 53.4808, longitude: -2.2426 });
  await context.grantPermissions(["geolocation"], {
    origin: new URL(page.url() || "http://localhost:3000").origin,
  });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await page.goto("/map");
  await page.locator('a.citySuggestBannerSwitch[href="/map/manchester"]').dispatchEvent("click");
  await page.waitForURL("**/map/manchester");
  await page.getByRole("button", { name: "Show all of Manchester" }).click();
  await expect.poll(() => page.locator(".donut-cluster-marker").count()).toBeGreaterThan(0);

  const disappeared = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const container = document.querySelector(".maplibre-map");
        let vanished = false;
        const observer = new MutationObserver(() => {
          if (document.querySelectorAll(".donut-cluster-marker").length === 0) vanished = true;
        });
        observer.observe(container ?? document.body, { childList: true, subtree: true });
        window.setTimeout(() => {
          observer.disconnect();
          resolve(vanished);
        }, 2_000);
      }),
  );
  expect(disappeared).toBe(false);
});
```

Adapt only selectors already shipped by the map if the exact container class differs.

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
npx playwright test e2e/map-gl.spec.ts --grep "desktop clusters stay stable"
```

Expected: failure because `.donut-cluster-marker` count reaches zero after first becoming non-zero while the legacy grey cluster layers reappear.

- [ ] **Step 3: Commit failing regression**

```bash
git add e2e/map-gl.spec.ts
git commit -m "test(map): reproduce location cluster flicker"
```

### Task 2: Preserve Active Donuts Across Render Gaps

**Files:**

- Modify: `components/map/canvas/donutClusters.ts`
- Modify: `__tests__/canvas-donutClusters.test.ts`

**Interfaces:**

- Consumes: MapLibre `render`, `moveend`, and `sourcedata` events plus current cluster marker map
- Produces: reason-aware sync where render ticks may update from non-empty snapshots but cannot authoritatively deactivate an active donut set

- [ ] **Step 1: Add failing unit regression**

Extend fake-map coverage so a non-empty render creates an active set, a following empty render snapshot does not call the deactivation path, and an authoritative empty `moveend` does. Mock `maplibregl.Marker` only at its external DOM boundary, while assertions target shipped behavior: marker removal and legacy layer visibility.

- [ ] **Step 2: Run unit test and verify RED**

Run:

```bash
npm test -- __tests__/canvas-donutClusters.test.ts
```

Expected: failure because current `sync()` treats every empty render snapshot as authoritative and removes markers.

- [ ] **Step 3: Implement minimal reason-aware reconciliation**

Change the sync signature to carry whether an empty result is authoritative:

```ts
const sync = ({ emptyIsAuthoritative }: { emptyIsAuthoritative: boolean }) => {
  // existing guards and query
  if (byId.size === 0) {
    if (emptyIsAuthoritative) deactivate();
    return;
  }
  // existing non-empty reconciliation
};
```

Wire events as follows:

```ts
const syncFromRender = () => sync({ emptyIsAuthoritative: false });
const syncFromSettledMap = () => sync({ emptyIsAuthoritative: true });
```

Keep render throttling. Use non-authoritative sync for `render` and qualifying `sourcedata`. Use authoritative sync for `moveend`. Zoom at `CLUSTER_MAX_ZOOM + 1` remains an immediate authoritative deactivation in every path.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npm test -- __tests__/canvas-donutClusters.test.ts
npx playwright test e2e/map-gl.spec.ts --grep "desktop clusters stay stable"
```

Expected: both pass. Donut markers remain continuously present at Manchester city zoom.

- [ ] **Step 5: Commit fix**

```bash
git add components/map/canvas/donutClusters.ts __tests__/canvas-donutClusters.test.ts
git commit -m "fix(map): keep desktop clusters stable"
```

### Task 3: Verify History, Counterfactual, and Browser Evidence

**Files:**

- Modify only if test hardening is required: `e2e/map-gl.spec.ts`

**Interfaces:**

- Consumes: commits `cfed5e58`, `4d25088d`, `ba4b4e71`, and `7fbe9d46`
- Produces: final diagnosis report and before/after screenshots for PR body

- [ ] **Step 1: Compare pre-upgrade behavior**

Run same deterministic browser probe at `cfed5e58^` with its locked MapLibre dependency. Record whether active donuts ever reach zero after stabilising at Manchester city zoom.

- [ ] **Step 2: Rule out accessible-list feedback**

Run same probe at `4d25088d^` with MapLibre 6. Record whether flicker persists before in-view list work.

- [ ] **Step 3: Capture after evidence**

Capture browser screenshots to `/tmp`, move representative stable frames into local evidence storage, and confirm each file exists. Use 1600 by 1000 viewport, Manchester granted location, tours suppressed, and city-cluster zoom.

- [ ] **Step 4: Run project verification**

Run:

```bash
npm run lint
npm run typecheck
npm test -- __tests__/canvas-donutClusters.test.ts
npx playwright test e2e/map-gl.spec.ts --grep "desktop clusters stay stable"
npm run verify
```

- [ ] **Step 5: Review final diff and commit any test hardening**

Read changed files, confirm no density or collision constants changed, remove debug artifacts, and commit any coherent final adjustment.

