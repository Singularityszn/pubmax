# Serving prefix and non-drink subject review

This round addresses `serving-prefix-residual` and `non-drink-subject-regression`.
The starting HEAD is `e1d2eb6dd3750ebf0c0d37ae4c38483d239db574`.

A drink price must retain its complete serving qualifier before canonical pint evidence applies.
This invariant covers both price directions, query text, and each separate `foodNeeds` field.
The shared parser supplies meal classification, serving refusal, price limits, context totals, and candidate filtering.
Preparation supplies both direct callers and generation POST requests.

Non-drink subjects must remain available to meal and route-budget classification.
This invariant covers group and party budgets, meal portions, and both price directions.
The defects came from incomplete prefix recognition and unrestricted noun-before-`of` matching.

The [initial reproduction](serving-prefix-before.txt) records 30 failures against unchanged starting source.
Compound servings returned success or the wrong limitation, while group budgets and meal portions received drink refusals.
That exploratory run also put group-only text into `foodNeeds`.
Final group regressions use route-query clauses, with and without an independent pizza preference.

The parser now attaches numeric and written multiplication prefixes to beverage subjects, including spaced forms and the multiplication sign.
It recognises named drink containers instead of arbitrary nouns before `of`.
Existing unsupported containers retain their refusal without serving conversions.
Meal classification recognises front-priced slices and portions, including articles and plural portions.
The change preserves all existing tests and assertions.

The [intermediate run](serving-prefix-intermediate.txt) passed 1,512 tests and exposed two front-priced meal portions that returned success.
After the meal correction and additional portion regressions, the final focused command was:

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts --reporter=dot
```

All 1,526 tests passed with no skips.
The [final output](serving-prefix-after.txt) records this result.
Preparation and POST regressions cover both serving-price directions and both input representations.
They check refusals before paid consumption, group route totals, meal refusal codes, and supported canonical pint limits.
Existing tests check selected stops, alternatives, fresh evidence, separate fields, independent clauses, and impossible budgets.

The following SHA-256 values identify the source used by the final focused run.

| File | SHA-256 |
| --- | --- |
| `lib/planPriceLimits.ts` | `d0a59bfcf45d496e6af8f9ceae7954313d666aeb7eebc3163d0d1d9d254ac9af` |
| `lib/planGeneration.server.ts` | `c30447179b86c1fac37f1d0cc6e5b70e4c0860f6a3d78169fdf0afd5eeef8e0f` |
| `lib/nightPlanning.ts` | `e54a6ce5b241d74989ef3297add769158c70d782a20a615fe4c9b52ba7c4cefc` |
| `__tests__/planGenerateRoute.test.ts` | `f18b908f2d960a16493c8c489b8af47df4ae7670fa58581cc65300ccf79148b3` |

This proof uses mocked service boundaries and committed canonical price data.
No browser checks ran in this round.
The [earlier browser report](review-feedback/report.md) retains its historical source binding and does not verify this source.
This run does not establish authenticated Pub Pal, provider, physical-device, or full-product acceptance.
Full tests, lint, CI, publication, merge, and deployment remain with the outer executor.
