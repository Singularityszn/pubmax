-- Roll back application first. Existing prepaid usage remains charged; do not
-- reset it, which would reopen spent allowances. Grant/refund history is lost.
begin;
drop function if exists public.refund_pub_pal_voice_grant(uuid,uuid);
drop function if exists public.prepay_pub_pal_voice_grant(uuid,date,uuid);
drop table if exists public.pub_pal_voice_grants;
commit;
