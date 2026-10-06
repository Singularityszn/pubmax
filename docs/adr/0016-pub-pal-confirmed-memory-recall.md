# ADR 0016: Pub Pal reads confirmed memories

## Status

Accepted. Supersedes ADR 0014 decision 7 for the Pub Pal path only.

## Context

ADR 0014 decision 7 kept every Ask surface to in-thread memory: the client may
resend recent turns, and durable Pal memory stays confirm-gated (ADR 0006).
That left the Pal unable to use what the person had already confirmed in
`pub_pal_memories`, so a person who said "I only drink cask" and tapped Confirm
had to say it again every night.

## Decision

1. **The Pub Pal path reads confirmed memories, read-only.** Typed chat and
   voice may read the person's durable `pub_pal_memories`. Only
   `user_confirmed` and `user_correction` rows are read. A `completed_plan` row
   was inferred, not confirmed, so it never reaches the agent.
2. **The owner comes from the server-side conversation binding.** The account
   is the one that opened the conversation, never a value in a request or
   webhook body, so one conversation can only read its own account's Pal.
3. **Two read paths.** Typed chat puts the confirmed lines ahead of the ask on
   the server (the typed preamble). Voice calls the Pal-only `recall_memories`
   webhook. Both read through `lib/palConfirmedMemories.server.ts`.
4. **Writes stay confirm-gated.** The Pal-only `propose_memory` webhook adds
   the existing confirm card to a typed chat. It saves nothing: the memory
   exists only once the person taps Confirm, which posts to
   `POST /api/pub-pal/memories`. It is typed chat only, because voice shows no
   card, so it refuses in a voice call and claims no card.
5. **Map Ask is unchanged.** `POST /api/ask` keeps in-thread memory only, as
   ADR 0014 decision 7 states.

## Consequences

- The Pal remembers what the person confirmed, and nothing the person did not.
- A memory is a preference, never a fact about a pub, so it cannot ground a
  price, an hour or pub lore.
- Setup and the webhook details live in `docs/PUB_PAL_SETUP.md`.
