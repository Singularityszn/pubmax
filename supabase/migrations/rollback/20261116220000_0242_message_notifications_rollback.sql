-- Removes message alert consent, subscriptions, mutes and delivery claims.
-- Disables private message push. Reapplying requires fresh consent.
begin;
drop function if exists public.message_notification_session_active(uuid, uuid);
drop table public.message_notification_claims;
drop table public.message_notification_mutes;
drop table public.message_push_subscriptions;
drop table public.message_notification_preferences;
commit;
