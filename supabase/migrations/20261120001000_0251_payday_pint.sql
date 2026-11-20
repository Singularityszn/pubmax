create table public.payday_pint_pending (
  confirmation_hash text primary key,
  email text not null,
  station text not null,
  consent_text text not null,
  consent_at timestamptz not null,
  expires_at timestamptz not null,
  unsubscribe_token text not null unique
);
create index payday_pint_pending_expiry_idx on public.payday_pint_pending (expires_at);
create table public.payday_pint_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  station text not null,
  consent_text text not null,
  consent_at timestamptz not null,
  confirmed_at timestamptz not null,
  unsubscribe_token text not null unique,
  unsubscribed_at timestamptz,
  last_claimed_week text
);
alter table public.payday_pint_pending enable row level security;
alter table public.payday_pint_subscribers enable row level security;
revoke all on public.payday_pint_pending, public.payday_pint_subscribers from public, anon, authenticated;
grant select, insert, update, delete on public.payday_pint_pending, public.payday_pint_subscribers to service_role;

create function public.confirm_payday_pint(p_hash text, p_now timestamptz)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare pending public.payday_pint_pending%rowtype; changed integer;
begin
  delete from public.payday_pint_pending where confirmation_hash = p_hash and expires_at >= p_now
    returning * into pending;
  if not found then return false; end if;
  insert into public.payday_pint_subscribers as current_subscriber
    (email, station, consent_text, consent_at, confirmed_at, unsubscribe_token)
    values (pending.email, pending.station, pending.consent_text, pending.consent_at, p_now, pending.unsubscribe_token)
    on conflict (email) do update set station = excluded.station, consent_text = excluded.consent_text,
      consent_at = excluded.consent_at, confirmed_at = excluded.confirmed_at,
      unsubscribe_token = excluded.unsubscribe_token, unsubscribed_at = null
    where current_subscriber.consent_at < excluded.consent_at
      and (current_subscriber.unsubscribed_at is null or current_subscriber.unsubscribed_at < excluded.consent_at);
  get diagnostics changed = row_count;
  return changed = 1;
end $$;
revoke all on function public.confirm_payday_pint(text, timestamptz) from public, anon, authenticated;
grant execute on function public.confirm_payday_pint(text, timestamptz) to service_role;
