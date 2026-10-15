# Shared price subjects and venue modifiers

This round addresses only `venue-transition-hides-bundle` and `complete-drink-location-sibling`.
The starting HEAD is `03e735cb8e3364d0397a38063235b22b93e0eee4`.
The review base is `599252af3019f3776b5d78d297fae2d871fbd87f`.
The changes remain uncommitted. The content hashes below identify the tested files.

Both findings reproduced through preparation and POST with valid request fields.
The first invariant requires venue modifiers to preserve later coordinated priced meals.
The second invariant requires venue modifiers to end drink contents without changing the serving quantity or unit.
Both invariants apply to leading prices, trailing prices, explicit route totals, query text, and structured foodNeeds.
The same subjects also reach budget inference, drink-limit validation, and pint-cap extraction.

The defect was inconsistent phrase ownership across the meal classifier and complete-drink parser.
The correction shares the food vocabulary, subject boundaries, and venue-modifier projection in `planPriceLimits.ts`.
The projection replaces modifier characters with spaces and preserves original offsets, amounts, and coordinated subjects.
It stops before conjunctions, clause separators, and prices in either supported currency notation.
The meal classifier checks joined subjects after both leading and trailing drink prices.
Existing route-budget exemptions, serving validation, freshness requirements, and paid-budget ordering remain in place.
No state, fallback, retry, paid call, or code comment was added.

The initial regression matrix ran against the unchanged implementation.
It reported 109 failures and 355 passes. The filter excluded 1,940 other cases.
The [before output](shared-price-subject-before.txt) records exit status 1.
The baseline test file SHA-256 was `dfd40b31ba16e9e72ccdba9cacdf54f112b234129d150370e984ef59518d3021`.

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts -t 'refuses coordinated meals across venue modifiers|keeps price subjects separate from venue food preferences' --reporter=dot
```

The final matrix adds 273 cases to the original suite.
The additions cover both interfaces and use compact equivalents where structured fields have a 40-character limit.
They include `at`, `in`, `from`, `near`, `around`, `within`, `inside`, `outside`, `by`, and `where`.
Contrasts include pub lunch, fractional meals, reversed bundles, multi-item lists, uppercase text, and ampersands.
They also cover unsupported quantities, containers, contents, and measured servings beside venue modifiers.
Existing behavioral checks retain counted venue amenities, local route totals, strictest caps, separate clauses, and separate fields.
Successful cases check canonical fresh evidence for prepared candidates, selected stops, and alternatives.
Refusal cases check the limitation code, no venue loading, and no paid allowance consumption.
No existing assertion was weakened and no test was skipped.

Before verification, the trace covered the failing sequences and ordinary successful paths through every changed function.
`planPriceSubjectText` feeds both `planPriceAmounts` and `hasMealPriceConstraint`.
`planPriceAmounts` still feeds `planPriceLimits`, serving validation, and meal classification.
`planPriceLimits` still feeds `inferNightContext` and preparation's final budget and candidate filters.
Preparation still returns deterministic refusals to POST before paid allowance consumption.
The combined drink branch removes the duplicated direction check without leaving an unreachable helper or parameter.

The single final focused verification passed all 2,520 tests with no skips and exit status 0.
The [after output](shared-price-subject-after.txt) records the result.

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts --reporter=dot
```

| File | Starting SHA-256 | Tested SHA-256 |
| --- | --- | --- |
| `lib/planPriceLimits.ts` | `d0a59bfcf45d496e6af8f9ceae7954313d666aeb7eebc3163d0d1d9d254ac9af` | `7ce2bbebbc79c9e3b4ce1de4ffa1a1052aff2ba78675500b6407419d0b2e18ff` |
| `lib/planGeneration.server.ts` | `22eb4b37b10951c35e4e8e64a26978dc5ed6572f89c7ed01722df2de79ba962e` | `232296f24d3ad2babbe12b7fb4c2dc3c8ccdc6a0b3a5f0fd52a0410ec33bb1b5` |
| `__tests__/planGenerateRoute.test.ts` | See the baseline test hash above | `3bd58df626316f54ac531c83abe50403c96b6be13df32920403dc68e2e5f3441` |

These callers remained unchanged throughout the checks.

| File | SHA-256 |
| --- | --- |
| `lib/nightPlanning.ts` | `e54a6ce5b241d74989ef3297add769158c70d782a20a615fe4c9b52ba7c4cefc` |
| `app/api/plans/generate/route.ts` | `24f07776a661cdbcce69789446d975703e972e0de8f643071d1129924e95f6b6` |

The tests execute preparation and the POST handler with mocked service boundaries and committed canonical data.
They do not prove live HTTP, browser, authenticated Pub Pal, provider privacy, physical-device behavior, retention, or full-product acceptance.
This phase ran no complete repository test suite, lint suite, CI, publication, merge, or deployment.
The outer executor owns those phases. Earlier proof records and declined findings remain unchanged.
