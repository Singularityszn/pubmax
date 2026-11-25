create table public.night_signal_broadcasts (
  version text primary key,
  state text not null check (state in ('sending', 'retryable', 'delivered', 'unknown')),
  attempt uuid,
  targeted integer not null default 0,
  sent integer not null default 0,
  errors integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.night_signal_broadcasts enable row level security;
revoke all on public.night_signal_broadcasts from public, anon, authenticated;
grant select, insert, update on public.night_signal_broadcasts to service_role;
insert into public.night_signal_broadcasts (version, state)
select substring(key from length('night-signal-broadcast:') + 1), 'unknown'
from public.rate_limits
where key like 'night-signal-broadcast:%' and cardinality(hits) > 0
on conflict do nothing;

create function public.claim_night_signal_broadcast(p_version text, p_attempt uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  insert into public.night_signal_broadcasts (version, state, attempt)
    values (p_version, 'sending', p_attempt)
  on conflict (version) do update set state = 'sending', attempt = excluded.attempt, updated_at = now()
    where public.night_signal_broadcasts.state = 'retryable';
  get diagnostics changed = row_count;
  return changed = 1;
end $$;

create function public.settle_night_signal_broadcast(p_version text, p_attempt uuid, p_state text, p_targeted integer, p_sent integer, p_errors integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  if p_state not in ('retryable', 'delivered', 'unknown') or least(p_targeted, p_sent, p_errors) < 0 then raise exception 'invalid broadcast result'; end if;
  update public.night_signal_broadcasts set state = p_state, attempt = null, targeted = p_targeted, sent = p_sent, errors = p_errors, updated_at = now()
    where version = p_version and state = 'sending' and attempt = p_attempt;
  get diagnostics changed = row_count;
  return changed = 1;
end $$;
revoke all on function public.claim_night_signal_broadcast(text,uuid) from public, anon, authenticated;
revoke all on function public.settle_night_signal_broadcast(text,uuid,text,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.claim_night_signal_broadcast(text,uuid) to service_role;
grant execute on function public.settle_night_signal_broadcast(text,uuid,text,integer,integer,integer) to service_role;
