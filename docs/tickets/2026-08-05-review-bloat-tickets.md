# Sol-ready ticket proposal: review bloat and store boundaries

Parent spec: `docs/specs/2026-08-05-review-bloat-and-store-dedupe.md`
Publication status: draft only, pending Sol/user granularity review

These are vertical tickets, ordered by dependency. Do not publish child issues
until Sol confirms the boundary and pilot-store choice.

## T1 - Build the store-boundary inventory

Trace every `lib/*Store.ts`, `selectStore` call, and inline backend branch.
Record interface, selector, fallback, schema-missing behaviour, identity gate,
reset helper, and classification. Add a test that fails when a new store is
unclassified.

Depends on: none
Unblocks: T2, T4
Done when: inventory is complete and reviewed; no runtime behaviour changes.

## T2 - Add the narrow plain dual-backend selector

Implement a typed, policy-free selector for the `plain-dual-backend` class.
Preserve `selectStore` and production strictness. Add contract tests for
keyless, Supabase-configured, schema-missing, and reset paths.

Depends on: T1
Unblocks: T3
Done when: helper has no domain imports and its tests prove byte-equivalent
selection for pilot stores.

## T3 - Migrate two low-risk pilot stores

Choose two inventory entries with identical selector semantics. Migrate one at a
time, retaining explicit policy code and an exception note. Run focused route and
store tests after each migration.

Depends on: T2
Unblocks: T5
Done when: both pilots use the helper, no policy-heavy store does, and rollback
is a one-commit revert per pilot.

## T4 - Add review-scope and generated-file guard

Create a CI report categorising runtime, migration, generated, evidence, and
skill-pack files. Warn on mixed runtime domains or more than 150 files. Fail on
accidental generated/skill-pack changes, with an explicit maintainer override
for intentional generated updates.

Depends on: T1
Unblocks: T5
Done when: fixture PRs prove warning, allowed, and failure cases.

## T5 - Verify, document exceptions, and close the loop

Run full verification, publish the exception list, record measured line/file
changes, and compare review coverage before and after. If the factory increases
policy ambiguity or test cost, roll back pilots and retain only the inventory
and scope guard.

Depends on: T3, T4
Unblocks: none
Done when: Sol can review a small diff with evidence and a documented rollback.

## Review questions for Sol

1. Approve a narrow two-store pilot, or keep #168 as inventory-only debt?
2. Which two stores should be pilots after T1 classification?
3. Should the 150-file threshold warn, fail, or be changed to a measured token
   budget?
