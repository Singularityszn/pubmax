-- One send is one message, however many times the request arrives (F-25).
--
-- Apply AFTER 0148. Captain applies; agents ship SQL only.
--
-- WHAT WAS WRONG. `POST /api/messages/[id]` had no idempotency key at all. A
-- connection reset AFTER the row committed answered the browser as a failure:
-- the optimistic bubble was taken back, the text went into the field, and the
-- drinker sent it again. The conversation then held the same line twice, and
-- nothing in the schema could tell the two apart. The browser now mints a uuid
-- for each attempt BEFORE the request leaves it and sends the same one on every
-- retry of that attempt; this index is what makes the second arrival a conflict
-- the store answers with the row it already wrote.
--
-- WHY PARTIAL AND ADDITIVE. Every row before this migration, and every row a
-- caller that sends no key writes, carries NULL. A plain unique index would
-- treat those as distinct anyway, but a PARTIAL one says out loud that the rule
-- governs keyed sends only, and it keeps the index off the rows it can never
-- match. `lib/messagesStore.ts` also retries the insert without the column on a
-- 42703, so a code deploy that lands before this migration keeps delivering
-- messages (un-idempotently) rather than refusing them: the same additive
-- rollout rule the `vibe_tags`, `visibility` and `measure` columns follow.
--
-- Reverse: supabase/migrations/rollback/20260905190000_0149_message_client_idempotency_rollback.sql

begin;

alter table public.messages
  add column if not exists client_message_id uuid;

comment on column public.messages.client_message_id is
  'The sender browser''s own id for one send attempt. NULL for every unkeyed '
  'or pre-0149 row. Unique per conversation where present, so a retried send '
  'is answered with the row it already wrote rather than a second copy.';

create unique index if not exists messages_conversation_client_message_id_idx
  on public.messages (conversation_id, client_message_id)
  where client_message_id is not null;

commit;
