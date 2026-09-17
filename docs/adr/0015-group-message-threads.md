# ADR 0015: Group message threads and the wider attachment set

## Status

Accepted

## Context

Messaging shipped as a strict 1:1 lane. The store interface said so in its own
type — `participants(conversationId): Promise<HandlePair | null>` — and the
`conversations` table said so in SQL: two `not null` handle columns, a unique
`(handle_a, handle_b)`, and a `handle_a < handle_b` order check. Everything
above it inherited the pair: the send result carried one, the realtime
broadcast named two inbox topics off it, and `pubmax_private.rls_is_conversation_participant`
asked whether the caller owned one of the two columns.

The messaging wave named five attachment kinds and the tree held two. `photo`
and `venue` ship; `contact`, `event` and `poll` were written down and never
built. The audit's ordering was explicit and correct: **decide group threads
first**, because a third, fourth and fifth attachment kind built against a pair
would each need rewriting the moment a thread could hold more than two people.

## Decision

### 1. A conversation has a KIND, and the kind names its membership authority

`public.conversations` gains `kind text not null default 'direct'`, a closed set
of `direct | group`.

- **A DIRECT conversation's membership is its own two columns.** `handle_a` and
  `handle_b` stay the row's identity: the unique pair is still what makes
  find-or-create idempotent, the order check still holds, and nothing about an
  existing row moves. No backfill, and therefore no drift between two places
  claiming to know who is in a 1:1.
- **A GROUP conversation's membership is `public.conversation_members`.** One
  row per handle, carrying `role` (`owner | member`) and a nullable `left_at`.
  The pair columns are NULL on a group row, which is why they become nullable
  and why a per-kind CHECK now says which shape each kind must have.

Two authorities rather than one is the deliberate choice. The alternative —
backfilling every direct conversation into the members table and reading
membership from one place — creates a second copy of a fact the pair columns
already state, and a second copy is what drifted in `0124`/`0144`. One reader
(`readMembership` in `lib/messagesStore.ts`) branches on the kind, so no caller
above the store sees the split.

### 2. The store speaks MEMBERSHIP, never a pair

`ConversationMembership` (`lib/messages.ts`) is `{ kind, handles, title }` and
it replaces `HandlePair` everywhere a caller asked "who is in this". `HandlePair`
survives as what it always was — the ordered identity of a direct row — and
`normalizePair` is still the only thing that mints one.

A send returns the membership it already proved, so the broadcast names every
participant's inbox topic from the write rather than a second read.

### 3. A group is opened whole, and anybody may leave it

`POST /api/messages { action: "open-group", handle, participants, title? }`
mints a group with its members named up front. Every named handle must resolve
to a live profile before a row is written, which is the rule the 1:1 door
already keeps.

`POST /api/messages/[id] { action: "leave" }` is the way out. A group nobody can
leave is a trap, and a thread whose membership can only grow is worse than one
that never existed.

**Adding a member after the fact is NOT in this wave.** It is a different
question — who may add, whether the newcomer reads the history, what the thread
says about it — and answering it badly is how a private conversation becomes
somebody else's. The column (`role`) and the table are shaped for it.

**A thread formed around a Plan Crew is NOT in this wave either.** A Crew thread
is a group whose membership is derived from a capability-gated read
(`resolvePlanProjection`), so it owes its own rules about what a revoked seat
does to a thread that already holds words. Generic group threads are the
foundation it needs; `conversations` carries no `plan_id` column until that
lane is built, because a column nothing writes is dark schema.

### 4. WhatsApp export stays out

`continue-on-WhatsApp` is a share lane, not a messaging lane, and `wa.me` already
exists in `lib/shareSheet.ts` for what it is good for. Exporting a private thread
to a third party is a data-egress decision with a privacy notice attached to it,
and it is not bundled into a wave about threads and attachments.

### 5. Three attachment kinds, each with its own provenance rule

The closed set becomes `photo | venue | contact | event | poll`. A message still
carries AT MOST ONE. Each new kind states what it stores and what it may say:

| Kind | Stored | Resolved on read | Privacy rule |
| --- | --- | --- | --- |
| `contact` | one handle | public profile card | Only the PUBLIC profile crosses: handle, display name, approved avatar. An unknown or tombstoned handle resolves to `null`, never a guessed name. |
| `event` | one plan id | the plan's ANONYMOUS preview | A message is not a capability. The card prints only what `buildPlanPrivacyPreview` prints — host name, area, start, stop count — and never a venue, a stop or the crew. The reader's own capability decides at `/plan/<id>`. |
| `poll` | question + options | counts + the viewer's own answer | Counts are DERIVED on read and never stored. No voter is named to anybody, including the poll's author. A vote may only be cast by a participant, and changing it replaces it. |

The two existing rules are unchanged and the new kinds are held to them:

- **Nothing carries a coordinate.** `venue` stores an id; so do `contact` and
  `event`. No new column holds a point.
- **A frozen figure is an undated claim.** Every card is resolved on the READ
  path, so a renamed pub, a renamed person and a moved plan all read correctly
  in a message from last month.

## Consequences

- Migration `0154` (group threads) and `0155` (attachment kinds) each ship with a
  rollback. The captain applies both; the store carries an additive-rollout guard
  so a deploy that lands first keeps working on the pre-migration shape.
- `pubmax_private.rls_is_conversation_participant` gains a group branch, so
  `0148`'s realtime channel policy admits a group thread's members with no
  change to the policy itself.
- The tombstone trigger clears every attachment column rather than the two it
  knew about, or a departing account would leave a row whose `kind` is null and
  whose contact handle is not, which the shape CHECK refuses.
- `lib/messageGroupThread.ts` and `lib/messagePoll.ts` are pure leaves, so a
  browser bundle that needs a group's name or a poll's cap pulls no store behind
  it.
