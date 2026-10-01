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
2. **Grounded answers** — every card and figure carries provenance; tools never
   invent pint prices. Uncorroborated community rows may appear on the pub’s
   own sheet language only; map-authority claims require corroboration.
3. **Propose, never apply** - Ask mutates nothing. `propose_map_action` returns
   a proposal the client applies only after an explicit Confirm. `propose_plan`
   returns a draft the client carries to `/plan` behind one "Open in Plan" link
   (`planPalRouteHandoffHref` in `lib/planOccasion.ts`), which prefills the same
   ask there and saves nothing until the drinker acts on it; a Confirm button
   beside that link would be two labels for one action. No silent Plan or
   durable Pal memory writes from Ask.
4. **Keyless path (map Ask)** — without `OPENROUTER_API_KEY`, a deterministic
   router picks 1–2 tools on `POST /api/ask` and fills house-voice templates
   (same honesty as heritage structured-only).
5. **Bounded model loop (map Ask)** — with OpenRouter, tool-calling on
   `POST /api/ask` is allowlisted, low temperature, capped rounds and tokens.
   The model selects tools only; `composeAnswer` builds reader copy from
   returned hints and cards.
6. **Pal typed chat and voice (ElevenLabs when configured)** — without
   `ELEVENLABS_API_KEY` and `ELEVENLABS_PUB_PAL_AGENT_ID`, typed chat on
   `POST /api/pub-pal/chat` uses the same keyless `runAsk` tool path as map Ask
   (`skipModel: true`). With both values set, typed chat and voice share one
   ElevenLabs agent (hosted LLM on the ElevenLabs plan): typed chat over HTTP,
   voice over WebRTC. Server
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
