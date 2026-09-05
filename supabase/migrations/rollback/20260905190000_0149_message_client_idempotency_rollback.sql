-- Rollback for 0149 (message send idempotency key).
--
-- Dropping the column DISCARDS the keys stored so far, so a send already in
-- flight when this runs can land twice. `lib/messagesStore.ts` answers a
-- missing column with an unkeyed retry, so messaging keeps working either way.

begin;

drop index if exists public.messages_conversation_client_message_id_idx;

alter table public.messages
  drop column if exists client_message_id;

commit;
