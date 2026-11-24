-- Rollback cost: in-flight writes can again recreate retired messaging handles. No data changes.
begin;
drop trigger conversations_refuse_retired_handle on public.conversations;
drop trigger conversation_members_refuse_retired_handle on public.conversation_members;
drop trigger conversation_deletions_refuse_retired_handle on public.conversation_deletions;
drop trigger message_poll_votes_refuse_retired_handle on public.message_poll_votes;
drop trigger messages_refuse_retired_handle on public.messages;
drop trigger notifications_refuse_retired_handle on public.notifications;
drop function public._refuse_retired_messaging_handle();
commit;
