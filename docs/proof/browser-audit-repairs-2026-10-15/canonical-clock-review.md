# Canonical success test clocks

This record addresses only `canonical-success-tests-use-expiring-wall-clock`.
The starting HEAD was `c0ee093e918c0320b3624f87dc48c03567b38bfe`.

The finding was legitimate. Canonical prices expire, but nine success matrices used ambient time for POST.
Two matrices also used ambient time for preparation.
This was a test clock ownership defect. Production freshness rules behaved correctly.

The invariant is that tests requiring fresh canonical prices use the canonical fixture clock for preparation and POST.
The affected matrices cover these paths:

1. Decimal per-person totals beside pint caps.
2. Decimal currency and alcohol-free intent, including insufficient-cap refusals.
3. Coordinated venue drink predicates beside route limits.
4. Unpriced venue amenities beside typed route totals.
5. Venue serving predicates beside route budgets, including missing soft-drink evidence.
6. Serving verbs and unpriced serving preferences beside drink caps.
7. Complete later serving preferences beside route budgets.
8. Non-drink group budgets.
9. Route and drink budgets beside unpriced food quantities.

Each matrix now uses the existing `PLAN_GENERATION_TEST_NOW` constant and the existing Date spy pattern.
The fixture time resolves to `2026-10-02T12:00:01.000Z` from the committed dataset stamp.
Each `finally` block restores the clock after success or failure.
Two preparation calls now receive the fixture time explicitly.
All assertions, cases, production clocks, data dates, freshness thresholds, and skip behaviour remain unchanged.

Before verification, code tracing confirmed that preparation and POST receive the same fixture time in all nine matrices.
Query and structured inputs retain their original expectations.
The insufficient-cap and missing-evidence branches retain their refusal assertions.
No helper, alias, branch, or parameter became unreachable.

## Verification

| Check | Command | Result | Raw output |
| --- | --- | --- | --- |
| Before correction, future clock | `node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts --config .review-clock.config.mts --reporter=dot -t 'preserves decimal per-person totals beside pint caps'` | Exit 1, eight failures returning 422 instead of 200 | [Before](canonical-clock-before.txt) |
| After correction, normal clock | `npm test -- __tests__/planGenerateRoute.test.ts --reporter=dot` | Exit 0, 15,016 passed, no skipped tests | [Normal](canonical-clock-after-normal.txt) |
| After correction, future clock | `npm test -- __tests__/planGenerateRoute.test.ts --config .review-clock.config.mts --reporter=dot` | Exit 0, 15,016 passed, no skipped tests | [Future](canonical-clock-after-future.txt) |
| Touched-file lint | `node_modules/.bin/eslint __tests__/planGenerateRoute.test.ts` | Exit 0, no diagnostics | [Lint](canonical-clock-lint.txt) |

The temporary future-clock config extended `vitest.config.mts` and appended one setup file after `vitest.setup.ts`.
That setup installed Date-only fake timers before each test and set `2030-01-01T12:00:00.000Z`.
Its `afterEach` hook restored real timers. Other timer functions remained real.
Both temporary files were removed after verification.
The complete file retained its stale-evidence, scarcity, provenance, serving, budget, alternative, and refusal checks.

The tested file is `__tests__/planGenerateRoute.test.ts`.
Its SHA-256 is `cce9fc47ff09782dd67f8de8e6885a4f7fd9e688f7214aa7df89604577081161`.
Its Git blob is `edfb8172c4cf5b37306e2fbd891203f0472226cf`.

## Evidence limits and handoff

Application source and committed data remain identical to starting HEAD.
The application tree hashes are:

| Directory | Git tree |
| --- | --- |
| `app` | `20cfd49030653a587e9450a213ab3fcaacd81686` |
| `components` | `911aefe5d5f553473f083f33227c27a8a22e4fe0` |
| `lib` | `413146647613f14319447ca81f2f39ac2f7ec3c4` |
| `data` | `daf20bc270a8d1363842b87fa474491e4296dffd` |
| `public` | `a6db00759568b14365da1c7c509c7a92e98b2a42` |

Existing c0ee functional HTTP and guard evidence remains historical evidence for matching runtime bytes.
This round adds no browser, HTTP, device, provider, deployment, or release acceptance claims.
No paid calls were added.
The complete repository test and lint suites were not run in this review phase.
The outer executor owns the commit, full configured Test, and fresh complete branch review.
No pipeline control, push, PR update, merge, or deployment occurred.
