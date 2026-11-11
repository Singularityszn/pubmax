-- 0237: a stored message stamps its conversation's last_message_at.
-- 1. An AFTER INSERT trigger on public.messages moves conversations.last_message_at
--    forward to the message's created_at, in the same transaction as the insert.
--    It never moves the stamp back.
-- 2. Every conversation whose newest message is later than its stamp is brought
--    forward once.
-- send keeps its best-effort update, so a deploy can run ahead of this apply.
begin;

create or replace function public._stamp_conversation_last_message_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations
  set last_message_at = new.created_at
  where id = new.conversation_id
    and last_message_at < new.created_at;
  return null;
end;
$$;

revoke all on function public._stamp_conversation_last_message_at() from public, anon, authenticated;

drop trigger if exists messages_stamp_conversation on public.messages;
create trigger messages_stamp_conversation
after insert on public.messages
for each row
execute function public._stamp_conversation_last_message_at();

update public.conversations conversation
set last_message_at = newest.created_at
from (
  select conversation_id, max(created_at) as created_at
  from public.messages
  group by conversation_id
) newest
where newest.conversation_id = conversation.id
  and conversation.last_message_at < newest.created_at;

commit;
