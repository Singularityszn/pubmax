# Fractional and modified food prices

This round addresses only `fractional-front-priced-food`, starting at HEAD `dc9bd12f635809f7be1a22b0e43a3fb6f59e2a5f`.

The invariant is that a directly priced known food phrase receives `MEAL_CONSTRAINTS_UNSUPPORTED`, regardless of its quantities or modifiers.
It applies in both price directions, query text, and each separate `foodNeeds` field.
Preparation owns the check, and POST returns its refusal before paid consumption or venue loading.

The finding was legitimate at the shared classification boundary.
The finite quantity matcher missed fractional and modified food subjects.
A pub noun anywhere before the amount then incorrectly exempted that amount as a route budget.

The fix removes the quantity allowlist.
The matcher retains the phrase after an amount until a food noun or an independent preference, rate, or clause boundary.
Direct meal ownership precedes route-budget exemptions.
The final exemption requires a parsed route limit and either local route context or a following unpriced food preference.
An earlier pub noun alone cannot discard a later meal price.

The regression matrix executes preparation and POST for 129 refused portion, fractional, and modified-food cases.
The new subjects include half a pizza, 1/2 a pizza, quarter of a pizza, and one and a half portions of chips.
They also include three large slices of pizza, a freshly baked pizza, and a cheese and tomato pizza.
Every subject appears in both price directions, query text, and a separate structured food field.
Additional structured cases include a preceding pub noun when the entire field fits the existing 40-character limit.
No field exceeds that limit, and no test assertion was removed or weakened.
Each refusal checks its code, HTTP status, untouched paid allowance, and absence of venue loading.
Twelve successful quantity-preference cases retain route totals and independent drink rates through preparation and POST.

Before the source fix, the reproduction produced 13 failures and 125 passes.
Each failure returned prepared input and POST status 200 instead of the required 422 limitation.
The name filter excluded 1,506 other tests from that reproduction.
The [before output](fractional-food-before.txt) records the failures.

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts -t 'keeps non-drink portions|unpriced food quantities' --reporter=dot
```

The first focused verification exposed 11 existing per-person-budget regressions, with 1,636 tests passing.
The [intermediate output](fractional-food-intermediate.txt) preserves that result.
The final correction recognises the per-person suffix before an independent comma or `with` preference boundary.
Three additional successful cases cover route limits with following food preferences across those boundaries.
The final focused verification passed all 1,647 tests with no skips.
The [after output](fractional-food-after.txt) records that run.

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts --reporter=dot
```

Before each verification, the trace covered `hasMealPriceConstraint`, `requiresMenuEvidence`, preparation, and its POST caller.
Front-priced food phrases now reach the meal refusal before a route exemption.
Reversed meal prices retain their refusal path.
Independent drink rates, group budgets, explicit totals, unpriced preferences, and separate fields retain their existing callers and return contracts.
The removed quantity constant has no remaining consumer.
No caller, parameter, or helper became unreachable.
Existing tests for unsupported servings, canonical freshness, caps on stops and alternatives, field boundaries, clause boundaries, and paid ordering remain enabled.

The following SHA-256 values bind the evidence to its source.
The before test hash includes the new refusal matrix and four supported cases.
The final test hash also includes the three boundary cases added before focused verification.

| File | Before | Final |
| --- | --- | --- |
| `lib/planGeneration.server.ts` | `d123605b6ec3aa7264b6627b6b161138586d022f454319b4661c94a8147ac24d` | `3899828c6802e91a7dc4ebc8e5fcda08df2fd6da61c781c51e9087edc233358c` |
| `lib/planPriceLimits.ts` | `d0a59bfcf45d496e6af8f9ceae7954313d666aeb7eebc3163d0d1d9d254ac9af` | `d0a59bfcf45d496e6af8f9ceae7954313d666aeb7eebc3163d0d1d9d254ac9af` |
| `lib/nightPlanning.ts` | `e54a6ce5b241d74989ef3297add769158c70d782a20a615fe4c9b52ba7c4cefc` | `e54a6ce5b241d74989ef3297add769158c70d782a20a615fe4c9b52ba7c4cefc` |
| `app/api/plans/generate/route.ts` | `24f07776a661cdbcce69789446d975703e972e0de8f643071d1129924e95f6b6` | `24f07776a661cdbcce69789446d975703e972e0de8f643071d1129924e95f6b6` |
| `__tests__/planGenerateRoute.test.ts` | `fbbe6db8ebf55d4cf83ab6231580a3298e8b8c7953f4ac5377ef920f250fe69a` | `2b5016071e8fbb20f68ece7febf7c0752ab283293eda64f36aabb09fe44a3700` |

The intermediate server hash was `c3e6f1fb5aabbf5ae7ad5fc8bd390afffc0b8bed66ef5ad8dd43bea35bab47cd`.
Its other source hashes match the final column.

These executable checks use mocked service boundaries and committed canonical data.
They do not establish live HTTP, browser, authenticated Pub Pal, provider, physical-device, retention, or full-product acceptance.
Earlier browser screenshots retain their historical source hashes in the [feedback proof](review-feedback/report.md).
This round ran no browser checks and changed no onboarding, location, feedback, Lore, map, or provider code.
Full tests, lint, CI, publication, merge, and deployment remain with the outer executor.
