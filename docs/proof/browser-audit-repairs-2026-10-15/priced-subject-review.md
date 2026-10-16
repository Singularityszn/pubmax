# Price subjects and venue food preferences

This round addresses only `priced-subject-overreach`, starting at HEAD `5bde8f7beaa8bef0c7f6165dade4c0dda011a2dc`.

The finding was legitimate.
The shared classifier scanned beyond a priced subject into a later venue description before considering recognised drink ownership.
Preparation and POST returned `422 MEAL_CONSTRAINTS_UNSUPPORTED` for supported drink rates and explicit route budgets.

The invariant is that an amount belongs to its priced subject, and a later unpriced food preference cannot change that ownership.
This applies to query text, each separate `foodNeeds` field, both price directions, and explicit route totals.
Meal-and-drink bundles and directly priced meals still require a limitation.

The correction stays in `hasMealPriceConstraint`.
Drink-owner branches now check their meal bundles before the generic route-budget exemptions.
The direct-food scan stops at location and venue transitions, alongside the existing rate, preference, amount, and clause boundaries.
It retains fractional and modified food phrases without a quantity allowlist.
A serving of pizza remains a food subject rather than an amenity transition.
The existing explicit-route classification still supplies the route total.

The initial reproduction added 30 supported cases through preparation and POST.
It produced 16 failures and 14 passes, with 1,647 unrelated tests excluded by the name filter.
The failures returned 422 at both interfaces instead of the expected 200.
The [before output](priced-subject-before.txt) records that run.

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts -t 'keeps price subjects separate from venue food preferences' --reporter=dot
```

The final matrix covers front-priced pints, reverse-priced pints, explicit route budgets, food-serving venues, and food afterwards.
Every compact phrase runs in query text and a separate structured field.
The full reported route-budget sentence runs in query text.
Its structured counterpart uses `route budget of£20 at pubs serving pizza` to respect the existing 40-character field limit.
The initial matrix used a bare `drinks serving pizza` suffix for one compact total.
The final matrix uses `drinks with pizza`, alongside the reported `at pubs serving pizza` forms.
The final suite also adds directly priced ordinary and modified servings of pizza in both directions and representations.
Existing bundle, fractional-meal, unsupported-serving, clause, field, group-budget, and allowance-ordering checks remain enabled.
The new successful cases assert route totals and enforce drink caps against canonical evidence on prepared candidates, returned stops, and alternatives.
For bounded route totals, each returned alternative must also preserve the route sum.
No existing assertion was weakened or removed.

After all edits, the trace covered `hasMealPriceConstraint`, `requiresMenuEvidence`, `preparePlanGeneration`, and its POST caller.
Both reported pint directions now retain their drink owner across the venue description.
Explicit route totals retain their amount across the unpriced preference.
Actual meal bundles and direct meal subjects still reach the limitation before paid consumption and venue loading.
Supported requests continue through normal price extraction, candidate filtering, selection, and response assembly.
No helper, parameter, alias, or caller became unreachable.

The single final focused verification passed all 1,688 tests with no skips.
The [after output](priced-subject-after.txt) records the result and exit status was zero.

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts --reporter=dot
```

These SHA-256 values identify the exact source used for each run.
The before test hash includes the initial reproduction matrix.
The final test hash includes the revised compact total and the added food-serving quantity cases.

| File | Before | Final |
| --- | --- | --- |
| `lib/planGeneration.server.ts` | `3899828c6802e91a7dc4ebc8e5fcda08df2fd6da61c781c51e9087edc233358c` | `0a0eb62a1e869bdf3a369b99a823357bbe80e316eb084d87dbeec7148c2fdcdc` |
| `lib/planPriceLimits.ts` | `d0a59bfcf45d496e6af8f9ceae7954313d666aeb7eebc3163d0d1d9d254ac9af` | `d0a59bfcf45d496e6af8f9ceae7954313d666aeb7eebc3163d0d1d9d254ac9af` |
| `lib/nightPlanning.ts` | `e54a6ce5b241d74989ef3297add769158c70d782a20a615fe4c9b52ba7c4cefc` | `e54a6ce5b241d74989ef3297add769158c70d782a20a615fe4c9b52ba7c4cefc` |
| `app/api/plans/generate/route.ts` | `24f07776a661cdbcce69789446d975703e972e0de8f643071d1129924e95f6b6` | `24f07776a661cdbcce69789446d975703e972e0de8f643071d1129924e95f6b6` |
| `__tests__/planGenerateRoute.test.ts` | `312255dcc84df95dac950bbdea7c4a064b2c1558ed0aca96f4bd447f121b8e00` | `adaced587cfaa228a8450ec1b11e11de3e6296493c3dbbd8b093c143373a31fa` |

These checks execute public request interfaces with mocked service boundaries and committed canonical data.
They do not establish live HTTP, browser, authenticated Pub Pal, provider, physical-device, retention, or full-product acceptance.
This round ran no browser checks.
Earlier screenshots remain historical evidence with their original source provenance in the [feedback report](review-feedback/report.md).
Full repository tests, lint, CI, publication, merge, and deployment remain with the outer executor.
