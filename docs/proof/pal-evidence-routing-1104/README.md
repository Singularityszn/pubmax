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

## Review findings R7, R8 and R9

This round started at `87d8c065470c1a99328c1859707e29c0eca3a23c`.
The diagnostic executed exported functions before source edits.
R7 already selected `search_venues` for the reported mood-only request, with and without evidence instructions.
Its complete raw query remained in the tool arguments.

R8 and R9 still failed at this head.

| Public function and request | Before this repair | After this repair |
| --- | --- | --- |
| Refine `somewhere quiet and please include sources and dates for every price you quote` after `Find pubs in Camden`, then route | Unsupported price refusal and zero tool calls | `search_venues`, quiet preference and Camden area |
| Refine `somewhere quiet` after an unpunctuated `Find pubs and Show the source and date for any price you use`, then route | Unsupported price refusal and zero tool calls | `search_venues` and quiet preference |
| Detect listings for `What's on in Soho on Friday. Show the source and date for any price you use tonight.` | Tonight window | Friday window, weekday 5, in Soho |
| Read hours for `What are the opening hours at The Lamb; show the source and date for any price you use.` | Requested a pub name and returned no cards | Returned the controlled hours fixture and its source date |

Inherited context must not extend a presentation clause.
This invariant covers both follow-up joins, current and prior presentation clauses, budgets and named subjects.
The area now precedes the complete current question.
When the prior turn supplies the wider request, a semicolon separates the complete turns.
The budget refinement path remains unchanged.

Presentation wording must not change a requested listing day, listing kind, area or named hours subject.
Both consumer parsing boundaries now use the shared import-free presentation policy.
`detectWhatsOnIntent` covers routing and the actual listing tool consumer.
The named-hours parser covers every `searchVenueHours` caller without changing the raw tool context.
The authorised source extension adds `lib/concierge/whatsOn.ts` and `lib/ask/venueHours.server.ts`.
Their existing test files provide the additional public-function and hours regression cases.
No change was made to `tools.ts`, `types.ts`, PR2502 files or the separate caption assertion.

Source tracing covered every caller of the changed functions.
It covered Ask execution, typed chat, client refinement and the provider record-query path.
It also covered listing filtering, named-hours disambiguation, missing hours and ordinary successful routing.
No branch, parameter or helper became unreachable.
The hours module now imports clause parsing directly from its policy owner.

The first final diagnostic found another separator case in the listing consumer.
A semicolon after the area prevented area detection after presentation removal.
The existing area boundary now accepts that separator.
The regression cases cover leading, trailing and consecutive instructions across all five documented separators.

The final Node diagnostic passed 4,709 assertions on the modified source.
It checked both follow-up joins, semantic preferences, original query retention, explicit budgets and genuine romantic preferences.
It also checked listing days and kinds, named pint routing, discovery counts, planning and punctuation-bearing journey endpoints.
All 174 qualified-price fixtures retained their existing coverage codes beside presentation instructions.
Hours checks retained source dates, missing-record honesty and duplicate-name disambiguation.

The diagnostic used Node's TypeScript stripping and local alias and JSON resolution.
It substituted unavailable provider imports and controlled hours storage boundaries.
The Lamb hours record was a local test fixture, not evidence about the real pub.
No provider or live network call supplied these results.
The temporary diagnostic was removed after the run.

The focused six-suite Vitest command exited 127 because `node_modules/.bin/vitest` was absent.
The new HTTP-handler and Vitest regression cases remain unexecuted.
No formal lint or type result is claimed.
The configured Test phase owns dependency preparation and formal validation before publication.
Provider-backed replies and production browser results remain unverified.
These results describe modified source derived from the starting head, not a pipeline-validated commit.


## Review finding R10

This round started at `85f41040f12439302ded02bab114148e40244d60`.
The exported refiner and router reproduced the failure before source edits.
After `pubs in Camden`, `cheap`, `somewhere cheap` and `cheap and quiet` returned no tools.
The prepended area changed the price subject and caused an unsupported-item refusal.
The direct request forms followed by `in Camden` still selected `search_venues`.
`quiet and cheap` also failed without refinement, so this repair preserves that existing guard.

Inherited area context must preserve supported price intent and evidence boundaries.
The invariant covers both follow-up joins, current and prior evidence instructions, and every caller of the shared refiner.
The area now follows the complete current question.
When presentation wording exists, a sentence boundary closes it before the inherited area.
Ordinary requests retain request-then-area composition without an added boundary.
The prior-turn semicolon join and explicit same-area budget path remain intact.
R7 semantic routing and R9 listings and hours parsing remain intact.

The source correction changes only `refineRoutedAskQuery`.
Source tracing covered Ask execution, typed chat, client refinement and provider record-query preparation.
The ordinary path retains the current request, its constraints and complete raw query context.
Food, non-pint and existing unsupported-subject guards remain unchanged.
No alias, helper, parameter or branch became unreachable.
The protected source files and separate caption assertion remain untouched.

Composed-function regressions assert discovery tools, inherited area, moods, group size and the existing £6 cheap-pint cap.
The expected constraints follow the supported request contract and existing keyless cheap-pint policy.
These assertions reject an unsupported refusal, a lost area or an invented romantic preference.
Both HTTP suites compare refinement cards with supported direct Camden requests and require discovery tools and Camden cards.
They also retain unsupported food, drink and baseline subject refusals beside leading and repeated evidence instructions.
These HTTP cases are added coverage, not executed HTTP evidence in this round.


The final Node diagnostic passed 1,324 assertions on the modified source derived from the starting head.
It executed the exported refiner, router, preference parser, listing parser and hours reader.
It checked supported cheap refinements, both evidence-safe joins, original query retention and explicit budgets.
It retained discovery counts, planning, named-pint routing, punctuation-bearing journey endpoints and genuine date-night preferences.
All 174 qualified-price fixtures retained their existing refusal codes beside evidence instructions.
Listing checks retained requested days, kinds and areas across five clause boundaries.
Controlled hours records retained the pub name, opening times and source date.

The diagnostic used Node TypeScript stripping, local alias resolution and JSON loading.
It substituted unavailable provider imports and hours storage boundaries.
The Lamb record was a local fixture, not a claim about the real pub.
No provider or network call supplied the diagnostic results.
The temporary diagnostic was removed after execution.

The focused six-suite Vitest command exited 127 because `node_modules/.bin/vitest` is absent.
The added HTTP and Vitest cases remain unexecuted.
No formal lint or type result is claimed.
Configured Test owns dependency preparation and formal validation before publication.
Provider-backed replies and production browser results remain unverified.


## Review repair round 7: middle evidence and genuine map commands

The starting head was `04d42911d461f1b01448cdcf61b93688835a16eb`.
Both reported defects reproduced through the exported policy before source edits.
Middle evidence merged the journey origin with the transit question.
It also merged a named pint subject with a journey request.
Both `Show me the map` and `Show the map` became empty semantic requests.
The initial focused regression run reported six failures and two passes.
It skipped the remaining 439 tests in that suite.

R11 invariant: Removing presentation instructions must preserve boundaries between surviving requests.
The affected consumers include journey endpoints, transit, named prices, named hours, listings, discovery, and unsupported-item guards.
The shared policy now joins surviving spans at sentence boundaries.
It preserves existing sentence punctuation and punctuation inside venue names.

R12 invariant: A map command must retain map intent when it is the remaining semantic request.
The policy retains map commands when no other semantic request survives.
It still removes map presentation instructions beside discovery, planning, prices, hours, and other requests.
The router no longer restores an erased presentation-only question through its raw-query fallback.
The complete raw question remains available to reply, memory, and tool execution consumers.

Source tracing covered every shared-policy consumer before the final verification run.
Journey parsing and price parsing now receive separate clauses in both orders.
Hours lookup receives the complete named subject beside transit requests.
The ordinary discovery, planning, follow-up, listing, social, heritage, and map paths retain their existing owners.
No helper, parameter, or caller became unreachable.
The protected source files and the separately owned caption assertion remain unchanged.

New executable tests cover both request orders, four boundaries, and repeated evidence instructions.
They assert exact journey endpoints, named pint subjects, supported hours records, and unsupported food and drink guards.
Hours fixtures include `The Lamb`, `Mr. Fogg's`, and `Fox and Anchor`.
The fixtures describe controlled records, not verified opening hours at those pubs.
The map cases execute the actual `palVoiceMapIntent` function after the shared policy.
They also check the existing raw generic-map client decision and the actual server router.
Both HTTP handlers execute genuine generic and named map commands beside evidence instructions.
Both handlers check mixed journey requests through the outbound journey-service arguments.
London Bridge uses its existing canonical service coordinate, `51.50500,-0.08600`.

The first complete focused run exposed nine cheap-follow-up regressions from using conjunction separators.
It also exposed five incorrect new test expectations about default or normalised journey origins.
The policy now preserves sentence boundaries, including the earlier cheap-follow-up repair.
The corrected tests distinguish parsed endpoints from service coordinates.
The final focused run passed all 1,395 tests across eight suites in 5.70 seconds.
The run used one worker at a time and the existing offline network boundary.
The suites were `askRouter`, `askRoute`, `pubPalChatRoute`, `conciergeIntent`, `askVenueHours`, `conciergeWhatsOn`, `palMapAsk`, and `palVoiceTranscript`.
Scoped ESLint passed for the five policy consumers and all eight suites.
Focused TypeScript checking passed for the same files and their imported dependencies.
The check used the existing native TypeScript compiler and repository compiler options.
Its temporary configuration added the existing Next and GeoJSON ambient types.
No Next compiler or type-generation command ran.

Dependency provenance was checked before and after execution.
The temporary `node_modules` link targeted the authorised existing dependency directory:

```text
/Users/karanmanoharan/.no-mistakes/worktrees/0a94b5a8763e/01M6GWEEP8SGPYQ524JFJT6YSQ/node_modules
```

Both worktrees retained these exact SHA256 hashes:

```text
package.json       a45af88f650b428894b9b216d29178687edc2bf9dc3a6f4ce1377184863337c5
package-lock.json  b7b57a95b7c648985e7629ceb22fe13f0d9ba04df19b3514cc6c208a07494bca
```

The tools reported Node `v26.13.0`, npm `12.2.1`, Vitest `5.0.5`, ESLint `10.14.0`, and native TypeScript `7.0.2`.
Before focused execution, the capacity sample reported 72.63 percent idle CPU and 5,647 MB unused memory.
The checks used the existing generated-data restoration wrapper and Vitest setup.
Temporary Vite and module caches stayed inside this worktree.
The dependency link, temporary configurations, diagnostics, logs, and caches were removed after execution.
No dependency installation ran.
No intentional change targeted the dependency directory.

The final test command used the existing configuration with only local cache paths and test-result caching disabled.
The command selected `configLoader=runner` to avoid writing a bundled configuration beside the linked dependencies.
The source file hashes tested by the final focused run were:

```text
lib/ask/requestPolicy.ts  2b542a020db3fc1755b9e0df6f0fd8d7d149d3352e7bb2deccd125bf4abf911f
lib/ask/router.ts         a9a3de685265a81822fcea891aa8982eb46bc7cf354427ae1f926bb20de20f7e
```

These checks prove local deterministic routing and keyless HTTP-handler behaviour.
They do not prove a provider-backed reply, browser navigation, or production behaviour.
Generic map navigation remains the existing client decision.
The server check proves selection of `propose_map_action`, not a new generic map proposal.
The configured outer Test phase remains authoritative for publication.
No broad verifier, PostgreSQL proof, build, deployment, migration, push, or merge ran.
