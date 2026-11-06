# ADR 0014: Night OS Ask agent

## Status

Accepted

## Context

Ask on the map, Pal chat, The Landlord (heritage), CityMCP London facts, and
plan generation were separate brains. Users could not ask one question that
spanned prices, What’s On, transit, heritage, and a crawl proposal. Market
Ask Maps analogues (agentic multi-step with user confirm, transit in chat,
session memory) raise the bar without licensing silent mutation.

ADR 0006 already forbids Pal (and any companion) from silently mutating plans,
memory, invites, or recommendations. A unified agent must stay a proposer.

## Decision

Ship one Night OS Ask surface over a **server tool registry** and `POST /api/ask`:

1. **Tool allowlist only** — `search_venues`, `whats_on`, `venue_heritage`,
   `venue_prices`, `city_status`, `journey`, `area_buzz`, `propose_plan`,
   `propose_map_action`, plus the V0.1 concierge wave (master plan R-015):
   `cheapest_pint_near`, `tonight_now`, `venue_drinks`, `find_desk`,
   `report_occupancy`. No open web browse (`PAL_WEB_GROUNDING` stays off).
   The list is pinned by `__tests__/askRouter.test.ts`; the V0.1 five keep
   their policy and their words in `lib/ask/conciergeTools.ts` and their
   handlers in `lib/ask/conciergeTools.server.ts`.
2. **Grounded answers** - cards with recorded answers carry provenance, as does
   every figure. Tools never invent pint prices. Uncorroborated community rows
   may appear on the pub’s own sheet language only. Map-authority claims
   require corroboration.
   `lib/ask/routingPolicy.ts` owns shared deterministic tool selection, price-subject routing and client map priority.
   `lib/ask/router.ts` re-exports server routing and owns conversation refinement.
   `lib/ask/requestPolicy.ts` owns shared clause parsing and `semanticAskRequest`.
   It removes complete price-evidence instructions before intent classification.
   Its default view preserves standalone map commands beside other text.
   `GENERIC_MAP_COMMAND_RE` defines generic commands for both service parsing and client navigation.
   Verb commands accept unpunctuated social prefixes, full or whole map modifiers and polite tails.
   Bare map nouns require a clause boundary, which preserves named on-the-map subjects.
   Service parsers explicitly omit map commands from venue, price, preference, listing and hours subjects.
   Removal preserves boundaries between surviving requests and punctuation inside venue names.
   Explicit map commands are checked after service intents and before the default venue search.
   Greetings and acknowledgements cannot replace a map command with a default search.
   A refusal before or after navigation text prevents navigation across punctuation (`navigationIsRefused` in `lib/ask/requestPolicy.ts`).
   The noun in "next stop" does not count as a refusal.
   A "not" inside an ordinary clause, as in "I'm not sure where I am", does not count as a refusal either.
   Shared concierge constraints preserve implicit discovery without treating a default group size as a request.
   Real food and non-pint price subjects remain visible to the coverage guards.
   Replies, memory and tool context retain the complete original question.
   Short follow-ups inherit area context after closing evidence instructions, without changing supported price intent.
   Regression coverage includes `__tests__/askRouter.test.ts`, `__tests__/conciergeIntent.test.ts`,
   `__tests__/conciergeWhatsOn.test.ts`, `__tests__/askVenueHours.test.ts` and both HTTP-handler suites.
   `__tests__/palChatMapDispatch.test.tsx` covers mounted client dispatch.
   `__tests__/palVoiceTranscript.test.ts` covers shared navigation and refusal guards.
   Named menu requests and unsupported price comparisons use deterministic
   `runAsk` even when a model provider is configured.
   Explicit named questions about opening or closing hours or times also
   bypass the map Ask model loop. `search_venues` delegates these questions to
   `lib/ask/venueHours.server.ts`. Keyless typed chat preserves the result
   before its discovery fallback. Other discovery and crawl requests retain their
   existing routing.
   The resolver isolates the hours clause before matching a complete venue
   name or alias. It tries complete names before removing a grammatical
   possessive. Nearby landmarks cannot replace the requested pub.
   It reads usable Google Places hours first, then website hours, then the
   existing directory schedule. Freshness limits come from `PLACES_REFRESH_DAYS`
   and `OPENING_EVIDENCE_FRESH_DAYS`. Website and directory evidence require a
   source URL. `__tests__/askVenueHours.test.ts` covers source precedence and
   name resolution. `__tests__/pubPalChatHours.test.ts` covers the keyless chat
   response and combined transit questions.
   `runAsk` checks `lib/ask/lateFoodAnswer.server.ts` before normal tool routing
   and the OpenRouter loop. It returns accepted late-food results as
   `search_venues`, without pub IDs, prices or plan proposals.
   The handler reads the existing [food-terminal evidence contract](../API_CONTRACTS_THE_LOCAL.md#10-get-apilate-food--crawl-ending-food-terminals).
   `lib/ask/lateFoodQuestion.ts` owns question parsing and follow-up resolution.
   It merges field replies only from an accepted earlier user question and
   validates each corrected question. Rejected questions retain general Ask routing.
   Keyless typed chat preserves late-food results, including clarification,
   before its taste-based discovery fallback.
   `invokePubPalAskTool` uses the same handler for tools other than independent
   transport and city-status tools. The hosted agent still selects webhook tools.
   Regression coverage is in `__tests__/askLateFood.test.ts` and
   `__tests__/pubPalChatRoute.test.ts`.
   `runAskTool` applies the original question before speculative model arguments.
   `venue_drinks` also reads accepted food and drink menu items through
   `lib/ask/publishedMenu.server.ts`, preserving each field's source and date.
   Its cards carry optional `menuEvidence`, including recorded servings,
   calories and dietary labels. Current availability stays unknown.
   Independent transit and city-status clauses can still answer.
   The [Pub Pal feature guide](../../README.md#features) owns supported user
   requests and coverage limits.
3. **Propose, never apply** - Ask mutates nothing. `propose_map_action` returns
   a proposal the client applies only after an explicit Confirm.
   A person's explicit generic map command uses client-owned navigation without requiring a server proposal or invented venue cards.
   On the server, `isGenericMapAsk` (`lib/ask/routingPolicy.ts`) keeps any pub name out of such a command, so neither its leftover words nor a model's guess become a venue.
   Assistant suggestions still require confirmation.
   `propose_plan` returns a draft the client carries to `/plan` behind one "Open in Plan" link
   (`planPalRouteHandoffHref` in `lib/planOccasion.ts`), which prefills the same
   ask there and saves nothing until the drinker acts on it; a Confirm button
   beside that link would be two labels for one action. No silent Plan or
   durable Pal memory writes from Ask.
   **Amended 3 Nov 2026 (captain): Plan keeps the drafted pubs.** The link used
   to carry only the ask, so Plan answered it with pubs of its own and the
   draft vanished. Two halves now hold together. The draft is a crawl Plan can
   walk: `propose_plan` ranks a wider pool and keeps only three that pass
   Plan's own walking rule (`walkableDraftRoute` in `lib/palPlanDraft.ts`,
   asking `straightLineWalkableKm` in `lib/planRouteOptimizer.ts`), or says
   the pubs are too far apart. And Plan keeps the draft: the session draft
   rides with its own ask, and `/plan` generates through the anchored path
   that already keeps an imported pub list (`palDraftAttempts` in
   `lib/palPlanHandoff.ts`, an anchor whose `venueIds` is the whole draft and
   whose source is `pal`, or `map-search` for Ask the map). Plan still checks
   every stop. When it cannot stand behind the whole draft it keeps the first
   pub and chooses the rest, then plans from the ask, and the route status
   says which of the three happened (`palDraftOutcomeLine`). Nothing is saved
   until the drinker locks it in. Pins: `__tests__/palPlanDraft.test.ts`,
   `__tests__/palPlanHandoff.test.ts`, `e2e/pal-plan-keeps-draft.spec.ts`.
4. **Keyless path (map Ask)** - without `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`, `POST /api/ask`
   uses deterministic tools and house-voice templates.
   Decision 2 defines the recorded-answer routing exceptions.
5. **Bounded model loop (map Ask)** - with Claude when `ANTHROPIC_API_KEY` is set,
   else OpenRouter, tool-calling on `POST /api/ask` is allowlisted.
   It uses low temperature or low effort, with capped rounds and tokens.
   The safety check below precedes this loop. The model selects tools only.
   For model-routed turns, `composeAnswer`
   builds reader copy from returned hints and cards.
6. **Pal typed chat and voice (ElevenLabs when configured)** — without
   `ELEVENLABS_API_KEY` and `ELEVENLABS_PUB_PAL_AGENT_ID`, typed chat on
   `POST /api/pub-pal/chat` uses the same keyless `runAsk` tool path as map Ask
   (`skipModel: true`). With both values set, typed chat and voice share one
   ElevenLabs agent, subject to the menu and price routing in decision 2.
   [Pub Pal setup](../PUB_PAL_SETUP.md) owns the session transport details. Server
   webhook tools at `POST /api/pub-pal/tools/{name}` invoke the same ADR 0014
   handlers as `/api/ask`. Tool-turn correlation uses `pub_pal_tool_turns`
   (`lib/pubPalToolTurnStore.ts`): webhook bodies may carry only a short query
   fragment, so the server prefers the correlated full ask and merges routed
   args before invoking handlers. Setup: `docs/PUB_PAL_SETUP.md`.
7. **In-thread memory only** — the client may resend recent turns for
   refinement. Durable Pal memory stays confirm-gated (ADR 0006).

`POST /api/concierge` is **withdrawn** (#1414). It named plan Sort-it and
legacy callers, but plan Sort-it posts to `/api/plans/generate`, Map Ask posts
to `/api/ask`, Pal typed chat posts to `/api/pub-pal/chat`, and no caller of
the route was ever found in `app`,
`components` or `lib`. The reusable engine stays: `lib/concierge/rank.ts`,
`lib/concierge/whatsOn.ts`, `lib/concierge/intent.ts` and
`lib/concierge/venues.server.ts` are imported by `/api/ask` and
`/api/plans/generate`. Only the orphaned HTTP wrapper was removed.
`parseConciergeIntent` is TypeSafe when keyed (`lib/ai/typesafe.server.ts`)
and the mood/area/group/budget regex table when not. It no longer calls
OpenRouter.

### Sobriety and getting-home routing

The [Pub Pal feature guide](../../README.md#features) owns the user-facing safety response.
`runAsk` checks the current query and user history through `lib/pubPalLlmFence.ts`
before deterministic tools, the model loop or fallback routing can answer.
Assistant history does not trigger the check.
`skipModel` and deterministic menu, price and hours paths use `regexFenceIntent` without a model provider.
Other paths use `resolvePubPalFenceIntent`, which uses TypeSafe when available and retains the regex fallback.
A matched turn runs only deterministically selected `journey` and `city_status` tools.
It composes the shared response through `pubPalGetHomeRegisterAnswer` and returns before the model loop.
Regression coverage: `__tests__/askSobrietyParity.test.ts`.

## Consequences

- New answer shape: `{ answer, cards, proposals, sources, status }`.
- CityMCP failures degrade that card (`status: degraded`) rather than invent.
- A later ChatGPT App / MCP export can reuse the same tool handlers; shipping
  an external listing is out of this decision.
- Tests pin allowlist, keyless routing, proposal-not-mutate, and voice fences.
- `report_occupancy` is confirm-gated (ADR 0006). The tool proposes a crowd
  report; the client POSTs `/api/venues/[id]/occupancy` on confirm. The store
  is master plan R-011 (`lib/occupancy.ts`, `lib/occupancyStore.ts`).
  `occupancyStoreState()` stays the one switch that can roll the confirm back
  to `"unbuilt"`. Inventing a second schema, or borrowing the visit-report or
  community-price lane, would make one lane mean two things.
- `find_desk` answers only from the widened `cafe` / `coworking` / `library`
  rows, which the London pack does not carry yet, so it says "no seat data
  yet" rather than offering a pub as a desk. Pub behaviour is untouched:
  `lib/ask/deskVenues.server.ts` never reads a pub row.
