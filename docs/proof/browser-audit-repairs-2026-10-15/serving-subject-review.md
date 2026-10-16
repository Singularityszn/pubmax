# Serving-subject residual review

This proof covers only `serving-subject-residual`, starting from HEAD `26db13b8a4888d6e260bc7cd87bb0da0e04f543f`.
The source hashes below identify the modified worktree used by the passing test run.

The invariant is that a price retains its complete serving subject before the planner applies canonical pint evidence.
It applies to both price directions, query text, and every separate foodNeeds field.
Meal checks, serving refusal, limit extraction, context totals, candidates, and generation consume the shared price parser.
The defect was in recognition of the subject, rather than in the later candidate filter.

Before source changes, preparation and POST reproduced all three reported phrases in both input representations.
Five cases returned 200, while the sixth returned the wrong meal limitation.
The [before output](serving-subject-before.txt) records six failing regression cases against the starting source.
Its reproduction command was:

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts -t 'complete serving qualifiers.*(330 ml of beer under|two pints of beer under|£5 for 330 ml of beer)' --reporter=dot
```

The shared parser now recognises measured servings, quantities, containers, and contents connected by `of` and articles.
It retains their source spans and checks the complete recognised subject against supported pint wording.
The price-before-subject matcher no longer removes articles or quantities before that check.
Unsupported numeric units and container nouns remain unsupported, without conversion to pint evidence.
Bare, `a`, `one`, and `1` pint-of-beer wording retains its enforced canonical cap.
Explicit route-budget precedence remains unchanged.

The tests execute preparation and POST for 25 additional subjects in both price directions and both input representations.
They assert the serving limitation before paid consumption or venue loading.
Parser output assertions also check the complete source spans for these subjects.
Supported single-pint requests exercise canonical candidate evidence, selected stops, alternatives, context totals, and impossible caps.
Additional pint-of-beer meal bundles retain the meal limitation.
All previous food, independent-clause, separate-field, and route-budget assertions remain present.

The first complete focused run found two new foodNeeds fixtures that exceeded the existing 40-character schema limit.
The [intermediate output](serving-subject-intermediate.txt) records those fixture failures and 1,453 passing tests.
The fixtures now use shorter explicit route-total wording and retain their bundle assertions.

The final command was:

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts --reporter=dot
```

All 1,455 tests passed, with no skipped tests.
The [after output](serving-subject-after.txt) records this focused run.
The selected reported sequences now receive the serving limitation through preparation and POST.

This proof uses mocked service boundaries and committed canonical price data.
It does not establish browser, authenticated Pub Pal, provider, physical-device, or full-product acceptance.
The eight earlier browser feedback checks retain their existing source binding in the [browser feedback report](review-feedback/report.md).
Full tests, lint, CI, publication, merge, and deployment remain outside this assigned review phase.

| File | SHA-256 |
| --- | --- |
| `lib/planPriceLimits.ts` | `4a53a6868340d2e5ce63fde99c56fbfd0aa69312a3da3bebf28495250dc4f9ba` |
| `lib/planGeneration.server.ts` | `cef91b25f24ae88c61fa5418a50a7c35c4282e0f2902f55edb33f71b694e0b57` |
| `lib/nightPlanning.ts` | `e54a6ce5b241d74989ef3297add769158c70d782a20a615fe4c9b52ba7c4cefc` |
| `__tests__/planGenerateRoute.test.ts` | `ba8f5d0e5f665a29972d7c20062c5abccde11aa347d069b54191c42d33c83898` |
