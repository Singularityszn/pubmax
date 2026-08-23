# Remaining Issues Burndown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven development task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every issue whose acceptance criteria can be satisfied in code, and record explicit owner or post-London gates for issues that cannot be closed honestly.

**Architecture:** Four independent slices keep review and rollback boundaries small. Admin moderation uses the existing community-price moderation API. Night Area activation uses the existing Night Area model and planner handoff. Repository health adds machine-checked inventory and diff-scope policy without changing stores. Release ledger work records external gates without claiming they are complete.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Playwright, GitHub Actions, Supabase-backed APIs.

**Spec:** GitHub issues #1043, #727, #252, #1048, #443, #437, #392, #390, #385, #384, #287, and #282.

## Global Constraints

- Preserve the dirty `/Users/karanmanoharan/Documents/pubmax` worktree.
- Start each slice from fetched `origin/main` in its own worktree.
- Write and run a failing regression test before production code.
- Use existing moderation, Night Area, and store contracts. Do not add parallel abstractions.
- Keep owner credentials out of source, logs, comments, and screenshots.
- Merge only exact reviewed commit heads.

---

### Task 1: Community-price moderation UI

**Files:**
- Modify: `app/admin/AdminClient.tsx`
- Create: `__tests__/adminCommunityPriceModeration.test.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/community-prices`, `POST /api/admin/community-prices`, existing admin session fetch helper, and existing route DTOs.
- Produces: reported and hidden Community Price queues with hide and restore actions.

- [ ] **Step 1: Write failing DOM tests**

Test reported and hidden queue rendering, correct hide/restore request bodies, loading state, empty state, and non-destructive error recovery.

- [ ] **Step 2: Run RED test**

Run: `npx vitest run __tests__/adminCommunityPriceModeration.test.tsx`

Expected: FAIL because `AdminClient` does not fetch or render Community Price moderation.

- [ ] **Step 3: Implement queue**

Reuse existing admin state and authenticated fetch patterns. Keep Community Prices separate from Pint Drops and Visit Reports. Refresh only the affected queue after hide or restore.

- [ ] **Step 4: Run GREEN checks**

Run: `npx vitest run __tests__/adminCommunityPriceModeration.test.tsx __tests__/communityPriceModeration.test.ts`

Run: `npm run typecheck`

- [ ] **Step 5: Commit and open PR**

Commit: `feat: add community price moderation queue`

---

### Task 2: Night Area activation surface

**Files:**
- Create: `app/area/[slug]/page.tsx`
- Create: `app/area/[slug]/nightAreaActivation.css`
- Create: `lib/nightAreaActivation.ts`
- Create: `__tests__/nightAreaActivation.test.ts`
- Create: `e2e/night-area-activation.spec.ts`

**Interfaces:**
- Consumes: `lib/nightAreas.ts`, existing Night Area API, Map deep links, and planner handoff contracts.
- Produces: ready-area Plan action and unready or unknown browse-only Map action.

- [ ] **Step 1: Write failing route and viewport tests**

Cover ready, unready, unknown, and cross-city inputs. At 390px, verify one primary action, browser Back behavior, keyboard focus, and reduced-motion compatibility.

- [ ] **Step 2: Run RED tests**

Run: `npx vitest run __tests__/nightAreaActivation.test.ts`

Expected: FAIL because no dedicated Night Area route exists.

- [ ] **Step 3: Implement activation route**

Render current Night Area evidence. Ready areas hand off to Plan with canonical intent. Unready and unknown areas remain honest and hand off to Map. Reject cross-city data and fail closed.

- [ ] **Step 4: Run GREEN checks**

Run: `npx vitest run __tests__/nightAreaActivation.test.ts`

Run: `npx playwright test e2e/night-area-coverage.spec.ts --project=chromium`

Run: `npx playwright test e2e/night-area-activation.spec.ts --project=chromium`

Run: `npm run typecheck`

- [ ] **Step 5: Commit and open PR**

Commit: `feat: add night area activation surface`

---

### Task 3: Store inventory and review-scope guards

**Files:**
- Modify: `docs/STORE_BACKEND_INVENTORY.md`
- Create: `scripts/check_review_scope.mjs`
- Create: `__tests__/storeBackendInventory.test.ts`
- Create: `__tests__/reviewScopeGuard.test.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: current `lib/*Store.ts` file inventory and PR base/head SHAs.
- Produces: deterministic inventory drift failure, changed-file category summary, large-review warning, and generated or skill-pack leakage failure.

- [ ] **Step 1: Write failing inventory and scope tests**

Inventory test compares documented store names and exceptions with repository files. Scope tests supply fixed file lists and assert category output, warning above two domains or 150 files, and hard failure for generated or skill-pack paths.

- [ ] **Step 2: Run RED tests**

Run: `npx vitest run __tests__/storeBackendInventory.test.ts __tests__/reviewScopeGuard.test.ts`

Expected: FAIL because inventory is stale and scope checker is absent.

- [ ] **Step 3: Implement deterministic guards**

Use dependency-free Node code. In CI, compute changed files from GitHub base and head SHAs. Do not block legitimate large reviews unless a forbidden path is present.

- [ ] **Step 4: Run GREEN checks**

Run: `npx vitest run __tests__/storeBackendInventory.test.ts __tests__/reviewScopeGuard.test.ts __tests__/storeBackend.test.ts`

Run: `npm run lint -- --quiet`

- [ ] **Step 5: Commit and open PR**

Commit: `ci: add store inventory and review scope guards`

---

### Task 4: Issue resolution and release evidence

**Files:**
- Modify only current release or owner-gate documentation that contains stale claims.

**Interfaces:**
- Consumes: exact merged main SHA, Vercel deployment evidence, production API responses, and GitHub issue acceptance criteria.
- Produces: one dated release ledger that separates code-complete, owner-action, and deferred milestones.

- [ ] **Step 1: Verify code-complete issue evidence**

Confirm #385 Ticketmaster production response and current data. Confirm #1048 performance-budget acceptance. Confirm no open PRs were omitted.

- [ ] **Step 2: Record unresolved gates**

Record native signing and device evidence for #443/#437/#390, Search Console and Bing evidence for #392, post-London scope for #287/#282, and remaining product scope for #252.

- [ ] **Step 3: Resolve issue trackers**

Close #385 as completed. Close #384 as superseded without a launch-ready claim. Update other issues with exact completed work and remaining acceptance. Close #1043 and #727 only after their code PRs merge and acceptance matches.

- [ ] **Step 4: Review and merge exact heads**

For each PR, run independent standards and specification review. Fix all confirmed findings, rerun focused gates, and merge the reviewed commit SHA.

- [ ] **Step 5: Promote and smoke**

Build a clean Vercel preview from merged `main`, smoke affected routes, then promote that exact deployment. Confirm `/api/version` matches merged `main`.
