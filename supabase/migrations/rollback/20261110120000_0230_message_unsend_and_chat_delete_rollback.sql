-- Rollback for 0230. Deploy the application without unsend and chat delete
-- first.
--
-- WHAT IT COSTS. Every chat delete is forgotten, so each deleted chat comes
-- back into its person's inbox with all its old messages. Every unsent message
-- that was not reported has no words left, so it cannot satisfy 0102's content
-- check again: those rows are DELETED. A reported unsent message still holds
-- its content, so it comes back on every reader's screen as it was sent.

begin;

drop table if exists public.conversation_deletions;

delete from public.messages
 where unsent_at is not null
   and char_length(body) = 0
   and attachment_kind is null;

alter table public.messages drop constraint if exists messages_unsent_empty_chk;
alter table public.messages drop constraint if exists messages_content_chk;
alter table public.messages
  add constraint messages_content_chk
  check (char_length(body) >= 1 or attachment_kind is not null);

alter table public.messages drop column if exists unsent_at;

commit;
