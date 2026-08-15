# Review bloat and store-boundary reduction

Status: draft for Sol 5.6 high review
Owner: PubMaxx maintainers
Source: closed-PR review sweep, Greptile/CodeRabbit findings, issue #168

## Problem

The application has a deliberate memory/Supabase dual-backend seam, but the
implementation is repeated across roughly 25 `lib/*Store.ts` modules. The
current inventory has only two stores that match the small shared shape; most
stores carry bespoke schema fallback, rate limiting, cache invalidation, or
identity rules. Inline backend branchers also exist in feature modules. A blind
"one generic factory" rewrite would erase policy differences and increase risk.

Review automation also spends effort on oversized mixed-purpose changes. Recent
bot reports skipped or summarised changes above review limits, which means the
review record cannot prove that generated files, copy changes, migrations, and
runtime code received equal scrutiny.

## Goals

1. Remove only repeated plumbing with identical semantics.
2. Keep domain policy, authorization, RLS assumptions, freshness, and fallback
   behaviour explicit at each store boundary.
3. Make every backend choice and exception observable in tests.
4. Make future review slices small enough for all configured reviewers.

## Non-goals

- No universal CRUD abstraction.
- No migration of policy-heavy stores merely to reduce line count.
- No change to the memory fallback contract or production Supabase requirement.
- No generated-file or skill-pack cleanup in product commits.

## Proposed design

### 1. Inventory and classification

Create a machine-readable inventory of each store's interface, backend selector,
fallback mode, schema-missing behaviour, authorization owner, and reset helper.
Classify each module as `plain-dual-backend`, `policy-heavy`, `cache-backed`, or
`legacy-exception`. The inventory is the review artefact and becomes a test
fixture, not a runtime registry.

### 2. Narrow factory seam

Add one typed helper for the `plain-dual-backend` class only. It may select a
memory implementation or a Supabase implementation and expose the existing
`selectStore` semantics. It must not catch errors, infer table names, generate
queries, or decide authorization. Policy-heavy and cache-backed stores keep
their explicit selector and document why.

### 3. Incremental migration

Migrate two low-risk stores with equivalent memory/Supabase behaviour. For each
store, keep a before/after contract test that covers keyless reads, configured
reads, missing-schema behaviour, reset isolation, and production strictness.
Stop if the factory needs a store-specific flag or conditional; that is evidence
the store belongs in an exception class.

### 4. Review-scope guard

Add a CI report that records changed source, migration, generated, and evidence
files by category. Warn when one PR crosses two runtime domains or 150 files;
fail only when generated/skill-pack files are accidentally included. This is a
review-quality guard, not a code-quality suppression.

## Acceptance criteria

- Inventory covers every `lib/*Store.ts` and every inline `selectStore` or
  `isSupabaseConfigured` branch.
- Factory has no domain imports and is used by exactly two pilot stores.
- Pilot tests pass with and without Supabase configuration and preserve all
  current error/status semantics.
- An exception list names each store intentionally left explicit, with a
  reason and owner.
- CI emits the changed-file category report and catches generated/skill-pack
  leakage.
- `npm run lint`, scoped typecheck, `npm test`, and `npm run verify` remain
  green; no production route changes without a focused regression test.

## Rollback

Revert pilot-store adapter commits. The old selectors remain available until
the final migration ticket is explicitly accepted. The inventory and CI report
are additive and can remain during rollback.

## Risks and decisions for Sol

- A generic factory can hide policy and make security review harder. Default to
  no migration when semantics are not byte-for-byte equivalent.
- A file-count warning must not become a blanket exception for legitimate data
  migrations. Categorise first, then review.
- The existing open issue #168 is architecture debt, not a release blocker.

## Evidence

- `docs/GATE_0_RECONCILIATION.md` records #168 as non-blocking architecture debt.
- `lib/storeBackend.ts` and `lib/*Store.ts` show the current selector seam.
- The 2026-08-05 closed-PR sweep found roughly 25 store modules, only two with
  the simplest conformant shape, plus repeated inline branchers.
- CodeRabbit skipped or summarised several oversized PRs, limiting confidence
  in line-level review coverage.
