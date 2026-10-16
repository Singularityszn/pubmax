# Serving clause and price ownership review

This review addresses only `qualified-serving-descriptor-erasure` and `raw-modifier-and-typed-amenity-ownership`.
The base is `599252af3019f3776b5d78d297fae2d871fbd87f`.
The starting HEAD is `3f8ed63a0391f9b06c490ab044751c70d479166d`.
The checks exercise uncommitted source identified by the hashes below.

A quantified serving must retain its complete subject and attached price through normalisation and location masking.
An unpriced venue amenity must preserve an independently owned route budget.
These invariants apply to query text and valid `foodNeeds`, both price directions, all supported joins, introductions, and location modifiers.
They also apply to fractions, quantities, relative modifiers, decimal measurements, and ordinary drink-rate paths.

The defects shared an ownership boundary.
The earlier noun guard depended on an adjective list and measurement-only postmodifiers.
The typed budget exemption also required per-person wording after the amount.
The correction binds serving prices within their subject clauses before normalising venue predicates.
It retains arbitrary descriptors and complete postmodifiers without another adjective or venue list.
The measurement grammar remains shared, and its descriptor alternatives are disjoint.
Numeric commas normalise to dots without changing character offsets.
A shared drink-subject rule distinguishes a venue predicate followed by a coordinated route limit from a priced food bundle.
The independent-budget helper accepts a separated total only when every named food belongs to a normalised venue predicate.
It preserves refusals for quantified food prices and unowned amounts in separate typed fields.
A food-subject override was removed from serving normalisation because it could erase a quantified noun.
The removed descriptor and postmodifier rules have no remaining callers.

Before correction, real HTTP checks against the unchanged target application source reproduced three incorrect successes.
They covered the warm serving query, its valid typed location bundle, and the raw containing-nuts query.
The typed containing-nuts contrast already returned the required meal refusal.
The typed rooftop amenity incorrectly returned the meal refusal.
These are local development-server observations, not production evidence.

The initial focused preparation and POST reproduction recorded 374 failures and 114 passes.
Additional red checks caught internal introductions, decimal measurements, and independently limited drink predicates during the repair.
Two bounded public-parser probes also timed out after three seconds on overlapping measurement alternatives.
The final regression executes the public parser in an isolated process with a five-second timeout and checks its route-budget output.
No existing assertion was removed, weakened, skipped, or relabelled.

The final affected suites passed with 15,049 tests and no skips:

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts __tests__/nightPlanning.test.ts __tests__/planPriceCompatibility.test.ts --reporter=dot
```

The focused static check exited 0 without warnings:

```sh
node_modules/.bin/eslint lib/planPriceLimits.ts lib/planGeneration.server.ts __tests__/planGenerateRoute.test.ts __tests__/planPriceCompatibility.test.ts
```

The suites retain serving validation, strictest route and cap limits, canonical selected and alternative price checks, and refusal-before-paid assertions.
The compatibility check executes module initialization and parsing with a constructor that rejects lookbehind.
It does not establish physical-device or emitted-bundle compatibility.

Two independent reviewers examined the complete base-to-current source branch.
Their final specification and standards verdicts report no actionable finding within the selected repair scope.
Both verdicts bind to the two final library hashes below.
Those reviewers ran no tests or HTTP requests and changed no files.
Ambiguous language without clear price ownership can retain an honest limitation.
This correction does not claim complete natural-language interpretation.

## HTTP evidence

The replay uses the complete frozen 195-case matrix and 12 fresh warm-serving and containing-nuts cases.
Its input SHA-256 is `7c32bb4903900a6a5884552a6af8622e4eca2050e71fbd43000d20a9d730bbf8`.
The server is keyless on `127.0.0.1:30697` with isolated `.next-serving-fix7-review` output.
It reads committed data and uses unchanged rate and paid-budget settings.
The assessor checks exact refusal codes, budget ownership, selected and alternative cap prices, attribution, and actual scarcity evidence.
A generic 422 or a 429 is not a passing result.

The first complete replay used one caller paced at 7.7 seconds between requests.
It completed 207 cases without a 429 and recorded 18 failed expectations.
Three failures exposed named-food venue amenities incorrectly owning the independent total.
The same small ownership correction now covers those sibling paths.
Their final HTTP results preserve the 2000p budget:

| Frozen case | Before correction | Final result |
| --- | --- | --- |
| `follow-up/venue-serving-drinks/query-budget-after/pubs serving beer and pizza` | 422 `MEAL_CONSTRAINTS_UNSUPPORTED` | 200, no assessment issue |
| `follow-up/qualified-venue-serving/each-serving-pizza/query-budget-after` | 422 `MEAL_CONSTRAINTS_UNSUPPORTED` | 200, no assessment issue |
| `follow-up/qualified-venue-serving/each-serving-pizza/foodNeeds-owned-budget` | 422 `MEAL_CONSTRAINTS_UNSUPPORTED` | 200, no assessment issue |

The final replay uses one reserved synthetic `x-real-ip` address per independent case, from `192.0.2.1` through `192.0.2.207`.
Each raw attempt records its client address.
This isolates cases without changing server limits or provider settings.
It does not establish single-caller rate-load behaviour on the final source.

The final replay completed all 207 cases with no 429 or transport failure.
It returned 93 successes and 114 refusals.
The refusals comprise 99 meal limitations, 13 drink limitations, and two evidence-scarcity responses.
All 12 fresh cases returned the required meal limitation.
The assessor passed 192 cases and failed 15 cases, so its command exited 1.
This is not a complete matrix pass or a release-readiness claim.

Thirteen cap-only cases lack the required fresh canonical price attribution in selected or alternative rows.
The positive baseline also lacks attributable `priceEvidence`.
The impossible one-penny cap returns `DRINK_PRICE_CONSTRAINTS_UNSUPPORTED` instead of actual cap-scarcity evidence.
These 15 failures remain unresolved outside the two selected ownership findings.
They require outer-executor follow-up and are not waived:

| Failed case | Failed expectation |
| --- | --- |
| `canonical/standalone-pint-cap` | missing usable canonical price |
| `canonical/impossible-pint-cap` | refusal lacks actual route or price evidence scarcity |
| `positive/supported-route` | positive baseline has no attributable priceEvidence |
| `supported/fix9-11/front-pint-pizza-amenity/query` | missing usable canonical price |
| `supported/fix9-11/front-pint-pizza-amenity/foodNeeds` | missing usable canonical price |
| `supported/fix9-11/pint-cap-pizza-amenity/query` | missing usable canonical price |
| `supported/fix9-11/pint-cap-pizza-amenity/foodNeeds` | missing usable canonical price |
| `supported/fix9-11/pint-at-serving-meal/query` | missing usable canonical price |
| `supported/fix9-11/pint-at-serving-meal/foodNeeds` | missing usable canonical price |
| `supported/fix9-11/pint-at-serving-food/query` | missing usable canonical price |
| `supported/fix9-11/pint-at-serving-food/foodNeeds` | missing usable canonical price |
| `supported/fix9-11/pint-at-serving-burger/query` | missing usable canonical price |
| `supported/fix9-11/pint-at-serving-burger/foodNeeds` | missing usable canonical price |
| `supported/compound-venue-amenity/fish and chips/pint-only` | missing usable canonical price |
| `supported/compound-venue-amenity/cheese and tomato pizza/pint-only` | missing usable canonical price |

The raw input, attempts, responses, assessments, source hashes, and intermediate runs remain under ignored `artifacts/serving-fix7-review/`.
`http-before.json` contains the original five-case public HTTP reproduction.
`before.txt` and the named red logs retain failed focused reproductions.
`pre-amenity-fix/` retains the complete single-caller replay, its 18 failures, and its source hashes.
`http-attempts.jsonl`, `http-results.json`, and `http-summary.json` contain the final replay and its 15 failures.
`final-suite.txt` and `final-lint.txt` contain the focused green checks, with separate exit-code files.
The public HTTP results exercise a development server and do not establish production behaviour.

## Evidence limits

No complete repository test or lint gate, production build, browser suite, CI, publication, merge, or deployment ran in this review phase.
The outer executor owns those phases and release decisions.
No provider settings changed and no paid provider calls ran.
Earlier onboarding, Lore, Tune, browser, and production evidence remains historical at its recorded hashes.
The unchanged source assertions and focused results do not establish new authenticated, native-device, provider, or retention acceptance.

## Tested source hashes

| File | SHA-256 |
| --- | --- |
| `lib/planPriceLimits.ts` | `5b1328364c6a8b6965d9506c3e7f6d756c222cf8554f4a5ca55975df4e417f90` |
| `lib/planGeneration.server.ts` | `4a5dd951f73f99ddc5fbaddb482b6eaed0008733517cb081eaf56654cdd14281` |
| `__tests__/planPriceCompatibility.test.ts` | `ead43552211c9bb92c6fbcd2f5288c0d45119d699a1e6c65b107311a1041fa82` |
| `__tests__/planGenerateRoute.test.ts` | `063503e6c96e123bc8d995e1c7252919be74f1b10c0c58981edfbc6f283386b5` |
| `lib/nightPlanning.ts` | `e54a6ce5b241d74989ef3297add769158c70d782a20a615fe4c9b52ba7c4cefc` |
