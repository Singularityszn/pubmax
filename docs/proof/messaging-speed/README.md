# Messaging speed: before and after

Captain, 2026-09-05, on his phone: "The messaging is slow." This folder holds
the numbers behind the fix, measured the same way before and after, and the
screenshots the design rule asks for.

## What the messaging surface is

One surface carries conversations: direct messages at `/messages` and
`/messages/[id]`. The plan crew has proposals, votes and presence but no chat
endpoint; Social crews carry no messages; Pub Pal is one question and one
answer over `/api/ask`, not a thread. So every measurement here is the DM lane.

Data path before this change, for one open thread:

| Step | Round trips | Notes |
| --- | --- | --- |
| Open a thread (phone) | 4 API requests | notifications, the inbox TWICE (hidden pane, fetched anyway), the thread |
| Each thread GET, server side | 6 serial dependent calls | `auth.getUser` over the network, profile by user id, profile by handle, conversation pair, message rows, then an UPDATE of `read_at` on every poll |
| Send | POST, then a full GET | composer disabled through both; own bubble appears after the GET |
| Other side | poll every 10 s | `postgres_changes` on `messages` joins and hears nothing: the table is RLS deny-all and not in the realtime publication (migration 0019) |
| Inbox GET, server side | 1 + N queries | one query per conversation, each pulling up to 200 rows, for the last message and the unread count |
| Idle, thread open | 10 s thread poll + 20 s inbox poll | whether or not the tab was visible |

## Method

- Local production build (`next build`, webpack, same bundler both runs) of
  `origin/main` at `a30e58465` (before) and this branch (after), both served
  by `next start` against ONE local Supabase stack (`npx supabase start`, all
  158 migrations applied, Postgres 16, GoTrue issuing ES256 tokens, Realtime
  on). Nothing touched production.
- Two seeded QA accounts in two Playwright browser contexts: A at 390x844
  (mobile emulation), B at 1440x900. Both sign in through the handle and
  password form. The measuring browser runs with `bypassCSP`, because the
  production CSP admits only `*.supabase.co` into `connect-src` and the local
  stack is `127.0.0.1`.
- Five samples per figure; medians reported. Time is wall clock in the
  driver. "Other side" is from A's tap on Send to the text painted in B's
  thread. "Read" is from A's tap to A's own bubble reading Read.
- Script: `.e2e/measure-messaging.mts` (gitignored; the JSON it wrote is beside
  this file as `before-measurements.json` and `after-measurements.json`).

## Before

| Figure | Before |
| --- | --- |
| Tap to thread visible (median) | 491 ms |
| API requests on that open | 4 |
| Send to own bubble (median) | 1279 ms |
| Send to other side (median / worst of 5) | 3953 ms / 4281 ms |
| Read receipt | none exists |
| API requests on a send, sender | 2 (POST, then GET) |
| API requests in 30 s idle, thread open, per side | 6 |
| Inbox load | inbox GET fired twice |

## After

| Figure | Before | After |
| --- | --- | --- |
| Tap to thread visible (median of 5) | 491 ms | 204 ms |
| API requests on that open | 4 | 3 (thread, notifications, one inbox read) |
| Send to own bubble (median) | 1279 ms | 3 ms |
| Send to other side (median / worst of 5) | 3953 ms / 4281 ms | 1069 ms / 1437 ms |
| Read receipt on the sender's bubble (median) | none | 1116 ms |
| API requests on a send, sender | 2 (POST, then GET) | 1 POST, then 2 signal-driven GETs (own message signal, then the read signal) |
| API requests in 30 s idle, thread open, per side | 6 (3 thread polls, 2 inbox polls, 1 other) | 3 (1 thread safety poll at 30 s, 2 from other lanes) |
| Inbox page load | inbox GET fired twice | inbox GET fired twice (see below) |

The "other side" figure is broadcast plus one gated refetch plus the driver's
20 ms polling on both pages; on the earlier run of the same build it was
794 ms median. The remaining inbox read on a phone's thread open, and the second
inbox read on the inbox page, both come from the auth lane settling
`authHandle` a tick after mount, which re-keys the inbox's read; the request
is 186 bytes and is noted as a follow-up rather than chased here.

The frames were shot on this branch before it was rebased onto the merged
messaging-ui PR (#1498), which pins the composer and draws the outbox bubble;
the request counts and timings above are the data path this PR owns and are
unchanged by that rebase, since a send was still a POST followed by a full
GET on main at the time of writing.

## Server side

`Server-Timing` now rides the thread GET (`auth`, `gate`, `read`) so a slow
open can be read off the network panel. The bearer is verified locally
through `getClaims` (JWKS, ES256) instead of a `getUser` round trip to GoTrue
on every request, and the verified user id is handed to the ownership gate so
the token is checked once per request rather than twice. The thread read asks
for the pair and the rows together; nothing is written unless something unread
was received. The inbox is two batched reads plus a rare per-conversation
fallback instead of one query per conversation.

EXPLAIN on the local Postgres 16 (49,010 message rows; the viewer holding 60
conversations of 150 rows, 15 unread each), with the literal `IN (...)` list
PostgREST sends:

| Query | Plan | Time |
| --- | --- | --- |
| Inbox conversations by participant | Seq Scan at 461 rows (planner's choice; both handle indexes exist) | 1.08 ms |
| Inbox unread rows across the viewer's conversations | Bitmap Index Scan `messages_conversation_created_idx`, 9,000 index rows, filter removes 8,100 | 1.02 ms |
| Same, with the 0143 partial index `(conversation_id) where read_at is null` | Bitmap Index Scan on the partial index, 1,800 index rows | 0.43 ms |
| Inbox recent window (`order by created_at desc limit 240`) | Bitmap Index Scan, top-N heapsort | 2.28 ms |
| Thread rows for one conversation | Bitmap Index Scan, 150 rows | 2.61 ms (0.22 ms warm) |
| markRead update, one conversation | Bitmap Index Scan, 15 rows updated | 0.72 ms |

No read is a sequential scan of `messages`. Migration `0143` (file only, not
applied) adds the partial unread index; the code answers the same rows with
or without it.

## Correction to the merged commit body (recorded 5 Sep 2026)

`86650ade7` ("perf(messages): a send is one request...", #1501) names two
things that were never in the tree, and this note is where the record is put
straight, because the commit body itself cannot be rewritten after merge.

- **`lib/messageDelivery.ts` does not exist**, and neither does any
  `__tests__/messageDelivery*`. The commit's own `--stat` lists neither. The
  optimistic bubble it describes DID ship, inside
  `components/messages/MessageThread.tsx`: `outboxMessage` mints the row, the
  POST's own answer replaces it, and `takeBack` removes it on a refusal.
- **"fails it with a retry tap" did not ship at all.** A refused send takes the
  bubble back and restores the text only when the field is still empty, so
  words typed while the request was in flight keep the drinker's earlier
  message off the screen with no way back to it. That is an OPEN defect, not a
  merged behaviour, and it is the one the phrase describes.
- **The migration is `0143`, not `0142`.** The file that shipped is
  `supabase/migrations/20260905120000_0143_messages_unread_partial_index.sql`,
  renumbered by #1509 because two files claimed the 0142 label in the same
  hour. Everything else on this page already says 0143.

Nothing in the measurement above depends on either claim: the figures were
taken against the code that shipped.

## Screenshots

`before-thread-*.png` and `after-thread-*.png` at 390x844, 768x1024 and
1440x900: full-page frames of the sender's thread after the measured sends.

## Not measured here

- The production Supabase project (its keys are Vercel-only). The preview
  deploy named in the PR exercises the same code against it; the sign-in and
  send lanes there are the same requests.
- A hidden tab. Playwright cannot background a page; the hidden-tab rule
  (no poll while hidden, one refetch when shown) is held by
  `__tests__/messagesRealtime.test.ts`.
- `/api/identity/handle/current` is asked four times on a page load by the
  auth lane. That is outside this PR and is noted as a follow-up.
