alter table public.price_alert_claims add column event_payload jsonb, add column recorded_at timestamptz;
alter table public.price_alert_snapshot_jobs add column retry_user uuid, add column retry_event text;

create function public.claim_price_alert_event(p_user_id uuid, p_event_id text, p_token text, p_area text, p_threshold_pence integer, p_recorded_at timestamptz, p_attempt uuid, p_event jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_event is null or p_event->>'id' is distinct from p_event_id or octet_length(p_event::text) > 4096 then raise exception 'invalid alert event'; end if;
  if not public.price_alert_claim_delivery(p_user_id, p_event_id, p_token, p_area, p_threshold_pence, p_recorded_at, p_attempt) then return false; end if;
  update public.price_alert_claims set event_payload = coalesce(event_payload, p_event), recorded_at = coalesce(recorded_at, p_recorded_at)
    where user_id = p_user_id and event_id = p_event_id and delivery_attempt = p_attempt and delivery_state = 'sending';
  return found;
end $$;

create function public.price_alert_retry_page(p_after_user uuid, p_after_event text, p_limit integer)
returns table (user_id uuid, area text, threshold_pence integer, token text, enabled_at timestamptz, event_payload jsonb, recorded_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select p.user_id, p.area, p.threshold_pence, p.token, p.enabled_at, c.event_payload, c.recorded_at
  from public.price_alert_claims c join public.price_alert_preferences p on p.user_id = c.user_id and p.area = c.area
  where c.delivery_state = 'retryable' and c.event_payload is not null and c.recorded_at > p.enabled_at and p.activation_state = 'active'
    and (p_after_user is null or (c.user_id, c.event_id) > (p_after_user, p_after_event))
  order by c.user_id, c.event_id limit least(greatest(p_limit, 0), 25);
$$;

create function public.dismiss_price_alert_retry(p_user_id uuid, p_event_id text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  delete from public.price_alert_claims where user_id = p_user_id and event_id = p_event_id and delivery_state = 'retryable';
  get diagnostics changed = row_count;
  return changed = 1;
end $$;

create function public.advance_price_alert_retry(p_version text, p_lease uuid, p_user uuid, p_event text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  update public.price_alert_snapshot_jobs set retry_user = p_user, retry_event = p_event
  where version = p_version and lease = p_lease and lease_until > now();
  get diagnostics changed = row_count;
  return changed = 1;
end $$;

create or replace function public.price_alert_delivery_backlog()
returns table (retryable bigint, uncertain bigint, oldest_pending timestamptz, failed bigint)
language sql stable security invoker set search_path = '' as $$
  select count(*) filter (where c.delivery_state = 'retryable'),
    count(*) filter (where c.delivery_state in ('sending', 'unknown')),
    min(c.queued_at) filter (where c.delivery_state in ('retryable', 'sending', 'unknown')),
    count(*) filter (where c.delivery_state = 'terminal')
  from public.price_alert_claims c left join public.price_alert_preferences p on p.user_id = c.user_id and p.area = c.area
  where c.delivery_state = 'terminal' or (p.activation_state = 'active' and c.recorded_at > p.enabled_at);
$$;

revoke all on function public.claim_price_alert_event(uuid,text,text,text,integer,timestamptz,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.price_alert_retry_page(uuid,text,integer) from public, anon, authenticated;
revoke all on function public.advance_price_alert_retry(text,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.dismiss_price_alert_retry(uuid,text) from public, anon, authenticated;
grant execute on function public.claim_price_alert_event(uuid,text,text,text,integer,timestamptz,uuid,jsonb) to service_role;
grant execute on function public.price_alert_retry_page(uuid,text,integer) to service_role;
grant execute on function public.advance_price_alert_retry(text,uuid,uuid,text) to service_role;
grant execute on function public.dismiss_price_alert_retry(uuid,text) to service_role;
