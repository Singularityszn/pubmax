-- Removes all price alert preferences and delivery claims.
begin;
drop function if exists public.price_alert_bind(uuid, text, integer, text);
drop function if exists public.price_alert_claim(uuid, uuid, text, text, integer);
drop table if exists public.price_alert_claims;
drop table if exists public.price_alert_preferences;
commit;
