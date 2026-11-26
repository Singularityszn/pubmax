-- Removes the ordered binding RPCs and their order column.
-- Preserves message alert consent, subscriptions, mutes, claims and presence.
-- Roll the application back first: the previous release and bind calls do not need the column.
begin;

drop function public.message_notification_release(text, text, bigint, uuid);
drop function public.message_notification_bind_ordered(uuid, uuid, text, text, bigint);

alter table public.message_push_subscriptions drop column bind_sequence;

commit;
