# Merge Order Matrix — 2026-07-18

Executable merge plan for the open PR queue. Generated for Sol to run top-to-bottom.

- **Base:** `origin/main` @ `eee4f5f1` ("docs: Cycle 5 PRD").
- **PRs analyzed:** 22 active (`#276`, `#295`–`#315`). Held/excluded from the order: `#263`, `#264` (drafts), `#229` (MapLibre 6 HOLD). `#263` also has a red check.
- **Method (mechanically honest, no checkouts):** each PR was first proven to merge cleanly onto `main` in isolation (`git merge-tree --write-tree origin/main <branch>`, all 22 = rc 0). Pairwise conflicts were then found by **sequential simulation**: build the in-memory merge commit of A onto main (`git commit-tree` over the merge-tree), then `git merge-tree --write-tree --name-only <mergeCommit(A)> <branch B>`. rc≠0 with a `CONFLICT (content)` line = a real overlapping-hunk conflict. "Same file, different hunk" merges clean and is flagged below only as a co-touch review note, not a conflict.
- **Stack note:** `#299`/`#300` branch off `feat/capacitor-ios-wrap` (`#295`), so their branches already contain `#295`. `#295` in isolation is clean against every other PR — the `#299` conflicts below are `#299`'s *own* edits, not `#295`'s.

---

## (a) Conflict matrix — only pairs that actually conflict

| Pair | Conflicting files | Nature |
|------|-------------------|--------|
| **#299 ↔ #301** | `components/plan/PlanCollaborationPanel.tsx`, `lib/analyticsEvents.ts` | Both add analytics event wiring to the same regions. |
| **#299 ↔ #312** | `components/plan/PlanCrew.tsx` | Both edit the crew panel (identity nudge vs. native prompt). |
| **#299 ↔ #313** | `app/layout.tsx` | Both inject into the root layout (A2HS provider vs. native routing). |
| **#307 ↔ #314** | `components/feed/FeedCard.tsx`, `components/share/ShareBar.tsx` | Feed-card slim vs. WhatsApp share artifacts, same rows. |

**4 conflicting pairs total.** `#299` is the hub (3 of the 4 edges). No pair is fundamentally incompatible — every conflict is overlapping edits that resolve by keeping both intents.

### Co-touch, but merges clean (ordering/review notes only — NOT conflicts)

| Pair | Shared file(s) | Why it still matters |
|------|----------------|----------------------|
| #297 ↔ #304 | `components/PubMapCanvas.tsx`, `app/globals.css`, `e2e/map-fallback.spec.ts` | Same MapLibre constructor path. Different hunks → clean, but land **#297 first** so #304's disclosure sits on the watchdog fix. |
| #306 ↔ #309 | `components/PubMap.tsx` | Both touch the map component in separable hunks. Land adjacent (#306 then #309); clean either way. |

> Every PR also touches `fable-implement-prd.md` (running log). merge-tree auto-resolves these across the whole queue — no prd.md conflict appears in the simulation — so it is not a blocker, just a known soft hotspot.

---

## (b) Recommended total order (one pass, minimizes manual resolution)

Rationale: land the entire non-conflicting bulk first (docs/data → test/fix → map fixes → taste/feature), then the two conflict clusters last so each collapses into **one** rebase. Because `#301`/`#312`/`#313` all land *before* `#299`, the hub's 3 conflict edges resolve in a **single** `#299` rebase rather than three. `#307` lands before `#314` so `#314` eats its one edge. Net manual work: **2 rebases, 4 files.**

| # | PR | Branch | Tier / why here |
|---|----|--------|-----------------|
| 1 | #310 | verify/e2e-overnight | Docs (e2e truth table). Zero risk. |
| 2 | #308 | data/borough-coverage | Data report. Zero code risk. |
| 3 | #315 | data/outer-london-osm | Data (+657 pubs). Prereq for the `perf/slim-borough-shards` follow-up lane. |
| 4 | #276 | feat/about-story | Standalone page. |
| 5 | #296 | fix/welcome-modal-once | Onboarding fix, isolated. |
| 6 | #298 | fix/e2e-sw-tile-delay | Test-only. |
| 7 | #297 | fix/map-webgl-fallback | Map fix. **Before #304** (shared constructor path). |
| 8 | #304 | taste/error-empty-states | Map disclosure. After #297. |
| 9 | #306 | perf/mobile-map-budget | Map perf. Adjacent to #309 (both PubMap.tsx). |
| 10 | #309 | feat/instant-answer | Near-me answer, PubMap.tsx. After #306. |
| 11 | #305 | taste/list-discipline | Taste, independent. |
| 12 | #311 | taste/header-consistency | Taste, independent. |
| 13 | #302 | feat/last-pint-guardian | Feature, independent. |
| 14 | #303 | feat/price-drops-v2 | Feature, independent. |
| 15 | #301 | feat/metrics-funnel | Analytics foundation. **Before #299** (owns analyticsEvents). |
| 16 | #312 | feat/identity-nudges | **Before #299** (shares PlanCrew). |
| 17 | #313 | feat/a2hs-flow | **Before #299** (shares layout). |
| 18 | #307 | taste/feed-card-slim | **Before #314** (shares ShareBar/FeedCard). |
| 19 | #314 | feat/whatsapp-share-artifacts | ⚠️ Rebase — conflict vs #307. |
| 20 | #295 | feat/capacitor-ios-wrap | Native stack base. Clean vs all; retarget #299/#300 to main after this lands. |
| 21 | #299 | feat/native-first-run | ⚠️ Rebase — conflict vs #301/#312/#313 (one pass). |
| 22 | #300 | feat/push-senders | Stack top. Clean once #295/#299 in. |

**Sanity check (sequential merge-tree in this exact order):** steps 1–18 all merge clean. First manual conflict at **step 19 (#314)**; second at **step 21 (#299)**; step 22 (#300) clean. No other conflicts surface. Matches the design — the only two stops are the two planned rebases.

---

## (c) Per-conflicting-PR rebase notes

- **#314** — after **#307** lands, re-merge main; expect conflict in `components/share/ShareBar.tsx` and `components/feed/FeedCard.tsx`. Take **#307's** slim single-action-row layout as the base, re-apply **#314's** WhatsApp share button/artifact into that row (keep both intents; #307 owns the card structure, #314 owns the share action).
- **#299** — after **#301, #312, #313** land, re-merge main (rebase the stack onto current main; retarget to `main`). Expect conflicts in 4 files:
  - `lib/analyticsEvents.ts` + `components/plan/PlanCollaborationPanel.tsx` — take **#301's** event definitions/funnel wiring, add #299's native-prompt events alongside.
  - `components/plan/PlanCrew.tsx` — keep **#312's** identity nudge, add #299's native push prompt (both hooks coexist).
  - `app/layout.tsx` — keep **#313's** A2HS provider, add #299's native first-run routing (both providers mount).
- **#295, #300** — no manual resolution expected (clean in the simulated order). #300 only needs the standard stack rebase after #295/#299 land.

---

## (d) Sol's execution checklist (top to bottom)

Merge each via the queue; for the two ⚠️ PRs, do the rebase note first, push, let CI go green, then merge.

- [ ] 1. Merge **#310** (verify/e2e-overnight)
- [ ] 2. Merge **#308** (data/borough-coverage)
- [ ] 3. Merge **#315** (data/outer-london-osm)
- [ ] 4. Merge **#276** (feat/about-story)
- [ ] 5. Merge **#296** (fix/welcome-modal-once)
- [ ] 6. Merge **#298** (fix/e2e-sw-tile-delay)
- [ ] 7. Merge **#297** (fix/map-webgl-fallback)
- [ ] 8. Merge **#304** (taste/error-empty-states)
- [ ] 9. Merge **#306** (perf/mobile-map-budget)
- [ ] 10. Merge **#309** (feat/instant-answer)
- [ ] 11. Merge **#305** (taste/list-discipline)
- [ ] 12. Merge **#311** (taste/header-consistency)
- [ ] 13. Merge **#302** (feat/last-pint-guardian)
- [ ] 14. Merge **#303** (feat/price-drops-v2)
- [ ] 15. Merge **#301** (feat/metrics-funnel)
- [ ] 16. Merge **#312** (feat/identity-nudges)
- [ ] 17. Merge **#313** (feat/a2hs-flow)
- [ ] 18. Merge **#307** (taste/feed-card-slim)
- [ ] 19. ⚠️ Rebase **#314** on main → resolve `ShareBar.tsx` + `FeedCard.tsx` (take #307's row, re-add #314's WhatsApp share) → push → merge
- [ ] 20. Merge **#295** (feat/capacitor-ios-wrap); retarget #299/#300 base to `main`
- [ ] 21. ⚠️ Rebase **#299** on main → resolve `analyticsEvents.ts`, `PlanCollaborationPanel.tsx`, `PlanCrew.tsx`, `layout.tsx` (keep #301/#312/#313, add native intents) → push → merge
- [ ] 22. Merge **#300** (feat/push-senders)

**Held (do not merge this round):** #263, #264 (drafts; #263 has a red check), #229 (MapLibre 6 HOLD).

**Follow-up unblocked by this queue:** `perf/slim-borough-shards` builds atop #315; post-#301 analytics wiring for #309/#312/#313 call sites is unblocked once #301 lands (step 15).
