# Qualified serving noun review

This correction addresses only `qualified-serving-noun-erasure` and regressions found while repairing it.
The starting HEAD is `ea54aecd8d8bfc005812024a3bb9f02af119d703`.
The review base is `599252af3019f3776b5d78d297fae2d871fbd87f`.
The checks exercised uncommitted source identified by the SHA-256 hashes below.

A purchased serving noun must retain its complete modifiers and price ownership through shared normalization.
This invariant covers query text, valid `foodNeeds`, both price directions, all item joins, location masking, route totals, and drink caps.
The defect was a shared ownership error, rather than an isolated price calculation error.
The normalizer inferred a serving verb from following text alone.
It erased quantified nouns before meal classification and location-span processing.

The correction checks a noun prefix together with its postmodifier context.
The prefix recognises quantities, actual serving measurements, and explicit size or preparation descriptors.
Currency amounts cannot become serving quantities.
Measurements retain their quantity qualifiers.
The existing shared food-noun rule continues to retain full postmodifiers and their offsets.
Each-prefixed food subjects also remain visible at joined location boundaries.
Numeric pronouns and `each` use the same context rule.
Venue-serving predicates retain their ordinary path.
No new lookbehind, provider call, retry, fallback, or subsystem was added.

The initial preparation and POST reproduction recorded 918 failures and 2,473 passes.
Its name filter left 7,891 other cases unexecuted.
All six original HTTP requests incorrectly returned 200 before the correction.
They covered the measured noun, both price directions, both location-bundle directions, and valid structured inputs.
All six return `422 MEAL_CONSTRAINTS_UNSUPPORTED` on the final source.
Two final HTTP contrasts return 200 with three stops and a 2000p route budget.
They cover a structured kitchen-owned predicate and a numeric venue pronoun.
No final HTTP request was rate-limited.

Independent review identified overly broad prefix drafts during this round.
Behavioral reproductions caught kitchen, restaurant, rooftop, numeric-bar, shed, and numeric-pronoun predicates.
Those drafts were replaced before final verification.
Additional red checks cover distributive nouns and qualified measurements.
One intermediate test run also rejected two newly added fixtures above the 40-character `foodNeeds` limit.
The corrected fixtures retain every original assertion and use valid fields.
Raw intermediate results remain beside the final evidence.

The final focused verification exited 0:

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts __tests__/nightPlanning.test.ts __tests__/planPriceCompatibility.test.ts --reporter=dot
```

```text
Test Files  3 passed (3)
Tests  12133 passed (12133)
Duration  47.82s (tests 97%, transform 2%, import 1%)
```

The final run has no skips.
It retains all earlier behavioral cases, serving validation, canonical selected and alternative prices, strictest limits, and refusal-before-paid assertions.
New regressions exercise modifiers, article and quantity contexts, measurements, plural nouns, prepositional introductions, joins, and later preferences.
The compatibility test executes module initialization and parsing with a constructor that rejects lookbehind.
Touched-file lint exited 0:

```sh
node_modules/.bin/eslint lib/planPriceLimits.ts __tests__/planGenerateRoute.test.ts __tests__/planPriceCompatibility.test.ts
```

Independent specification and standards reviewers examined the complete branch source diff without changing files or running checks.
The final specification review reported no remaining actionable defect in this correction.
The standards review reported no additional actionable standards finding.
This review does not establish complete natural-language understanding.

Raw red, intermediate, green, lint, HTTP, and source-hash evidence is under ignored `artifacts/qualified-serving-noun-review/`.
HTTP requests used a keyless development server on port 30683 with isolated `.next-serving-noun-review` output.
No pipeline operation, publication, provider change, browser download, or out-of-worktree evidence write occurred.
No complete repository gate, TypeScript gate, production build, browser suite, physical-device check, or CI ran in this review phase.
The outer executor owns those phases and release decisions.
Earlier browser, production, onboarding, Lore, and Tune evidence remains historical at its recorded source hashes.
Those source assertions were preserved, but their suites were not rerun in this focused review round.

| File | SHA-256 |
| --- | --- |
| `lib/planPriceLimits.ts` | `8c1ed64d27bfa09c2714cfe2cf30c3f4861cd52f0053ae34b43e90cdf92bcd72` |
| `lib/planGeneration.server.ts` | `e20ccd7c6a4f75038313f4135d260c06074484c124f7978436b4a594bf0fb2e7` |
| `lib/nightPlanning.ts` | `e54a6ce5b241d74989ef3297add769158c70d782a20a615fe4c9b52ba7c4cefc` |
| `__tests__/planGenerateRoute.test.ts` | `d2766fa4fcd8a817335bfde53009daa2bb8ece7ac2b9215cf36955c022010bc3` |
| `__tests__/planPriceCompatibility.test.ts` | `25023de3fa8b60fae9a9bb855c1015d56ab9bb5097ca6197ae38ce6b6257e851` |
| `__tests__/nightPlanning.test.ts` | `1e42c012c364815da18af033c28c5feb0abe59321314c431232dacda0ef9432b` |
