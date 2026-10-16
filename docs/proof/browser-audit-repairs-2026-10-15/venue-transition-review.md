# Venue transitions and price ownership

This review addresses only the selected `venue-transition-from` finding.
The starting HEAD is `e7a53d035268912532975e83967c9cf115eb1059`.
The review base is `599252af3019f3776b5d78d297fae2d871fbd87f`.
The changes remain uncommitted at that HEAD. The hashes below identify the tested content.

The finding was legitimate. Preparation and POST returned `422 MEAL_CONSTRAINTS_UNSUPPORTED`
for supported drink rates and explicit route totals followed by unpriced venue food preferences.
The shared food-subject scanner recognised only `at` and `in` as location boundaries.
It continued through other location phrases into the food amenity.

The invariant is that an unpriced venue amenity cannot take ownership of an existing drink price or route total.
The invariant applies to both price directions, query text, structured fields, and joined item lists.
Counted venue subjects must remain distinct from pub or bar words that modify a meal.

The correction extends the shared subject boundary to location phrases and relative amenities.
It covers `at`, `in`, `from`, `near`, `around`, `within`, `inside`, `outside`, `by`, and `where`.
The same expression serves direct price detection and complete food subjects in item lists.
Counted venue amenities also end the subject and retain a recognised route limit.
The correction adds no fallback, state, retry, service, or code comment.

The new tests execute preparation and POST with supported and refusal inputs.
They cover both drink price directions, explicit route totals, query text, and valid structured fields.
They also cover joined drink lists, relative amenities, counted venues, and pub-modified meals.
Structured fields retain their existing 40-character limit.
Long query phrases use compact equivalents in structured fields.
The exact reported `from pubs serving pizza` pint phrases and structured route total are included.

The before run used the unchanged starting implementation with the initial valid regression matrix.
It ran 313 cases: 151 failed and 162 passed. The name filter excluded 1,922 other cases.
The failures returned the meal limitation at both interfaces instead of successful plans.
The [before output](venue-transition-before.txt) records exit status 1.

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts -t 'keeps price subjects separate from venue food preferences|preserves food modifiers beside venue transitions' --reporter=dot
```

The final matrix adds 211 cases to the original file: 193 supported cases and 18 refusal contrasts.
Twelve additional contrast cases were added after the before run.
They cover generic food on counted venues, independently priced meals after location phrases, and fractional meal bundles.
The successful cases check inferred totals and three returned stops.
They also check canonical fresh price caps on prepared candidates, returned stops, and alternatives.
Alternative routes must retain the requested total budget.
The new refusals check the limitation code at both interfaces, no paid allowance use, and no venue loading.
Existing assertions remain unchanged.

Before verification, the trace covered `hasMealPriceConstraint`, `requiresMenuEvidence`,
`preparePlanGeneration`, and its POST caller.
A pint followed by a location phrase retains its price ownership in either direction.
Joined drink lists stop before the unpriced venue preference in query and structured inputs.
Explicit totals and counted venue limits continue through normal budget extraction and route selection.
Direct pub meals and actual bundles still reach the meal limitation before paid allowance use.
Each independently priced clause still receives its own classification.
No helper, parameter, alias, or branch became unreachable.

The single final focused verification passed all 2,247 tests with no skips and exit status 0.
The [after output](venue-transition-after.txt) records the result.
The full file includes fractional and modified portions, both bundle orders, separate fields and clauses,
unsupported servings, canonical freshness, caps, alternatives, and refusal-before-paid ordering.

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts --reporter=dot
```

| File | Before SHA-256 | Final SHA-256 |
| --- | --- | --- |
| `lib/planGeneration.server.ts` | `61b722563544feb2a085184f76647ac039d3fc7e4715e9d5c107be55b359befd` | `22eb4b37b10951c35e4e8e64a26978dc5ed6572f89c7ed01722df2de79ba962e` |
| `__tests__/planGenerateRoute.test.ts` | `32cc80f1a5c5d1269ab6e5fcd920c3469aade5bfb2cbda3cc23b667c71924404` | `a5e2929d982c95f20d2388769f4fc150a6b72b2723c6c765c48f7a7bbf687349` |

These caller and price-extraction files remained unchanged throughout the checks.

| File | SHA-256 |
| --- | --- |
| `lib/planPriceLimits.ts` | `d0a59bfcf45d496e6af8f9ceae7954313d666aeb7eebc3163d0d1d9d254ac9af` |
| `lib/nightPlanning.ts` | `e54a6ce5b241d74989ef3297add769158c70d782a20a615fe4c9b52ba7c4cefc` |
| `app/api/plans/generate/route.ts` | `24f07776a661cdbcce69789446d975703e972e0de8f643071d1129924e95f6b6` |

These checks execute preparation and the POST handler with mocked service boundaries and committed canonical data.
They do not establish live HTTP, browser, authenticated Pub Pal, provider, physical-device, retention, or full-product acceptance.
No complete repository suite, lint suite, CI, publication, merge, or deployment ran in this phase.
The outer executor owns those phases. Earlier proof records and declined findings remain unchanged.
