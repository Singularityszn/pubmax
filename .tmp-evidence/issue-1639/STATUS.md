# Issue review, 22 September 2026

Scope agreed with user: verify and fix unowned bugs and reliability issues. Preserve other harnesses' work. New features require a separate decision.

## GitHub inventory

Reviewed 38 open issues and eight open PRs. Snapshot changes as other harnesses publish work.

- PR 1758 covers issues 1744 and 1745. Keep with its existing owner.
- PR 1741 fixes price correctness. Review through its existing owner.
- Issue 1639: user approved “Other pubs may qualify; we haven’t checked them yet.” Implemented here.
- Issue 1641: unpublished fix already exists as commit 05fdc824851ec9f72175fa8e58ae69941f960aeb, branch codex/query-navigation-warming. Query preservation, 128-entry bounded history, tests and measurement evidence. Both known checkouts dormant since September 12; no active owner found in recent Codex tasks or processes. No recovery performed here.
- Issue 1646: duplicate Bar Tab and Ledger venue readers remain; no open PR overlaps. Lower priority than reproduced bugs.
- Issue 1615: performance-gate reliability needs quiet A/B measurements. Do not relax ceilings.
- Issue 1618: maintainer comment says acceptance delivered; candidate for closure after checking referenced deliverables.
- Native issues 1531 and 1533-1544 need fresh native reproduction. Browser results cannot clear native reports.
- Harvest PRs 1755, 1757 and 1747 overlap code/data. PR 1751 overlaps landing/plan/social CSS. Preserve owners and settle ordering before new work in those areas.

## Computer Use observations

Production https://pubmaxxing.com, 390x844 browser viewport:

- Map rendered with controls and pins.
- On tonight opened and settled to 95 deals and 35 events. Ordinary opening did not reproduce issue 1537.
- Arnos Arms venue sheet scrolled to its final controls, entirely above Make it Stop 1 / Share. Issue 1533's large lower gap was not reproduced on mobile web. Native shells and other states remain unverified.
- Planner content scrolled; fields below the initial fold remained reachable.
- Desktop signed-out Social rendered “Sign in to use Social.” Authenticated/native issue 1541 remains unverified.
- Desktop Plan an outing > Step-free entry reproduced issue 1639: summary omitted the unchecked-pubs clarification.

## Fix 1639

Base: origin/main 7811567a1. Isolated branch codex/issue-1639-accessibility-copy.

Only intended files: lib/venueAccessibility.ts, __tests__/venueAccessibility.test.ts, lib/AGENTS.md.

- Three new facet cases failed before production change with the missing sentence.
- After change, 103 tests passed across venueAccessibility and venueTruth, including the no-filter and filter predicates.
- Focused ESLint passed. Independent Sol review: no findings.
- Local browser verification blocked by current main's instrumentation import: @arizeai/openinference-instrumentation-openai -> @opentelemetry/instrumentation -> Cannot resolve path. Fresh npm ci reproduced it. No Arize source changed here.
- Full npm run verify started. Final result must be added before claiming completion.

No merge or deployment performed. No issue closed. Original query-navigation and half-pin worktrees preserved.
