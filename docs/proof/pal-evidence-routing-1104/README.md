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

## Review findings R3 and R4

This round started at `04048d0ca5012d879abbb095ebeb6f303868ab43`.
The previous repair still depended on a partial list of request verbs after sentence boundaries.
A focused Node diagnostic reproduced all three reported requests before this round changed source.
Each request returned `UNSUPPORTED_PRICE_COMPARISON` and no tool calls.
The discovery requests also gained an unwanted `date` mood.
The planning request gained `date` despite having no requested mood.

| Request after the leading evidence sentence | Required result |
| --- | --- |
| `Recommend three quiet pubs in Soho.` | `search_venues`, limit 3, quiet mood |
| `Suggest three quiet pubs` | `search_venues`, limit 3, quiet mood |
| `Sort me a night in Soho` | `propose_plan`, no romantic preference |

The shared policy now removes complete presentation spans at sentence, semicolon, comma and conjunction boundaries.
It does not require a recognised verb in the following request.
It preserves non-presentation text, including punctuation inside `Mr. Fogg's`.
The original complete query remains in router arguments and draft proposals.
The existing unsupported-item guards still inspect real burger and wine requests.
The correction changes no tool implementation or public router export.

The regression tests execute the public semantic policy, router and preference parser.
The existing HTTP-handler tests now include recommendation and suggestion requests.
The draft-tool test also includes the reported planning opener.
Their expected results follow the required discovery, planning and coverage contracts.
They reject refusal, an added romantic preference, lost constraints and a changed venue name.

The R4 change removes only the implementation-comment assertion.
It retains the literal threshold checks and executable checks at and below the mood threshold.
The remaining fixture reads consume test data, not implementation source.

Vitest, ESLint and the configured TypeScript compiler remain absent from this worktree.
No dependencies were installed or borrowed.
The focused Node diagnostic cannot replace the configured tests, HTTP checks, lint or types.
The native pipeline must run those checks before publication.
Provider-backed replies and production browser results remain unverified.

The final focused Node diagnostic passed 604 assertions on this round's modified source.
It checked the three reproduced openers, five clause boundaries and unchanged punctuation inside a venue name.
It also checked budgets, group sizes, genuine romantic preferences, named pint routing and journey endpoints.
All 174 existing qualified-price fixtures retained their guards with leading and trailing evidence instructions.
The diagnostic executed the real router and keyless preference parser with only unavailable provider imports substituted.
Its first threshold probe supplied an incomplete mood record and failed the record validator.
The corrected probe supplied every mood and confirmed the existing threshold behaviour without a product change.

The focused four-suite Vitest command could not start because `node_modules/.bin/vitest` was absent.
No HTTP, lint or configured compiler check passed in this round.
The temporary diagnostic was removed after the run.
These results describe modified source derived from the starting head, not a new committed or pipeline-validated head.

## Review findings R3 and R5

This round started at `afb2ba522a747b59060f083cb547c1e6da0bcab3`.
The before diagnostic executed the real router, semantic policy and preference parser through Node.
It confirmed that the existing R3 repair already preserved `Recommend`, `Suggest` and `Sort me a night` requests.
Those requests selected discovery or planning and retained their requested moods.
No further request-verb list was added.

The diagnostic reproduced R5 with this request:

> Find three quiet pubs in Soho. Show sources for any price you use and show the date for every price you quote.

The first evidence match consumed `and` and left the second instruction without a recognised starting boundary.
The router returned `UNSUPPORTED_PRICE_COMPARISON` with no calls.
The deterministic parser added `date` to the quiet mood.
The model input also retained the second evidence instruction.
The provider boundary used a local stub and made no network call.

Removing evidence instructions must preserve the complete semantic request after one call.
This invariant applies to leading, trailing and adjacent instructions, including polite wording and punctuation.
It also applies to discovery, planning, named pint questions and journey endpoints.
Both preference paths and the food and non-pint price guards share this boundary.
Replies, memories and proposals must retain the original complete question.

The shared matcher now recognises a conjunction consumed by the preceding complete evidence match.
The correction changes one boundary expression and adds no retry, state or helper.
The remaining request retains its punctuation, preferences, area, group size and budget.
Neither router tool arguments nor proposal context change.
The R4 cleanup and executable probability-threshold checks remain intact.

Regression cases execute the semantic policy, router, preference parser and existing HTTP-handler seams.
Their oracles are the required requests and existing unsupported-item coverage contracts.
They reject retained evidence clauses, an added romantic preference, lost constraints and changed raw tool queries.
They also reject changed punctuation in `Mr. Fogg's` and removal of genuine burger or wine requests.
The model-boundary cases assert the emitted semantic request without contacting a provider.

Vitest, ESLint and the configured TypeScript compiler remain absent from this worktree.
No dependencies were installed or borrowed.
The focused Node diagnostic cannot replace the formal tests, HTTP checks, lint or types.
The configured Test phase still owns dependency preparation and validation before publication.
Provider-backed replies and production browser results remain unverified.

The final Node diagnostic passed 1,420 assertions on this round's modified source.
It checked eight clause boundaries with leading and trailing evidence chains.
It retained discovery counts, planning, genuine romantic preferences, budgets, group sizes and named pint routing.
It preserved journey endpoints and punctuation in `Mr. Fogg's`.
All 174 existing qualified-price fixtures retained their guards beside evidence chains.
An unsupported item between two evidence instructions also retained its guard.
Both preference paths retained the complete semantic request after one extraction.
The diagnostic substituted only unavailable provider imports and resolved local aliases and JSON modules.

Two initial diagnostic expectations exceeded the existing router grammar.
They expected three results for `three quiet date-night pubs` and planning for `Sort me a quiet night`.
The final probes used `three quiet pubs ... for a date-night` and `Sort me a night`.
These changes corrected diagnostic inputs, not product source.

The focused four-suite Vitest command exited 127 because `node_modules/.bin/vitest` was absent.
The added HTTP and Vitest regression cases remain unexecuted in this round.
No formal lint or compiler result is claimed.
The temporary diagnostic was removed after the run.
These results describe source derived from the starting head, not pipeline validation.

## Review finding R7

This round started at `8d3da265cae893e084967c4c5b544b776a757288`.
The exported router reproduced the reported failure before source changes.

| Request | Before this repair |
| --- | --- |
| `Quiet-ish near Bank, 4 of us.` | `search_venues`, limit 4 |
| The same request with price source and date instructions | `venue_prices`, with evidence words inside the venue name |
| The same request with `Show the map.` | `propose_map_action`, with the discovery request inside the venue name |

Every routing decision must use the semantic request while reply and tool query context retain the complete request.
The defect came from inconsistent interpretation across sibling routing branches.
The routing entry now uses the shared semantic policy before selecting any tool.
Counts, subjects, venue names, journey endpoints, areas and occupancy levels use that semantic text.
Tool query arguments retain the complete original text.
An instruction with no remaining semantic request retains its existing standalone routing behaviour, including a plain map action.

Exported hours, journey, discovery and social helpers apply the same policy when callers supply original text.
Follow-up classification and prior-area extraction also use semantic text.
Follow-up results retain the complete request and its evidence instructions.
The price helpers already share semantic interpretation through `priceQuestion`.
No tool implementation, type contract or presentation-clause grammar changed.

The repair retains city status, transit, journeys, hours, heritage, listings and every concierge claim.
Named prices, menu requests, genuine map actions, plans and discovery retain their ordinary paths.
The food and non-pint guards still receive real unsupported subjects.
No helper or caller became unreachable.

Regression tests use literal expected tools and arguments from supported requests and the required discovery contract.
They cover leading, trailing and consecutive evidence instructions, raw query context, mood-only discovery and generic map presentation.
They also cover punctuation in a venue name, counts, budgets, group sizes and genuine romantic preferences.
Both existing HTTP-handler suites check discovery and stable venue choices beside evidence instructions.
Parser tests check deterministic preferences and the emitted model request without contacting a provider.

Dependencies remain absent from this worktree.
The configured Test phase owns dependency preparation and formal validation.
Provider-backed replies and production browser results remain unverified.

The final R7 Node diagnostic passed 1,008 assertions on the modified source.
Two final exported-router assertions also passed for the exact reproduced price-evidence and map-presentation sentences.
Both selected `search_venues`, retained the complete query and kept the limit of four.
It executed the real router, semantic policy and preference parser.
It checked 19 supported routing forms with leading, trailing and consecutive presentation instructions.
All 174 qualified-price fixtures retained their existing coverage codes beside those instructions.
It also checked exported helpers, follow-ups, standalone map actions, group sizes, budgets and genuine romantic preferences.
The model-input check substituted unavailable provider imports and made no provider call.
Two diagnostic inputs initially lacked a real clause boundary before their evidence instructions.
The corrected inputs used an explicit conjunction and required no product change.

The focused four-suite Vitest command exited 127 because `node_modules/.bin/vitest` was absent.
The added Vitest and HTTP regression cases remain unexecuted.
No formal lint or compiler result is claimed.
The Node diagnostic does not replace those checks.
These results describe modified source derived from the starting head, not a pipeline-validated commit.
The temporary diagnostic was removed after its run.
