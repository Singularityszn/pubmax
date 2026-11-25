alter table public.payday_pint_subscribers
  add column delivery_state text not null default 'delivered' check (delivery_state in ('sending', 'retryable', 'delivered', 'terminal')),
  add column delivery_attempts integer not null default 0 check (delivery_attempts between 0 and 3),
  add column delivery_claim uuid,
  add column delivery_claimed_at timestamptz,
  add column delivery_request jsonb check (delivery_request is null or jsonb_typeof(delivery_request) = 'object');

create function public.claim_payday_pint_delivery(p_id uuid, p_week text, p_claim uuid, p_now timestamptz)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  update public.payday_pint_subscribers set
    last_claimed_week = p_week,
    delivery_state = 'sending',
    delivery_attempts = case when last_claimed_week is distinct from p_week then 1 else delivery_attempts + 1 end,
    delivery_request = case when last_claimed_week is distinct from p_week then null else delivery_request end,
    delivery_claim = p_claim,
    delivery_claimed_at = p_now
  where id = p_id and unsubscribed_at is null and (
    last_claimed_week is distinct from p_week or
    (delivery_attempts < 3 and (delivery_state = 'retryable' or
      (delivery_state = 'sending' and delivery_claimed_at <= p_now - interval '5 minutes')))
  );
  get diagnostics changed = row_count;
  return changed = 1;
end $$;

create function public.prepare_payday_pint_delivery(p_id uuid, p_week text, p_claim uuid, p_request jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare request jsonb;
begin
  update public.payday_pint_subscribers set delivery_request = coalesce(delivery_request, p_request)
  where id = p_id and last_claimed_week = p_week and delivery_state = 'sending' and delivery_claim = p_claim
  returning delivery_request into request;
  if not found then raise exception 'Payday delivery claim was lost'; end if;
  return request;
end $$;

create function public.finish_payday_pint_delivery(p_id uuid, p_week text, p_claim uuid, p_state text)
returns text language plpgsql security invoker set search_path = '' as $$
declare outcome text;
begin
  if p_state not in ('retryable', 'delivered', 'terminal') then raise exception 'invalid delivery state'; end if;
  update public.payday_pint_subscribers set delivery_state = case when p_state = 'retryable' and delivery_attempts >= 3 then 'terminal' else p_state end, delivery_claim = null, delivery_claimed_at = null
  where id = p_id and last_claimed_week = p_week and delivery_state = 'sending' and delivery_claim = p_claim
  returning delivery_state into outcome;
  return outcome;
end $$;
revoke all on function public.claim_payday_pint_delivery(uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.prepare_payday_pint_delivery(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.finish_payday_pint_delivery(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_payday_pint_delivery(uuid, text, uuid, timestamptz) to service_role;
grant execute on function public.prepare_payday_pint_delivery(uuid, text, uuid, jsonb) to service_role;
grant execute on function public.finish_payday_pint_delivery(uuid, text, uuid, text) to service_role;
