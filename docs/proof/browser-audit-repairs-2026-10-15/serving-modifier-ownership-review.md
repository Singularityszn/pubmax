# Serving modifier ownership review

This review addresses `postmodified-serving-ownership-incomplete` and `eager-serving-lookbehind-ios15-risk`.
The starting HEAD is `5bdb675464c6e67872c37a1bf363d7f23e57b285`.
The review base is `599252af3019f3776b5d78d297fae2d871fbd87f`.
The checks below exercised the repaired, uncommitted worktree, identified by the source hashes below.

Complete serving noun phrases must retain their price ownership through matching, location masking, preparation, and POST handling.
This invariant applies to query text, valid `foodNeeds`, both price directions, joined bundles, and independent route budgets.
The earlier recognition rule missed bare plurals with modifiers and truncated qualified phrases before checking `later`.
The shared noun rule now retains modifiers until a price or clause boundary.
The shared text boundary distinguishes venue-serving predicates using noun prefixes and currency context.
Predicate normalisation retains character offsets and uses the existing `serves` predicate vocabulary.
The change removes the added lookbehind and the incomplete following-token allowlist.

The initial preparation and POST reproduction recorded 47 failures and 1,302 passes.
The failures include bare plural prices and unpriced later preferences with independent route totals.
The final focused command exited 0 with 6,051 passes and no skips:

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts __tests__/nightPlanning.test.ts __tests__/planPriceCompatibility.test.ts --reporter=dot
```

The complete affected suites retain the prior meal refusals, serving validation, canonical caps, selected stops, alternatives, and refusal-before-paid assertions.
New cases cover plural modifiers, both price directions, location bundles, structured fields, and independent later preferences.
All existing Tune visibility, viewport, focus, reopen, and Escape assertions remain unchanged.
Touched-file static checks exited 0:

```sh
node_modules/.bin/eslint lib/planPriceLimits.ts __tests__/planGenerateRoute.test.ts __tests__/planPriceCompatibility.test.ts
```

The compatibility test executes module initialisation with a RegExp constructor that rejects lookbehind.
An additional execution of transpiled starting and repaired modules under the same constructor recorded:

```text
starting HEAD SyntaxError Lookbehind is unavailable
repaired worktree initialized {"pintCeiling":5,"routeBudgetPence":2000}
```

This demonstrates the removal of the new constructor dependency and preserves currency-versus-quantity behaviour in that simulation.
[WebKit's Safari 16.4 release notes](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/) identify that release's positive and negative lookbehind support.
No old Safari runtime, emitted browser bundle, or physical device executed these checks.
Existing unrelated lookbehind remains outside this correction.
These checks establish neither a newly observed device regression nor previous full Safari compatibility.

Two independent agents reviewed the complete base-to-worktree branch diff for spec conformance and standards.
Neither reported an actionable finding.
Those reviews were read-only source reviews, without additional tests or browser checks.
Raw diagnostic logs remain in the ignored worktree directory `artifacts/serving-ownership-review/`.
Earlier production and browser evidence remains historical at its recorded hashes.
Full repository validation, browser validation, CI, publication, merge, and deployment remain with the outer executor.
No provider settings changed and no paid calls ran.

| File | SHA-256 |
| --- | --- |
| `lib/planPriceLimits.ts` | `9cdceb1b5341f6cbbe179ee1334c1ca9c2a94cb07a883a0b65d607c3292d5ced` |
| `lib/planGeneration.server.ts` | `5bd5569daf8fa7d5254af3d9b813dd212e7f54611cb9e4dc38c5838a48e20421` |
| `lib/nightPlanning.ts` | `e54a6ce5b241d74989ef3297add769158c70d782a20a615fe4c9b52ba7c4cefc` |
| `__tests__/planGenerateRoute.test.ts` | `bf2e26443008c598fd66273f040f6163d40f79df733e792af739f631fc6b8c76` |
| `__tests__/planPriceCompatibility.test.ts` | `784fc790a4b28e05670309b9d7ee52ac7aec11f373172919859c3b565d73549a` |
| `__tests__/nightPlanning.test.ts` | `1e42c012c364815da18af033c28c5feb0abe59321314c431232dacda0ef9432b` |
