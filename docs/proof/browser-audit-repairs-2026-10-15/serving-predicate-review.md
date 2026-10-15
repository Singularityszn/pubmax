# Venue-serving predicate review

This review addresses only `serving-verb-drink-amenity-regression`.
The starting HEAD is `af8ab3da458b3f39011746b0b4bc1986b7f50ba3`.
The review base is `599252af3019f3776b5d78d297fae2d871fbd87f`.
The checks below ran against the uncommitted source identified by these hashes.

Venue-serving predicates must remain distinct from priced serving nouns, without changing ownership of amounts.
The invariant applies to query text, valid `foodNeeds`, both price directions, location modifiers, route budgets, and pint ceilings.
The normalizer previously recognized a serving verb only when its object contained a known food word.
It now recognizes descriptive objects using grammatical boundaries while retaining noun qualifiers, noun modifiers, and currency context.
Generic food amenities also remain amenities inside coordinated serving descriptions.
The normalizer preserves character offsets and introduces no lookbehind.
The redundant noun-content branch was removed because the predicate boundary excludes `of`.

The initial targeted preparation and POST reproduction recorded 12 failures and 26 passes.
Three real HTTP requests also returned `422 MEAL_CONSTRAINTS_UNSUPPORTED` before the repair.
The requests cover `serving beer`, `serving real ale`, and a valid structured `foodNeeds` field.
Those same HTTP requests now return `200` with a 2000p route budget.

The final focused command exited 0 with 6,515 passes and no skips:

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts __tests__/nightPlanning.test.ts __tests__/planPriceCompatibility.test.ts --reporter=dot
```

The suites retain the earlier serving-noun refusals, later preferences, meal bundles, canonical price caps, alternative stops, and refusal-before-paid assertions.
New cases cover descriptive drink objects, coordinated food amenities, both budget orders, price directions, location modifiers, and valid structured fields.
Soft-drink requests reach the existing grounded price-evidence refusal when canonical evidence is unavailable.
The compatibility test also executes the new predicate cases with a RegExp constructor that rejects lookbehind.

Touched-file lint exited 0:

```sh
node_modules/.bin/eslint lib/planPriceLimits.ts lib/planGeneration.server.ts __tests__/planGenerateRoute.test.ts __tests__/planPriceCompatibility.test.ts
```

Raw diagnostics remain in ignored `artifacts/serving-predicate-*` files within this worktree.
The HTTP checks used an isolated keyless development server on port 30671 with a separate build directory.
No paid calls, provider changes, browser downloads, or pipeline operations ran.
No production build, browser interaction, physical device, or full repository gate ran in this phase.
Earlier production and browser evidence remains historical at its recorded hashes.
The outer executor must obtain a fresh full-branch review and run its remaining configured validation phases before publication.

| File | SHA-256 |
| --- | --- |
| `lib/planPriceLimits.ts` | `76c07d060c192559bffba91b9f9e0c47558d2cdeb1a51df011d8840176857b6f` |
| `lib/planGeneration.server.ts` | `e20ccd7c6a4f75038313f4135d260c06074484c124f7978436b4a594bf0fb2e7` |
| `__tests__/planGenerateRoute.test.ts` | `bf43b33929733477134ba84115f18badfeec8159eaf3283ce24f9197662b5f45` |
| `__tests__/planPriceCompatibility.test.ts` | `f120e6dc6cee29d6094f39743af1267ec347346af5fceb3a69839974cbc8ef10` |
| `__tests__/nightPlanning.test.ts` | `1e42c012c364815da18af033c28c5feb0abe59321314c431232dacda0ef9432b` |
