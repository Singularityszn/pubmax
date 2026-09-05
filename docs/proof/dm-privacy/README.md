# DM privacy and send integrity: the evidence

Adversarial review of the 5 September 2026 merge day, findings F-1 (P0), F-9,
F-10, F-11, F-24, F-25 and F-26. Report: `data/review-merged-code/report.md`
in the reviewer's workspace; fix tasks 32, 17, 16, 13, 14 and 23.

## F-1: every DM ping was broadcast on a public channel

`#1501` gave the messaging surfaces a realtime lane. It sent a payload-free
Broadcast on `live:messages:<conversation id>` and on
`live:inbox:<handle>` for each participant, and both halves used PUBLIC
channels.

A Supabase public channel authorises on the API key alone, and the anon key is
in every browser. Handles are public and enumerable through
`GET /api/profiles/directory`. So one websocket on `live:inbox:<victim>` was a
live activity oracle on a named person: pinged the instant that account sent or
received a message. Both participants' inbox topics ride ONE batched send, so
two handles that ping together are in the same conversation, and subscribing to
many handles reconstructed the private messaging graph without reading a single
message body. The payload was never the leak. The metadata was.

`public.messages` is RLS deny-all and outside the `supabase_realtime`
publication (migration 0019) precisely so this could not happen. The broadcast
lane routed around that table, and therefore around its posture, by hand.

### What now decides

Both halves speak `private: true`, so Realtime runs its own authorization check
per join, as the SUBSCRIBER's role, against `realtime.messages`. Migration
`0148` is the policy that check reads:

| Topic | Admitted to |
| --- | --- |
| `live:inbox:<handle>` | the account that owns that handle, aliases included |
| `live:messages:<uuid>` | a participant of that conversation |
| anything else | nobody (the policy has no opinion; it can only admit) |

The predicate is `pubmax_private.rls_may_read_messaging_topic(text)`, beside the
helpers it delegates to (`rls_owns_handle`, `rls_is_conversation_participant`),
because 0070 moved every RLS helper there and a copy in `public` is a copy no
policy reads - the hole 0144 was. It takes the topic as a PARAMETER rather than
calling `realtime.topic()` itself, so it is creatable and provable on a cluster
with no realtime schema. The server broadcasts with the secret key, which
bypasses RLS, so the sender is unaffected.

`scripts/rls/session-fixture.sql` now carries the `realtime.messages` and
`realtime.topic()` shim the platform provides, in the same spirit as its
existing `auth.users` and `storage.objects` stand-ins. That is what lets every
all-migration suite apply 0148 unchanged.

### Proved at the table

`__tests__/messagingRealtimeAuthorizationMigrationEffective.test.ts` starts a
real PostgreSQL 16, applies the fixture plus every migration before 0148,
applies 0148, and then runs the SAME predicate Realtime runs - as role
`authenticated`, with `request.jwt.claims` set and `realtime.topic` set - over
real profile and conversation rows.

| Case | Rows the role can read |
| --- | --- |
| Before 0148: any policy on `realtime.messages` | none exists |
| Mallory joins `live:inbox:ken` | 0 |
| Ken joins `live:inbox:ken` | 1 |
| Ken joins `live:inbox:ken_old` (his own former handle) | 1 |
| Mallory joins `live:inbox:ken_old` | 0 |
| `anon` joins any of them | 0 |
| An authenticated JWT with no account behind it | 0 |
| Ken or Sam joins their thread topic | 1 |
| Mallory joins their thread topic | 0 |
| Ken joins a conversation he is not in | 0 |
| `live:messages:not-a-uuid`, `live:inbox:`, `some:other:channel`, `` | 0, and no error |
| After the rollback | 0 for everybody - the safe failure |

A browser test could only have proved the client flag. Who is actually let in is
the policy, the helper and the caller's role, so that is where it is measured.

## F-26: the broadcast sat on the send's critical path

`MESSAGES_BROADCAST_TIMEOUT_MS` is 1,500 ms, and the send awaited the broadcast
before its 201. On the thread route it first awaited `store.participants(id)`
as well - a second read for the pair the write had just proved.

Measured at the route handler, memory store, with the broadcast answering at its
own timeout (five sends, median; `POST /api/messages/[id]`, tap of the driver to
the 201):

| | Before | After |
| --- | --- | --- |
| Thread send, 201 returned | 1,501.6 ms | 0.5 ms |
| Worst of five | 1,502.0 ms | 1.0 ms |
| Inbox send, 201 returned | (same shape) | 0.9 ms |
| `store.participants` reads per send | 1 | 0 |

The before arm reconstructs the two awaits this change removed
(`store.participants` then `broadcastMessageSent`) around the same stored row,
in the same process, so both arms pay the same store cost.

`deferMessagesSignal` claims the promise and then hands it to `after`; outside a
request scope (a plain Node server, a direct call in a test) `after` throws and
the already-started promise is the whole of it, so the work runs either way and
can never surface as an unhandled rejection. `send` now returns
`{ message, pair }`, so the thread route names the two inbox topics from the
participant check the write already ran.

## F-25 and F-11: one tap is one message, and a refusal keeps it

`canSend` gated on React state, which is committed a microtask after the event,
so two taps in one task both read `sending === false` and both posted. There was
no `clientMessageId`, so a connection reset after the row committed left the
message stored, the bubble removed and the text back in the field: the drinker
sent it again and there were two.

The composer latches on a ref claimed before the first await, and mints one uuid
per attempt. Migration `0149` adds `messages.client_message_id` plus a partial
unique index on `(conversation_id, client_message_id)`, and the store answers
the resulting 23505 with the row it already wrote.
`__tests__/messageIdempotencyMigrationEffective.test.ts` proves that at the
table on a real PostgreSQL 16: before the migration two identical sends are two
rows; after it the replay is refused by name, two deliberate sends with distinct
keys are still two rows, the key is scoped to one conversation, unkeyed rows are
never merged, and the rollback keeps every message.

A refused send now puts the failed line back at the TOP of whatever the reader
has since typed, and never overwrites a newly picked attachment. The field is
still cleared at the tap, so nothing about the fast path changed:

| | Before | After |
| --- | --- | --- |
| Tap to outbox bubble in the DOM (jsdom, median of 5) | 5.7 ms | 5.2 ms |
| Range across the five | 5.2 – 7.4 ms | 4.9 – 6.1 ms |

Both arms ran in one process against the same harness, the before arm rendering
the pre-change component from `HEAD~1`. The bubble is drawn synchronously before
any await, so the added ref read and `crypto.randomUUID()` are inside the noise.
This is a jsdom render measurement and is NOT comparable to the browser figure
in `docs/proof/messaging-speed/`; what it establishes is that the two arms are
the same speed.

## F-24: one socket error ended the lane

`CHANNEL_ERROR`, `TIMED_OUT` and `CLOSED` all called `fallBackToPolling`, which
dropped the channel and never re-attached - so a single transient error, which
is the ordinary case on a phone waking from sleep, downgraded a thread to
polling for the life of the mount. A dropped channel is now re-asked under a
bounded backoff (1s, 2s, 4s, 8s, capped at four attempts and 30s a step), the
poll carries the reader meanwhile, and a join that LANDED clears the budget so a
long session keeps recovering.

## F-9 and F-10: the inbox read told the truth about nothing

Batching the inbox (#1501) moved the blast radius. Both batched reads threw all
the way out of `listConversations`, which answered `[]`, which the route served
as a plain 200 and the page drew as the empty state: one statement timeout on
the unread scan turned every conversation a person had into an empty inbox. The
scan's 1,000-row cap had no `ORDER BY`, so under 0143's partial index the
lowest-sorting conversation ids ate the budget and every conversation after them
reported a confident `unread: 0`.

Now: only the conversation-rows read may empty the inbox; each batched read is
caught where it happens; the scan is ordered so its cap is a window rather than
a filter, and every count it could have cut short is re-asked with its own
bounded count; `ConversationDTO.unread` is ABSENT rather than 0 when nothing
counted it; and the body carries `status: "degraded"`, which the page words
apart from a read that did not answer at all.

`__tests__/messagesInboxRead.test.ts` holds each of those on a fake PostgREST
client. `e2e/messages-inbox-degraded.spec.ts` measures what a reader sees, on a
production build, at 390x844, 768x1024 and 1440x900.

### Shots

| File | What it shows |
| --- | --- |
| `inbox-degraded-before-<size>.png` | the rows with no `status` field, which is what main sent: no notice at all, and an unread badge over a count nobody ran |
| `inbox-degraded-after-<size>.png` | the same rows with `status: "degraded"`: the list, one line saying the check did not run, a way to try again, and no badge |
| `inbox-degraded-empty-<size>.png` | a degraded read with no rows: "Couldn't load your conversations", never "Nobody in here yet" |

## Method

- Migration proofs: ephemeral PostgreSQL 16 per file, `initdb` to `psql`,
  `scripts/rls/session-fixture.sql` plus every prior migration, run under
  `npx vitest run`. Each also runs the forward file twice, to prove the apply
  list is re-runnable, and then the rollback.
- Latency: `POST` handlers called directly, memory store, broadcast mocked to
  answer at `MESSAGES_BROADCAST_TIMEOUT_MS`. Five sends per arm, medians.
- Tap to bubble: jsdom, React 19 `act`, the shipped `MessageThread` against the
  `HEAD~1` copy of it, five taps per arm after a warm-up pass of each.
- Shots: `npx playwright test --project=chromium messages-inbox-degraded`
  against a production build, auth doubles signing the page in, the inbox API
  answered in the browser because a keyless server cannot verify a bearer.
