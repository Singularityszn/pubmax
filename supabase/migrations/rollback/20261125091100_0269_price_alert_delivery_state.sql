-- Pending and uncertain delivery outcomes are lost. Existing claims remain spent.
drop function public.price_alert_settle_delivery(uuid,text,uuid,text);
drop function public.price_alert_delivery_backlog();
drop function public.price_alert_claim_delivery(uuid,text,text,text,integer,timestamptz,uuid);
create or replace function public.price_alert_due(p_after_user uuid, p_limit integer)
returns table (user_id uuid, area text, threshold_pence integer, token text, enabled_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.user_id, p.area, p.threshold_pence, p.token, p.enabled_at from public.price_alert_preferences p
  where (p_after_user is null or p.user_id > p_after_user)
    and not exists (select 1 from public.price_alert_claims c where c.user_id = p.user_id and c.area = p.area and c.alert_day = (now() at time zone 'Europe/London')::date)
  order by p.user_id limit least(greatest(coalesce(p_limit, 0), 0), 500);
$$;
alter table public.price_alert_claims drop column delivery_state, drop column delivery_attempt, drop column queued_at, drop column updated_at;
