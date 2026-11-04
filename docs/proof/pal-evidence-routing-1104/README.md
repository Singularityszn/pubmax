# Pub Pal price-evidence routing, 4 November 2026

The original router treated a request for price sources as an unsupported item-price question.
The repair keeps evidence instructions separate from the requested pub or crawl.

The base is `445df3a6bc85f2403f984a5f4a32e3e62d9731ff`.
The first repair changed `lib/ask/router.ts`.
The review repair also changes `lib/concierge/intent.ts` and adds the shared `lib/ask/requestPolicy.ts` policy.

## Reproduced request

> Find three quiet pubs in Soho for tonight. Show the source and date for any price you use.

The original executable router returned `UNSUPPORTED_PRICE_COMPARISON` and no tool calls.
Its reply began "I can compare listed pint prices, but not prices for that item yet."
Both HTTP regression tests failed because `toolsUsed` was empty.

The repaired router selects `search_venues` and preserves the original query and limit of three.
Both HTTP handlers return three pub cards instead of the unsupported-item refusal.
The request does not require every pub to have a recorded price.

| Public interface | Before | After |
| --- | --- | --- |
| `routeAskDeterministically` | No tool calls | `search_venues`, limit 3 |
| `POST /api/ask` | No tool selected | Three pub cards |
| `POST /api/pub-pal/chat` | No tool selected | Three pub cards |

## Retained boundaries

The matcher accepts whole source, date and map instructions with a generic price qualifier.
It recognises those instructions before or after a discovery or planning sentence.
An explicit burger or wine price subject remains in the existing price policy.
The tests also retain an unsupported item request beside an otherwise valid evidence instruction.

The HTTP tests execute the real handlers and router.
They use the existing offline network boundary and keyless configuration.
They do not contact a model provider or change a real account.
Provider-backed replies, browser rendering and a production replay remain outside this proof.

## Verification

The original router failed the exact request through both HTTP interfaces.
A separate leading-evidence case failed before its sentence-boundary repair.
The first repair's historical focused run passed 1,016 tests across three suites.
That run did not catch the preference change or both clause-boundary failures.

```sh
node_modules/.bin/vitest run __tests__/askRouter.test.ts __tests__/askRoute.test.ts __tests__/pubPalChatRoute.test.ts --maxWorkers=1
```

The original-router replay restored the repaired source in a `finally` block.
No test changes the router source during normal execution.


## Review findings R1 and R2

The review started at `ae186a14cb4776f1259c49f517f6fadd471b27f7`.
The final diagnostic checked the modified worktree derived from that commit.
It does not attest to a new committed head or pipeline validation.

The first repair did not fully preserve request constraints.
The review reproduced three failures through the candidate's public parser and router before source changes.

| Request | Before the review repair | After the review repair |
| --- | --- | --- |
| Exact discovery request with source and date wording | Moods changed from `[quiet]` to `[quiet, date]` | `[quiet]`, Soho, group 2, no budget, router limit 3 |
| Discovery followed by `and please include sources and dates for every price you quote` | `UNSUPPORTED_PRICE_COMPARISON`, no tool calls | `search_venues`, limit 3, complete query retained |
| Evidence sentence followed by `How much is a pint at The Lamb?` | `venue_drinks` instead of `venue_prices` | `venue_prices`, The Lamb |

One import-free policy now owns request clause boundaries and whole presentation-clause removal.
The router uses the policy for price interpretation.
The preference parser uses the policy before deterministic and model-assisted interpretation.
Discovery and crawl handlers both use that parser.
Their original complete query remains available for replies, memory and draft proposals.
Real date-night and romantic preferences remain in the semantic request.
Explicit burger and wine subjects remain in the price policy.

Regression oracles come from the required user request and the existing food and drink coverage rules.
The tests execute the public router, preference parser, tool handlers and existing HTTP handlers.
They check literal requested moods, area, group size, budget, count and tool names.
They reject an added romantic preference, a lost constraint, an unsupported-item bypass and a changed draft query.
The model-boundary test checks the emitted request text without contacting a provider.

The worktree has no `node_modules` directory.
Vitest, ESLint and the configured TypeScript compiler are unavailable.
The new Vitest and HTTP assertions remain unexecuted in this review round.
A temporary Node diagnostic executes the real router and preference parser with `skipModel: true`.
It resolves local aliases and JSON modules and substitutes only unavailable provider imports.
It does not replace either parser or routing logic.
Provider-backed replies and production browser results remain unverified.

The final Node diagnostic passed 218 cases on the modified source, with zero failures.
It checked leading, trailing and polite evidence clauses for discovery and planning.
It also checked explicit budgets, group sizes, real romantic preferences and named pint routing.
The existing qualified-price fixtures retained their unsupported-item guards.
Journey and venue-hours routing retained their ordinary paths.
The diagnostic initially used geocoded HTTP fixture outputs for a text-only journey parser.
That diagnostic assertion was corrected to the parser's named-endpoint contract before the final run.
No product change was needed for that diagnostic error.

Vitest and ESLint commands failed because their local executables are absent.
The configured TypeScript compiler also failed to start because its module is absent.
These missing-tool results are not passing checks.
No dependencies were installed or borrowed from another checkout.
The temporary diagnostic was removed after the run.
The native pipeline still owns the authoritative tests, lint, types and publication.
