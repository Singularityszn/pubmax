# Trusted Pint-to-Crew DAG handoff — 2026-07-24

Sol coordination stopped by owner directive. L04/L13/L17/L18 workers were stopped or allowed to exit. No further model dispatch is authorized from this session.

## Repository state

- Handoff branch: `docs/dag-handoff`
- Branch base at creation: `origin/main` `bd01cc5dab8c5835b96ca39ffbfcf7f45ecc4f05` (`#577`, L04 squash merge)
- Foundation already on main: L00, L01, L05A, L02, L03.
- Existing owner changes remain untouched:
  - `skills/emil-design-eng/SKILL.md`
  - `skills/review-animations/SKILL.md`
  - `skills/review-animations/STANDARDS.md`
  - existing untracked planning/checkpoint docs
- Host disk was at 100% capacity with about 573 MiB free. L04 final CI failed with `ENOSPC`. Generated `.next*`, `coverage`, and `test-results` directories were inspected but not deleted after owner limited work to this handoff.

## Lane state

### L04 — Draft arbitration and migration

- **Status:** merged, but local final-gate evidence is incomplete because disk exhaustion interrupted the last CI run.
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-plan-draft-arbitration`
- **Branch:** `feat/plan-draft-arbitration`
- **Lane commit:** `8054ec5d536a47c2f4c6416126b5916fe5a0bced`
- **Main squash:** `bd01cc5dab8c5835b96ca39ffbfcf7f45ecc4f05` via `#577`
- **Worktree state:** clean at inspection; remote ref `origin/feat/plan-draft-arbitration` exists.
- **Evidence seen:** focused 72/72, TypeScript and scoped ESLint passed; earlier full CI reported 5,433 tests and 456/456 build pages. Final hardened CI hit `ENOSPC`.
- **Remaining:** supervisor should decide whether merged result needs a clean-disk rerun of exact CI plus browser proof and an independent verifier/reviewer receipt.
- **Gotcha:** worker reported failed restoration of `next-env.d.ts`, but later Git inspection showed a clean committed worktree. Recheck tracked Next-managed files after disk cleanup rather than trusting either signal alone.

### L05 — Map intent, history, onboarding, and modal safety

- **Status:** not started; pre-staged clean worktree only.
- **Worktree found:** `/Users/karanmanoharan/Documents/pubmax-wt-map-intent`
- **Actual branch found:** `feat/map-intent-history`
- **Planned branch:** `fix/map-intent-history-onboarding`
- **HEAD:** `e6df9b50568e8c32bee0ea8094adcaf90601a18c`; no lane commit or working-tree changes.
- **Remaining:** full explicit-intent URL/history state machine, `q` preservation, onboarding/modal collision safety, typed selection origin, **Make it Stop 1**, focus restoration, desktop rail preservation, deterministic tests, two-viewport browser proof, verifier, reviewer, and `RR-L05`.
- **Gotcha:** branch/path differ from plan. Rebase or recreate from current main and preserve merged L05A sheet geometry. Do not proceed until exact S04/S02 integration base is chosen.

### L06 — Explicit Venue acceptance continuity

- **Status:** in progress, uncommitted, no test or review receipt.
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-venue-acceptance`
- **Branch:** `feat/venue-acceptance-continuity`
- **HEAD/base:** `e6df9b50568e8c32bee0ea8094adcaf90601a18c`
- **Working changes:** `components/nearme/NearMeNow.tsx`, `lib/venueMapUrl.ts`, new `lib/venueAcceptance.ts`.
- **Remaining:** finish browse-versus-accept separation, `accept=1&src=near`, intent/evidence receipt, storage-failure fallback, deterministic and browser tests, local commit, verifier, reviewer, and `RR-L06`.
- **Gotcha:** L06 depends on S05, but L05 is not complete. Preserve these edits before any rebase and do not integrate them ahead of reviewed L05.

### L07 — Canonical anchor and proof V2

- **Status:** in progress, uncommitted local edit; work appears to have been started by another lane/fleet.
- **Worktree found:** `/Users/karanmanoharan/Documents/pubmax-wt-canonical-anchor`
- **Actual branch:** `feat/canonical-anchor-proof`
- **Planned branch:** `feat/planning-anchor-proof-v2`
- **HEAD/base:** `bd01cc5dab8c5835b96ca39ffbfcf7f45ecc4f05`
- **Working change:** `lib/planGrounding.server.ts` (+5 lines at inspection).
- **Remaining:** canonical resolver/API, V2 proof signing and verification, exact Stop order, anchor/source/outcome claims, V1 compatibility, conflict-code matrix, tamper/expiry/replay tests, browser preflight proof, commit, verifier, reviewer, and `RR-L07`.
- **Gotcha:** branch/path differ from plan and ownership may overlap another fleet. Confirm owner before editing.

### L08 — Anchored generation

- **Status:** not started.
- **Planned worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-anchored-plan-generation`
- **Branch:** `feat/anchored-plan-generation`
- **Remaining:** after S07, add anchor preflight, constrained permutations, exact route/anchor-only/conflict DTOs, companion fallback, optimizer tests, fixed browser fixture, verifier, reviewer, and `RR-L08`.
- **Gotcha:** do not create durable Plans or UI here; every successful anchored result must carry valid V2 proof.

### L09 — Grounded one-Stop Plan lifecycle

- **Status:** not started.
- **Planned worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-one-stop-plan-lifecycle`
- **Branch:** `feat/one-stop-plan-lifecycle`
- **Remaining:** after S02/S07/S08, persist anchor/proof metadata, one-Stop draft, atomic same-ID one-to-three upgrade, immutable `routeReadyAt`, idempotent acceptance, migrations/RPC, browser lifecycle proof, verifier, reviewer, and `RR-L09`.
- **Gotcha:** one Stop must never emit `plan_accepted`; first valid three-Stop transition emits once.

### L10 — Server-enforced Friend privacy

- **Status:** not started.
- **Planned worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-friend-plan-privacy`
- **Branch:** `fix/friend-plan-privacy-boundary`
- **Remaining:** after S09, add preview DTO, capability-aware reads, safe metadata/OG/get-in/recap, post-join rehydration, capability matrix, anonymous response scans, browser proof, verifier, reviewer, privacy receipt, and `RR-L10`.
- **Gotcha:** any pre-join Venue/Route leak blocks every later lane. Rollback must stay preview-only, never restore anonymous full state.

### L11 — Anchored Plan client, context, templates, and date

- **Status:** not started.
- **Planned worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-anchored-plan-client`
- **Branch:** `feat/anchored-plan-client`
- **Remaining:** after S04/S06/S08/S09/S10, hydrate through arbitration before defaults, show accepted summary, skip answered area/date, support one-Stop lock/conflict/removal, repair template geography/date labels, browser request-count proof, verifier, reviewer, and `RR-L11`.
- **Gotcha:** preserve shipped Plan CTA accent tokens; no default write may precede arbitration.

### L12 — Map-generated Route transfer

- **Status:** not started.
- **Planned worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-map-route-plan-transfer`
- **Branch:** `feat/map-route-plan-transfer`
- **Remaining:** after S04/S08/S11, transfer exact Route draft without regeneration, including Stops, alternatives, anchor, Night Context, totals, proof metadata, operation key and origin; add zero-generation-request browser proof, verifier, reviewer, and `RR-L12`.
- **Gotcha:** consume L04 parser and L11 Plan client; do not edit them or expose secret proof values in receipts.

### L13 — Tonight freshness contract

- **Status:** implementation commit present; worker stopped before independent verification/review receipt.
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-tonight-freshness`
- **Branch:** `fix/tonight-freshness-contract`
- **Commit:** `24347971cd492b3df4634d738b0c76be3487bf1b`
- **Parent/base:** `e6df9b50568e8c32bee0ea8094adcaf90601a18c`
- **Worktree state:** clean at inspection.
- **Changed implementation area:** freshness/store/handler/API/cron plus unit and Tonight E2E tests; eight files were modified before commit.
- **Remaining:** inspect commit, rerun frozen-clock boundary matrix, exact CI/build/audit, verify group-before-limit/provider-limit behavior, browser proof that unknown freshness never becomes request time, independent verifier/reviewer, and `RR-L13`.
- **Gotcha:** no reliable final test receipt survived worker shutdown. Preserve shipped `lib/tonightListGrouping.ts`; L13 must wire canonical grouping before final limit without creating parallel grouping. Decide whether to rebase onto current main before verification.

### L14 — Tonight grouping and locality model

- **Status:** not started.
- **Planned worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-tonight-grouping-locality`
- **Branch:** `feat/tonight-grouping-locality`
- **Remaining:** after reviewed S13, harden existing `lib/tonightListGrouping.ts` with normalized schedule, source/schedule separation, locality, diversity, stable ordering, alternates-once tests, 60-row fixture, browser proof, verifier, reviewer, and `RR-L14`.
- **Gotcha:** never create parallel grouping. Rerun L13 pipeline tests after every grouping change; safe-off retains shipped chain collapse.

### L15 — Tonight trusted UI and acceptance

- **Status:** not started.
- **Planned worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-tonight-trusted-ui`
- **Branch:** `feat/tonight-trusted-ui`
- **Remaining:** after S05/S06/S14, consume server groups, retain grouped-card expander/facets, show honest freshness/locality, add **Use this Venue**, contrast and exact-order browser proof, verifier, reviewer, and `RR-L15`.
- **Gotcha:** do not move grouping authority back to client or conflate raw inventory count with grouped-card count.

### L16 — Narrow Pub Pal locality and handoff

- **Status:** not started.
- **Planned worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-pal-locality-handoff`
- **Branch:** `fix/pal-locality-handoff`
- **Remaining:** after S06/S14/S15, enforce explicit-query area precedence, remembered fallback, honest London-wide copy, provenance/distance evidence, Pal-local back path and acceptance action; add precedence/browser tests, verifier, reviewer, and `RR-L16`.
- **Gotcha:** preserve existing `SiteNavMore`/keyboard behavior and do not expand Pal scope.

### L17 — Map search no-results

- **Status:** in progress, uncommitted; worker killed by owner directive.
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-map-search-no-results`
- **Branch:** `fix/map-search-no-results`
- **HEAD/base:** `e6df9b50568e8c32bee0ea8094adcaf90601a18c`
- **Working changes:** `components/map/MapSearchSuggest.tsx`, `components/map/mapSearchSuggest.css`, `__tests__/mapSearchSuggest.test.ts`, new `e2e/map-search-no-results.spec.ts`.
- **Remaining:** inspect partial diff, finish persistent listbox/polite single announcement/clear/examples/no-query analytics, run deterministic keyboard cases and both-viewports browser proof, commit, verifier, reviewer, and `RR-L17`.
- **Gotcha:** no trustworthy test receipt or commit exists. Preserve work before rebase; keep scope out of Map history, canvas, and ranking.

### L18 — Map renderer and console health

- **Status:** in progress, uncommitted; worker killed by owner directive.
- **Worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-map-render-console-health`
- **Branch:** `fix/map-render-console-health`
- **HEAD/base:** `e6df9b50568e8c32bee0ea8094adcaf90601a18c`
- **Working changes:** `components/map/canvas/filters.ts`, `__tests__/canvas-filters.test.ts`, `e2e/map-console-health.spec.ts`.
- **Remaining:** inspect partial expression rewrite, prove top-level zoom interpolation and selected multiplier outputs, run exact L01 smoke/GL/no-GL gates under SwiftShader and no-WebGL, enforce narrow console allowlist/repeated-request bound, commit, verifier, reviewer, and `RR-L18`.
- **Gotcha:** generated `.next-l18-browser*` and `test-results` exist, but worker shutdown produced no reliable receipt. Disk cleanup is required before trustworthy reruns. Keep L17 search and L05 history out of scope.

### L19 — Landing Find my pint hierarchy

- **Status:** not started.
- **Planned worktree:** `/Users/karanmanoharan/Documents/pubmax-wt-landing-find-my-pint`
- **Branch:** `feat/landing-find-my-pint`
- **Remaining:** after S06/S11, make one dominant CTA, retain Map secondary and lower-weight direct Plan, remove equal-weight mobile duplicates, prove above-fold light/dark/reduced-motion layouts and contrast, run verifier/reviewer, and issue `RR-L19`.
- **Gotcha:** preserve current `components/landing/PintDropStrip.tsx` and its eight-second empty/hung fail-soft path.

## Resume order

1. Free generated build/test space without deleting source or uncommitted lane work.
2. Re-fetch `origin/main` and record exact tip before touching any lane.
3. Resolve ownership for already-dirty L06 and L07 worktrees.
4. Reconcile merged L04 evidence if supervisor requires a clean-disk receipt.
5. Verify/review L13 commit; inspect and finish L17/L18 partial work.
6. Continue remaining lanes strictly by dependencies in the implementation plan.

No deployment, production mutation, or feature-flag flip was performed by this session.
