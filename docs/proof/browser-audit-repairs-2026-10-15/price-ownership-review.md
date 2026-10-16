# Serving qualifiers and route-budget ownership

This is historical proof for the earlier R1 and R2 corrections.
The [serving-subject review](serving-subject-review.md) records the subsequent residual correction and its current source hashes.

This review fixes the selected R1 and R2 findings above starting HEAD `0dabd3ce43c737e988dd87a2cdec0b2e3c038bac`.
The proof applies to the modified worktree files identified below.

Before source changes, executable preparation and generation reproduced both findings in query text and structured foodNeeds.
The first focused reproduction produced 48 failures and four passes across 52 selected cases.
Metric drink requests returned successful pint routes or the wrong limitation.
Explicit £5 route budgets followed by drink nouns lost their total ownership and permitted successful generation.
The [before output](price-ownership-before.txt) records these failures.

The shared parser now retains metric measures, container qualifiers, and quantities before it decides whether a drink subject supports pint evidence.
Route-budget ownership takes precedence over a following drink noun.
The parsed result retains the drink subject so unsupported servings still receive an explicit refusal.
Meal refusal and limit aggregation consume that same result.
Each query and foodNeeds field retains its own boundary.

Executable checks cover these behaviours:

- Metric measures include 330ml, 330 ml, 33cl, 33 cl, 0.33L, and 0.33 L in both price directions.
- Unsupported serving requests fail before paid consumption or venue loading.
- Existing bottle, can, glass, shot, half-pint, and count refusals remain active.
- Single-pint and default beer or drink rates retain canonical evidence enforcement.
- Explicit route budgets survive drink suffixes, clause reversal, per-person wording, conflicting totals, and structured limits.
- Selected stops and alternatives use canonical prices and respect the route total and separate drink ceiling.
- Impossible £5 totals receive a grounded constraint refusal.
- Priced meal bundles retain their explicit limitation.

An intermediate run exposed oversized test inputs and queued mocks surviving an early refusal.
The fixtures now respect the 40-character foodNeeds limit and reset service mocks before each test.
The successful final command was `node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts --reporter=dot`.
All 1,194 tests passed, with no skipped tests.
The [after output](price-ownership-after.txt) records this run.

No selected finding remains unresolved in this focused proof.
These checks execute the public preparation and generation interfaces with mocked service boundaries and canonical price data.
They do not establish live browser, provider, authenticated Pub Pal, physical-device, or full-product acceptance.
Earlier browser screenshots retain their historical provenance.
Full tests, lint, CI, publication, and deployment remain with the outer executor.

The following SHA-256 values identify the source and tests used by the passing run.

| File | SHA-256 |
| --- | --- |
| `lib/planPriceLimits.ts` | `4e978215ca286663149c20382e75cdfd3b34a4fb3450437c732e5d6727cd6c0e` |
| `lib/planGeneration.server.ts` | `cef91b25f24ae88c61fa5418a50a7c35c4282e0f2902f55edb33f71b694e0b57` |
| `__tests__/planGenerateRoute.test.ts` | `ec920a4257dfb9d9e741e35c686a5b2377f1f896aac96cf23116075b8ce33034` |
