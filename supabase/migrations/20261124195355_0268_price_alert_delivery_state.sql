alter table public.price_alert_claims
  add column delivery_state text not null default 'delivered' check (delivery_state in ('sending','retryable','delivered','terminal','unknown')),
  add column delivery_attempt uuid,
  add column queued_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now();

create function public.price_alert_claim_delivery(p_user_id uuid, p_event_id text, p_token text, p_area text, p_threshold_pence integer, p_recorded_at timestamptz, p_attempt uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare inserted integer; current_day date := (now() at time zone 'Europe/London')::date;
begin
  insert into public.price_alert_claims (user_id, event_id, area, alert_day, delivery_state, delivery_attempt)
    select p_user_id, p_event_id, p_area, current_day, 'sending', p_attempt from public.price_alert_preferences
    where user_id = p_user_id and token = p_token and area = p_area and threshold_pence = p_threshold_pence
      and p_recorded_at > enabled_at and p_recorded_at <= now()
  on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted = 1 then return true; end if;
  begin
    update public.price_alert_claims c set delivery_state = 'sending', delivery_attempt = p_attempt, alert_day = current_day, updated_at = now()
    where c.user_id = p_user_id and c.event_id = p_event_id and c.area = p_area and c.delivery_state = 'retryable'
      and exists (select 1 from public.price_alert_preferences p where p.user_id = p_user_id and p.token = p_token and p.area = p_area and p.threshold_pence = p_threshold_pence and p_recorded_at > p.enabled_at and p_recorded_at <= now());
  exception when unique_violation then return false;
  end;
  get diagnostics inserted = row_count;
  return inserted = 1;
end $$;

create function public.price_alert_settle_delivery(p_user_id uuid, p_event_id text, p_attempt uuid, p_state text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  if p_state not in ('retryable','delivered','terminal','unknown') then raise exception 'invalid delivery state'; end if;
  update public.price_alert_claims set delivery_state = p_state, delivery_attempt = null, updated_at = now()
    where user_id = p_user_id and event_id = p_event_id and delivery_state = 'sending' and delivery_attempt = p_attempt;
  get diagnostics changed = row_count;
  return changed = 1;
end $$;

create function public.price_alert_delivery_backlog()
returns table (retryable bigint, uncertain bigint, oldest_pending timestamptz, failed bigint)
language sql stable security invoker set search_path = '' as $$
  select count(*) filter (where delivery_state = 'retryable'),
    count(*) filter (where delivery_state in ('sending', 'unknown')),
    min(queued_at) filter (where delivery_state in ('retryable', 'sending', 'unknown')),
    count(*) filter (where delivery_state = 'terminal')
  from public.price_alert_claims;
$$;

create or replace function public.price_alert_due(p_after_user uuid, p_limit integer)
returns table (user_id uuid, area text, threshold_pence integer, token text, enabled_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.user_id, p.area, p.threshold_pence, p.token, p.enabled_at
  from public.price_alert_preferences p
  where (p_after_user is null or p.user_id > p_after_user)
    and (exists (select 1 from public.price_alert_claims c where c.user_id = p.user_id and c.area = p.area and c.delivery_state = 'retryable')
      or not exists (select 1 from public.price_alert_claims c where c.user_id = p.user_id and c.area = p.area and c.alert_day = (now() at time zone 'Europe/London')::date))
  order by p.user_id limit least(greatest(coalesce(p_limit, 0), 0), 500);
$$;
revoke all on function public.price_alert_claim_delivery(uuid,text,text,text,integer,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public.price_alert_settle_delivery(uuid,text,uuid,text) from public, anon, authenticated;
revoke all on function public.price_alert_delivery_backlog() from public, anon, authenticated;
grant execute on function public.price_alert_claim_delivery(uuid,text,text,text,integer,timestamptz,uuid) to service_role;
grant execute on function public.price_alert_settle_delivery(uuid,text,uuid,text) to service_role;
grant execute on function public.price_alert_delivery_backlog() to service_role;
