# Qualified venue-serving predicate review

This correction addresses only `qualified-venue-serving-predicate`.
The starting HEAD is `469767da4ebf6d510b74393bef000112b542cf33`.
The review base is `599252af3019f3776b5d78d297fae2d871fbd87f`.
The checks exercised uncommitted source identified by the SHA-256 hashes below.

Venue-serving predicates must remain separate from purchased serving nouns and their prices.
This invariant applies to query text, valid `foodNeeds`, both price directions, item joins, location masking, route budgets, and pint ceilings.
The qualifier veto treated arbitrary antecedent words as serving adjectives.
It mistook `each` and `a garden` for food-noun prefixes.
The shared normalizer now uses its direct-object boundary without that veto.
The correction removes the qualifier and its currency-masking operation.
Serving nouns retain their existing modifier, price, and clause boundaries.
Normalization still preserves character offsets and adds no lookbehind.

The initial targeted preparation and POST run recorded 38 failures and 230 passes.
Its name filter left 6,367 unrelated cases unexecuted.
Three representative HTTP requests also returned `422 MEAL_CONSTRAINTS_UNSUPPORTED` before the correction.
They covered `each serving beer`, `with a garden serving beer`, and valid structured `foodNeeds`.
Those same HTTP requests returned `200` with a 2000p route budget after the correction.

The complete focused run exited 0 with 8,001 passes and no skips:

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts __tests__/nightPlanning.test.ts __tests__/planPriceCompatibility.test.ts --reporter=dot
```

The added cases cover distributive subjects, adverbs, venue amenities, coordinated amenities, both budget orders, and valid structured fields.
The cap cases retain canonical price assertions for candidates, selected stops, and alternatives across both price directions and location modifiers.
Existing tests retain quantified serving nouns, plural nouns, modifiers, meal refusals, later preferences, and refusal-before-paid assertions.
The compatibility test executes the added cases with a RegExp constructor that rejects lookbehind.
No existing assertion was removed or weakened.

Touched-file lint exited 0:

```sh
node_modules/.bin/eslint lib/planPriceLimits.ts __tests__/planGenerateRoute.test.ts __tests__/planPriceCompatibility.test.ts
```

HTTP contrast checks preserved a meal refusal for a priced serving bundle and a route for an unpriced later serving preference.
Two extra contrast requests initially reached the normal `429 RATE_LIMITED` response.
The same requests produced the expected meal refusal and route after the unchanged rate-limit window expired.
The raw responses remain in ignored `artifacts/qualified-serving-review/` beside the test and lint logs.

The HTTP checks used a keyless development server on port 30672 with `.next-qualified-serving` as its isolated build directory.
No paid calls, provider changes, browser downloads, pipeline operations, or out-of-worktree evidence writes ran.
No full repository gate, production build, browser interaction, physical device check, or fresh complete branch review ran in this repair phase.
The outer executor retains those validation phases and all publication decisions.
Earlier browser and production evidence remains historical at its recorded hashes.

| File | SHA-256 |
| --- | --- |
| `lib/planPriceLimits.ts` | `735fbff1fefbf37a205345fca25a6d7fc76b08d74aea94ff2eb4ce20546613df` |
| `lib/planGeneration.server.ts` | `e20ccd7c6a4f75038313f4135d260c06074484c124f7978436b4a594bf0fb2e7` |
| `__tests__/planGenerateRoute.test.ts` | `1a56d5e80a142891339e766608deab693a243f1770e75d6a3e87d2a4e73f370b` |
| `__tests__/planPriceCompatibility.test.ts` | `85ef13ef0145dcb7a3f9e6c3722c70ec1ca374c65be429c9105dd02d58076dbd` |
| `__tests__/nightPlanning.test.ts` | `1e42c012c364815da18af033c28c5feb0abe59321314c431232dacda0ef9432b` |
