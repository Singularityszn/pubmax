# Location modifiers and original price ownership

This round addresses only `lossy-location-price-ownership`.
The starting HEAD is `125eb7ef4450bc2d70067d2be06b78714a11c8ad`.
The review base is `599252af3019f3776b5d78d297fae2d871fbd87f`.
The changes remain uncommitted. The hashes below identify the tested working files.

The invariant is that a location modifier must preserve each amount's original food or drink owner.
The invariant applies to leading and trailing amounts, query text, structured foodNeeds, bundles, and coordinated venue names.
Its consumers are meal classification, serving validation, budget inference, and pint-cap extraction.

Both reported failures reproduced through preparation and POST.
`pint at pub with pizza priced under£10` incorrectly succeeded instead of returning the meal limitation.
`£5 for a pint at Rose and Crown serving pizza` incorrectly returned the meal limitation.
Valid structured counterparts reproduced the same classification errors.

The shared representation removed food-price subjects and stopped inside coordinated venue names.
The correction calculates location spans before projecting subject text.
A span ends before a coordinated food or drink item, while ordinary name conjunctions remain inside the location.
A span containing food before an attached price preserves the food phrase and its amenity connector.
A separate clause does not extend a location span into a new price owner.
The projection retains original offsets and amounts.
These changes prevent the parser from manufacturing adjacency between a pint and a later meal amount.
No venue name is hardcoded. No paid call, fallback, retry, state, or code comment was added.

The [before output](location-price-ownership-before.txt) records 26 failures and 25 passes against unchanged production code, with 2,520 filtered cases.
Some supported baseline cases also encountered fixture-date scarcity rather than the selected classification defect.
The final matrix uses the existing supported-case clock, `2026-10-15T12:00:00Z`, for canonical evidence checks.
The final matrix also adds location-qualified meal contrasts, so its case count differs from the baseline.
An initial focused run passed 2,589 cases before four additional clause-boundary contrasts were added.
The [intermediate output](location-price-ownership-intermediate.txt) records two failures in the added structured-field fixtures and 2,591 passes.
Those fixtures used an ambiguous bare amount inside foodNeeds rather than an explicit route total.
The corrected fixtures use `pub total£20` and a shorter venue name to fit the 40-character field limit.
Their success, total-budget, canonical-price, and alternative assertions remain unchanged.

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts -t 'preserves original location price ownership' --reporter=dot
```

Before final verification, the trace covered the failing sequences and the ordinary successful paths.
`planPriceSubjectText` still feeds `planPriceAmounts` and `hasMealPriceConstraint` through the shared location spans.
`planPriceAmounts` still feeds meal classification, serving validation, and `planPriceLimits`.
`planPriceLimits` still feeds `inferNightContext` and preparation's budget and candidate filters.
POST still receives deterministic preparation refusals before paid allowance consumption.
The correction leaves no unused helper, parameter, alias, or branch.

The final focused run passed all 2,593 tests without skips and exited 0.
The [after output](location-price-ownership-after.txt) records the result.
The 73 new cases execute preparation and POST for priced meals, coordinated names, unpriced amenities, and genuine bundles.
Successful cases check canonical evidence for candidates, selected stops, and alternatives against the £5 ceiling.
Refusals check the limitation code, no venue loading, and no paid allowance consumption.
Existing checks retain location boundaries, counted venues, pub modifiers, fractional meals, serving validation, strict caps, route totals, and clause or field separation.
No existing assertion was weakened and no test was skipped.

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts --reporter=dot
```

| File | SHA-256 |
| --- | --- |
| Starting `lib/planPriceLimits.ts` | `7ce2bbebbc79c9e3b4ce1de4ffa1a1052aff2ba78675500b6407419d0b2e18ff` |
| Tested `lib/planPriceLimits.ts` | `d7f97c3c9ccaed6f350dee49b5264a35814d13445c6ba830322fe548e6753040` |
| Tested `__tests__/planGenerateRoute.test.ts` | `356fb9b5cff90f700177cbd4dd0a65cb1552115f8ee05003598a99cd955a5739` |
| Unchanged `lib/planGeneration.server.ts` | `232296f24d3ad2babbe12b7fb4c2dc3c8ccdc6a0b3a5f0fd52a0410ec33bb1b5` |
| Unchanged `lib/nightPlanning.ts` | `e54a6ce5b241d74989ef3297add769158c70d782a20a615fe4c9b52ba7c4cefc` |
| Unchanged `app/api/plans/generate/route.ts` | `24f07776a661cdbcce69789446d975703e972e0de8f643071d1129924e95f6b6` |

The tests call executable preparation and POST interfaces with mocked service boundaries and committed canonical data.
They do not establish live HTTP, browser, authenticated Pub Pal, provider privacy, physical-device behavior, retention, or full-product acceptance.
This phase ran no complete repository tests, lint suite, CI, publication, merge, or deployment.
The outer executor owns those phases. Declined findings and earlier proof records remain unchanged.
