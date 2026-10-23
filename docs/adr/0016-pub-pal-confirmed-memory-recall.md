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
   webhook. Signed-in text and voice openings can also reference confirmed context
   when the taste read permits it. All paths read through `lib/palConfirmedMemories.server.ts`.
4. **Writes stay confirm-gated.** The Pal-only `propose_memory` webhook adds
   a visible card to typed and voice chat. The webhook saves nothing.
   Only the person's confirmation can create, update or delete a memory through
   `/api/pub-pal/memories`. Speech alone cannot confirm a card.
   The bound owner's Pal must allow memory proposals.
   [Pub Pal setup](../PUB_PAL_SETUP.md) owns the webhook and client-event requirements.
5. **Recall carries everything, ranked by the ask** (amended 17 October
   2026). A turn carries every confirmed memory up to forty
   (`PAL_RECALL_MEMORY_LIMIT`), which covers nearly everyone, at most about
   8 KB of context. They are ranked so the right ones come first and are the
   ones kept past forty: access needs and corrections always, then the ones
   the person's own words are about, then the newest. The ranking is
   `lib/palMemoryRelevance.ts`, pure and in process, so it costs a turn no
   time. Before this, recall sent the newest eight, and the memory eval
   (`evals/pal/memory`) showed the oldest never reached the model however much
   the ask was about them.
6. **Map Ask is unchanged.** `POST /api/ask` keeps in-thread memory only, as
   ADR 0014 decision 7 states.

## Consequences

- The Pal remembers what the person confirmed, and nothing the person did not.
- Preferences guide choices. A confirmed `night_outcome` records the person's
  own report, including any stated pub, date, drinks and expenditure.
- Recall preserves explicitly reported spending. Pint-price observations cannot
  establish consumption or a bill total.
- Memories cannot establish a current pub price, opening hour or pub lore.
- Setup and the webhook details live in `docs/PUB_PAL_SETUP.md`.
