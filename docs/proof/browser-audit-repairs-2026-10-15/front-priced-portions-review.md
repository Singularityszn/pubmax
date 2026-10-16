# Front-priced food quantities

This round addresses only `front-priced-portions`, starting at HEAD `051e04fec836e5c7d10afe64714fbf205ec219cf`.

The invariant is that a directly priced known food subject receives `MEAL_CONSTRAINTS_UNSUPPORTED`, regardless of its quantity.
It applies to both price directions, the query, and every separate `foodNeeds` field.
Preparation owns the check, and POST returns its refusal before generation.

The defect was at the shared classification boundary.
The front-price matcher accepted articles, one, and two before a portion or slice.
Other quantities prevented recognition of the directly priced food subject.
A preceding pub noun then incorrectly exempted that amount as a route budget.

The matcher now recognises numeric and written quantities, including compound counts and `a dozen`.
The same quantity pattern applies before portions or slices and before the known food item.
Recognition remains anchored immediately after the amount and optional `for`.
Direct meal-price recognition still precedes the pub-route exemption.
No quantity becomes a serving conversion or an invented meal price.

The regression matrix executes preparation and POST for 90 portion and slice cases.
It includes three, 3, four, ten, and a dozen in both price directions.
Each phrase appears in a query, a separate food field, and a food field with a preceding pub noun.
All food fields remain within the existing 40-character limit.
Refusal assertions also check that the request consumes no paid allowance and loads no venues.
Five supported cases preserve route totals and independent pint rates with unpriced food quantities.

Before the source fix, this reproduction command produced 20 failures and 75 passes.
The other 1,506 tests were outside its name filter.
Each failure showed accepted preparation and a POST status of 200 instead of 422.
The [before output](front-priced-portions-before.txt) records the failing cases.

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts -t 'keeps non-drink portions|unpriced food quantities' --reporter=dot
```

After the fix, the complete focused file passed all 1,601 tests with no skipped tests.
The [after output](front-priced-portions-after.txt) records that run.
Existing assertions for group budgets, serving refusals, fresh canonical caps, alternatives, separate fields, clauses, and allowance ordering remain enabled.

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts --reporter=dot
```

The final trace checked both price directions through `hasMealPriceConstraint`, `requiresMenuEvidence`, preparation, and POST.
Meal subjects now receive refusal before the route exemption.
Route totals followed by later food retain the route-budget path.
Independent drink rates retain the existing drink path and canonical price filtering.
The correction made no caller, parameter, helper, or branch unreachable.

The following SHA-256 values bind the executable evidence to its source.
The regression test file was identical during the before and after runs.

| File | Before | After |
| --- | --- | --- |
| `lib/planGeneration.server.ts` | `c30447179b86c1fac37f1d0cc6e5b70e4c0860f6a3d78169fdf0afd5eeef8e0f` | `d123605b6ec3aa7264b6627b6b161138586d022f454319b4661c94a8147ac24d` |
| `lib/planPriceLimits.ts` | `d0a59bfcf45d496e6af8f9ceae7954313d666aeb7eebc3163d0d1d9d254ac9af` | `d0a59bfcf45d496e6af8f9ceae7954313d666aeb7eebc3163d0d1d9d254ac9af` |
| `lib/nightPlanning.ts` | `e54a6ce5b241d74989ef3297add769158c70d782a20a615fe4c9b52ba7c4cefc` | `e54a6ce5b241d74989ef3297add769158c70d782a20a615fe4c9b52ba7c4cefc` |
| `__tests__/planGenerateRoute.test.ts` | `d9ede589c569a6812fc82565812301106e3064f6d6577e931373accaecba80e8` | `d9ede589c569a6812fc82565812301106e3064f6d6577e931373accaecba80e8` |

These tests use mocked service boundaries and committed canonical data.
They do not establish live HTTP, browser, authenticated Pub Pal, provider, physical-device, retention, or full-product acceptance.
Earlier browser checks retain their historical source hashes in the [feedback proof](review-feedback/report.md).
This round ran no browser checks and changed no onboarding, location, feedback, Lore, or map code.
Full tests, lint, CI, publication, merge, and deployment remain with the outer executor.
