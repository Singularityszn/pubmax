# Generic serving price review

This round addresses only `generic-serving-price-omission`.
The starting HEAD is `bc732e0a35c46a99293a2c585761a6a7a22265e2`.
The reviewed base is `599252af3019f3776b5d78d297fae2d871fbd87f`.

The finding is legitimate.
The invariant is that a priced food serving receives an explicit meal limitation before paid allowance consumption.
It applies to both price directions, singular and plural nouns, quantities, fractions, coordinated bundles, and location modifiers.
It also applies independently to query text and every valid food field.
Venue-serving predicates remain amenities, and independent drink caps and route totals retain their existing meaning.

The root cause was a missing noun in the shared food vocabulary.
Adding an unconditional `servings?` alternative would also classify a venue-serving verb as a food noun.
The shared vocabulary now recognises serving nouns at a grammatical boundary, including currency, price words, joins, locations, and phrase endings.
The existing food subject, location masking, meal detection, and preparation refusal consume that rule.
No additional refusal path or state was added.

## Reproduction

A local Next.js development server ran at `http://127.0.0.1:43187` with `NEXT_DIST_DIR=.next-serving-review`.
The [HTTP before evidence](generic-serving-http-before.json) records five real requests before source changes.
Front-priced singular and plural servings returned 200 with empty food needs and no budget.
The pint-and-serving bundle also returned 200.
The trailing-price requests returned `GROUNDED_CONSTRAINTS_UNSATISFIED`, rather than the required meal limitation.
Their current three-stop route was infeasible under the incorrectly inferred budget.
This is narrower evidence than the earlier reported one-stop success.

The [red preparation and POST run](generic-serving-before.txt) recorded 180 failures and 106 passes.
All 26 venue-predicate and unpriced-preference controls passed.
The test setup initially used an unavailable candidate-price representation and an incorrectly classified trailing meal price.
Those test setup errors were corrected before the retained red run.
No product source changed before that retained run.

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts -t 'priced generic serving nouns|serving verbs and unpriced serving preferences' --reporter=dot
```

## Focused verification

All fixes were applied before verification.
The final trace followed the failing inputs and ordinary drink paths through location spans, subject text, amount ownership, meal detection, preparation, and POST.
It also followed `inferNightContext` and `planPriceLimits`, which retain their existing budget behaviour.
The shared correction left no helper, parameter, caller, or branch unreachable.

The [green run](generic-serving-after.txt) passed all 4,947 tests across both affected planner suites.
There were no skipped tests.
The final regression matrix adds 12 currency, price-word, and uppercase cases beyond the retained red matrix.
The final matrix also uses the exact raw Soho queries.
Every structured field remains within the existing 40-character limit.
Refusal assertions check the meal code and absence of paid allowance consumption and venue loading.
Success controls check route totals, canonical candidate prices, selected stops, and alternative price caps.

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts __tests__/nightPlanning.test.ts --reporter=dot
node_modules/.bin/eslint lib/planPriceLimits.ts __tests__/planGenerateRoute.test.ts
```

The [focused lint output](generic-serving-lint.txt) is empty and the command exited 0.
The [HTTP after evidence](generic-serving-http-after.json) records all five original requests returning 422 with `MEAL_CONSTRAINTS_UNSUPPORTED`.
A sixth request for a capped pint at a pub serving pizza returned 200.
The development server was stopped after these checks.

## Source hashes and proof limits

SHA-256 values identify the starting source and the tested working source.
The tested source remains uncommitted for the outer executor.

| File | Before | After |
| --- | --- | --- |
| `lib/planPriceLimits.ts` | `81276286ce4fee31441eaa5531c1afa9eaef7fccc9cd9909ff227a056f2c2c2e` | `c978192a3906b97956588618f733a17db088350048039e4148da0363d6ae9dac` |
| `lib/planGeneration.server.ts` | `5bd5569daf8fa7d5254af3d9b813dd212e7f54611cb9e4dc38c5838a48e20421` | unchanged |
| `lib/nightPlanning.ts` | `e54a6ce5b241d74989ef3297add769158c70d782a20a615fe4c9b52ba7c4cefc` | unchanged |
| `__tests__/planGenerateRoute.test.ts` | red matrix: `ed99ec259752ba75555fbddb24cb4a4816377925711d19246de52dbd57eda157` | `e66a283d85ab86dfcdbce4f6dd8dd82f2c98f0640d0833c6c11a755592a6f675` |

The red test hash was reconstructed by removing the 12 later cases and restoring the earlier query prefix.
The final test hash covers the source used for the green run.
HTTP evidence comes from a local development server, not a production build or deployment.
Unit checks use the existing mocked service boundaries and committed canonical data.
No browser, authenticated Pub Pal, provider privacy, physical-device, retention, or full-product acceptance is established here.
Full repository validation, type checking, CI, publication, merge, and deployment remain with the outer executor.
