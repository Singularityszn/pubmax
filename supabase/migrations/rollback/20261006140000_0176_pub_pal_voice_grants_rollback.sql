-- Rollback 0176. NOT NEUTRAL: it reopens the client-trusted voice meter.
-- Restoring the 0027/0070/0088 functions to service_role lets the old route
-- bill whatever duration the browser reports, so a caller can send zero seconds
-- and never fill the monthly allowance. Roll the application back first.
-- It also drops pub_pal_voice_grants, the record of each session's prepayment,
-- its provider conversation id and its settled duration. pub_pal_voice_usage
-- keeps its used_minutes, which already include every unsettled prepayment.

begin;

grant execute on function public.consume_pub_pal_voice_trial(uuid, date, integer) to service_role;
grant execute on function public.release_pub_pal_voice_trial(uuid, date) to service_role;
grant execute on function public.record_pub_pal_voice_minutes(uuid, date, integer) to service_role;

drop function if exists public.settle_pub_pal_voice_conversation(uuid, text, integer);
drop function if exists public.issued_pub_pal_voice_conversations(uuid, date);
drop function if exists public.link_pub_pal_voice_conversation(uuid, uuid, text);
drop function if exists public.refund_pub_pal_voice_grant(uuid, uuid);
drop function if exists public.prepay_pub_pal_voice_grant(uuid, date, uuid, integer, integer);
drop table if exists public.pub_pal_voice_grants;

commit;
