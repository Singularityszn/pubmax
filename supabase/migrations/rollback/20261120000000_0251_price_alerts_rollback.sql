-- Removes all price alert preferences and delivery claims.
begin;
drop function if exists public.price_alert_observe_listings(text[]);
drop table if exists public.price_alert_listing_seen;
drop function if exists public.price_alert_bind(uuid, text, integer, text);
drop function if exists public.price_alert_claim(uuid, text, text, text, integer, timestamptz);
drop function if exists public.price_alert_due(uuid, integer);
drop table if exists public.price_alert_claims;
drop table if exists public.price_alert_preferences;
commit;
