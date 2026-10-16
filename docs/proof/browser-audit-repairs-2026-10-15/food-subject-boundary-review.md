# Complete priced food subjects

This review fix addresses only `priced-food-subject-boundary`.
The starting HEAD is `2ed3ec8010dda8a378be7ee68e6a6171cde4c98a`.
The review base is `599252af3019f3776b5d78d297fae2d871fbd87f`.
The final source remains uncommitted at that HEAD. The SHA-256 values below identify the tested content.

The finding was legitimate. Preparation and POST accepted priced pub meals and meal-and-pint bundles.
The scanner treated bare venue nouns as boundaries even when those nouns modified food.
The multi-item matcher also treated a food subject as one vocabulary word.

The invariant is that a food modifier cannot end a priced subject.
This applies to query text and each `foodNeeds` field, direct meals, bundles, both price directions, and comma-separated item lists.
A venue transition such as `at pubs serving pizza` ends the subject before an unpriced preference.

The fix removes bare venue nouns from the scanner's boundaries.
One food-subject expression now serves the direct scanner and the multi-item matcher.
The existing preposition, rate, later-preference, amount, and comma boundaries remain.
The expression retains modifiers and fractional quantities without another quantity or modifier allowlist.
No comments, fallbacks, state, or retries were added.

The initial reproduction ran 176 new preparation-and-POST cases against the unchanged starting implementation.
It produced 56 failures and 120 passes. The name filter excluded 1,688 existing tests.
The failures accepted requests instead of returning `422 MEAL_CONSTRAINTS_UNSUPPORTED`.
The [before output](food-subject-boundary-before.txt) records the result. The command exited with status 1.

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts -t 'refuses complete priced food subjects at preparation and POST' --reporter=dot
```

The final matrix adds 264 refusal cases and 84 supported cases.
Refusal cases cover pub lunch, pub meal, pub food, pub burger, and their bar-modified counterparts.
They exercise direct prices, both bundle orders, both price directions, uppercase text, ampersands, modified subjects, and multi-item lists.
Each phrase runs in query text with and without a comma, and in a structured field.
This includes the exact reported queries and the compact `pubs under£20 for a pub lunch` structured form.
Every refusal checks both interfaces, the limitation code, no paid allowance consumption, and no venue loading.

Supported cases cover `at` and `in` transitions to pubs and bars serving lunch, food, or pizza.
They also cover local totals with food afterwards, explicit totals, and independently priced pints across separate fields in both orders.
The successful cases check inferred totals and returned stops.
Drink caps use canonical evidence on prepared candidates, returned stops, and alternatives.
Each alternative must also preserve its bounded route total.
All existing assertions remain unchanged.

The first focused run found eight remaining structured multi-item failures and passed 2,028 tests.
The [intermediate output](food-subject-boundary-intermediate.txt) records that run. The command exited with status 1.
The correction applies the same complete-subject expression before the existing structured single-word alternative.

Before the final verification, the trace covered `hasMealPriceConstraint`, `requiresMenuEvidence`, `preparePlanGeneration`, and the POST caller.
Direct food and bundle subjects reach the limitation before the route-budget exemptions, paid allowance consumption, and venue loading.
Prepositional venue transitions preserve drink ownership and unpriced food preferences.
Supported requests continue through normal price extraction, canonical candidate filtering, selection, and response assembly.
The existing reverse-bundle, explicit-route, serving-refusal, and separate-clause paths remain reachable.
No helper, parameter, alias, or branch became unreachable.

The final focused verification passed all 2,036 tests with no skips and exit status 0.
The [after output](food-subject-boundary-after.txt) records the result.
The existing fractional, modified-portion, bundle, serving-refusal, separate-field, clause, freshness, cap, alternative, and allowance-ordering tests all ran.

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts --reporter=dot
```

These SHA-256 values identify each run's source.
The reproduction test hash covers the initial 176 cases.
The intermediate and final test hash covers all added cases.

| File | Reproduction | Intermediate | Final |
| --- | --- | --- | --- |
| `lib/planGeneration.server.ts` | `0a0eb62a1e869bdf3a369b99a823357bbe80e316eb084d87dbeec7148c2fdcdc` | `5392093530d6c512e458bc8d47e356702ed0cddf09668a6a831d44e39e8f60c0` | `61b722563544feb2a085184f76647ac039d3fc7e4715e9d5c107be55b359befd` |
| `__tests__/planGenerateRoute.test.ts` | `8ac0a3e3bf300bcb0f3c3348cf842022a9988dd042253bcd1f05977592663cae` | `d2b8a355b952a283cebdd6e8143a3796ad26467972cf978bac340b3b18760d30` | `d2b8a355b952a283cebdd6e8143a3796ad26467972cf978bac340b3b18760d30` |

These files remained unchanged throughout all three runs.

| File | SHA-256 |
| --- | --- |
| `lib/planPriceLimits.ts` | `d0a59bfcf45d496e6af8f9ceae7954313d666aeb7eebc3163d0d1d9d254ac9af` |
| `lib/nightPlanning.ts` | `e54a6ce5b241d74989ef3297add769158c70d782a20a615fe4c9b52ba7c4cefc` |
| `app/api/plans/generate/route.ts` | `24f07776a661cdbcce69789446d975703e972e0de8f643071d1129924e95f6b6` |

These tests execute preparation and the POST handler with mocked service boundaries and committed canonical data.
They do not establish live HTTP, browser, authenticated Pub Pal, provider, physical-device, retention, or full-product acceptance.
No full repository suite, lint, CI, publication, merge, or deployment ran in this phase.
The outer executor owns those phases. Earlier proof records remain unchanged.
