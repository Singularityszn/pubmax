-- Roll back application first. Existing prepaid usage remains charged; do not
-- reset it, which would reopen spent allowances. Grant/refund history is lost.
begin;
drop function if exists public.reconcile_pub_pal_voice_conversation(text,bigint,text,integer);
drop function if exists public.link_pub_pal_voice_conversation(uuid,text);
drop function if exists public.refund_pub_pal_voice_grant(uuid,uuid);
drop function if exists public.prepay_pub_pal_voice_grant(uuid,date,uuid);
drop table if exists public.pub_pal_voice_provider_events;
drop table if exists public.pub_pal_voice_grants;
-- Restore exactly the pre-0157 service-role boundary. Browser roles remain
-- denied as they were after 0070/0088.
grant execute on function public.consume_pub_pal_voice_trial(uuid,date,integer) to service_role;
grant execute on function public.release_pub_pal_voice_trial(uuid,date) to service_role;
grant execute on function public.record_pub_pal_voice_minutes(uuid,date,integer) to service_role;
commit;
