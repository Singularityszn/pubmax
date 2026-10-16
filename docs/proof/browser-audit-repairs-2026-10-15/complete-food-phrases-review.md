# Complete coordinated food subjects

This review fix addresses only `complete-food-subject-regression`.
The starting HEAD is `aa2999219139e56c64b84bd4bb8face886601b30`.
The review base is `599252af3019f3776b5d78d297fae2d871fbd87f`.
The tested changes remain uncommitted at the starting HEAD. The hashes below identify their content.

The finding was legitimate. Preparation and POST accepted priced bundles containing complete food phrases.
The shared expression stopped at `serving` and conjunctions inside dishes.
Location masking could then erase the meal or leave only part of it.
This was a shared parsing defect with missing behavioral coverage.

The invariant is that a known food item retains its complete priced subject, including modifiers, quantities, portions, and internal conjunctions.
The affected paths are query text, each structured `foodNeeds` field, both price directions, both bundle orders, and multi-item lists.
The same invariant applies to direct meal detection, location-list boundaries, modifier masking, and the subsequent amount parser.
Venue serving predicates and complete venue names must remain separate from requested meals.

The fix removes conjunctions from the shared food expression's stopping conditions.
It distinguishes the noun phrase `serving of` from a venue's `serving` predicate.
The expression consumes the complete coordinated food phrase rather than stopping at its first known food word.
Location masking consumes venue food predicates with that same expression, preserving internal conjunctions in unpriced amenities.
The special fractional-conjunction branch became unnecessary and was removed.
No comments, helpers, state, fallbacks, retries, or new services were added.

The reproduction ran the new refusal matrix against the unchanged implementation.
It produced 167 failures and 781 passes, with 3,347 unrelated tests excluded by the name filter.
The failing cases returned success instead of `422 MEAL_CONSTRAINTS_UNSUPPORTED`.
The [before output](complete-food-phrases-before.txt) records the result and exit status 1.

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts -t 'retains complete coordinated food phrases at preparation and POST' --reporter=dot
```

The first focused run passed 4,277 tests and failed 18 new supported cases.
It showed that location masking also needed to preserve internal conjunctions in unpriced venue dishes.
The [intermediate output](complete-food-phrases-intermediate.txt) records that result and exit status 1.
Those assertions were retained. The shared location boundary was corrected before the final run.

The final additions cover 1,065 refusal cases and 136 supported cases through both preparation and POST.
They include servings, containers, fractions, quantities, adjectives, compound dishes, uppercase text, and `and`, `plus`, `+`, and `&` joins.
Both price directions, reversed bundles, multi-item lists, explicit totals, and every existing location preposition run.
Structured cases use valid fields of at most 40 characters. Compact conjunctions retain compound dishes within that limit.
Refusals assert the limitation code, no venue loading, and no paid allowance consumption.
Supported cases assert route totals, canonical fresh pint evidence, returned stops, alternatives, and bounded alternative totals.
They contrast coordinated venue names, unpriced amenities, later food preferences, and separate fields in both orders.
All earlier assertions remain unchanged.

Before final verification, the trace covered the shared expression, location spans, amount extraction, and price limits.
It also covered meal detection, request preparation, the POST caller, context inference, and canonical candidate filtering.
Priced food remains visible after location masking and reaches refusal before paid spending or venue loading.
Unpriced venue dishes remain inside their modifier. Independent drink rates and route budgets retain their owners.
The ordinary path still reaches candidate selection and response assembly with its canonical caps and alternatives.
No helper, parameter, alias, or branch became unreachable beyond the removed fractional special case.

The final focused run passed all 4,497 tests with no skips and exit status 0.
The [after output](complete-food-phrases-after.txt) records the result.

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts --reporter=dot
```

These SHA-256 hashes identify each run's source.

| File | Reproduction | Intermediate | Final |
| --- | --- | --- | --- |
| `lib/planPriceLimits.ts` | `15073db505129afcabe47f6c26f6a57d8fb40999d7b4686df6c8b75770a4948d` | `177380a5ed7c57963194a1f05ddd9e1bf1426c7f11034bf2f41d409bb581818e` | `88385fb4c6fd93db733b0af6a304d6ddfa14ce34839eaa2c09a3cc987a55d249` |
| `__tests__/planGenerateRoute.test.ts` | `5d4929e479095ae9c88aa213840346d174ef95db7fd26dcba64fa9ed97c8d36b` | `2be811df1e194d32563344a32c4337ffd50f9e5705e7adc201c79900f87f1d02` | `56c129959a1e3604e264f3d6cdf7ad8b611b46e89690332e7e809e79e0075683` |

These callers remained unchanged throughout the runs.

| File | SHA-256 |
| --- | --- |
| `lib/planGeneration.server.ts` | `fb1dd2777f7d469217469f64263fdb08778baaf8516b1ce0f674784b4d29dda6` |
| `lib/nightPlanning.ts` | `e54a6ce5b241d74989ef3297add769158c70d782a20a615fe4c9b52ba7c4cefc` |
| `app/api/plans/generate/route.ts` | `24f07776a661cdbcce69789446d975703e972e0de8f643071d1129924e95f6b6` |

These tests execute preparation and the POST handler with mocked service boundaries and committed canonical data.
They establish no live HTTP, browser, authenticated Pub Pal, provider, physical-device, retention, or full-product acceptance.
This review phase ran no paid calls, repository-wide tests, lint, build, CI, push, PR operations, merge, or deployment.
The outer executor owns the remaining phases. Earlier proof records remain unchanged.
