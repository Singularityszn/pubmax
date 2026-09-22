-- 0157: Server-issued voice grants reserve the full three-minute cap up front.
-- Client completion never refunds. Only server failure before handing out a
-- provider URL can refund its unique grant, once. No precise usage claim.
begin;
create table public.pub_pal_voice_grants (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  usage_month date not null,
  refunded boolean not null default false,
  provider_conversation_id text unique,
  provider_status text not null default 'reserved'
    check (provider_status in ('reserved','issued','done','failed','over_cap')),
  call_duration_seconds integer check (call_duration_seconds is null or call_duration_seconds >= 0),
  settled_minutes integer check (settled_minutes is null or settled_minutes between 0 and 3),
  reconciled_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.pub_pal_voice_grants enable row level security;
revoke all on public.pub_pal_voice_grants from public, anon, authenticated;
grant select, insert, update, delete on public.pub_pal_voice_grants to service_role;
create index pub_pal_voice_grants_owner_month on public.pub_pal_voice_grants(owner_id, usage_month);

-- Store callback identity only. The webhook includes transcript/audio-adjacent
-- fields, but no conversation content is retained by this application.
create table public.pub_pal_voice_provider_events (
  grant_id uuid not null references public.pub_pal_voice_grants(id) on delete cascade,
  conversation_id text not null,
  event_timestamp bigint not null check (event_timestamp > 0),
  provider_status text not null check (provider_status in ('done','failed','over_cap')),
  call_duration_seconds integer not null check (call_duration_seconds >= 0),
  received_at timestamptz not null default now(),
  primary key (conversation_id, event_timestamp)
);
alter table public.pub_pal_voice_provider_events enable row level security;
revoke all on public.pub_pal_voice_provider_events from public, anon, authenticated;
grant select, insert, update, delete on public.pub_pal_voice_provider_events to service_role;

create function public.prepay_pub_pal_voice_grant(p_owner_id uuid, p_month date, p_grant_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare inserted uuid; admitted integer;
begin
  if p_month is null or p_month <> date_trunc('month', p_month)::date then return false; end if;
  insert into public.pub_pal_voice_grants(id, owner_id, usage_month)
    values(p_grant_id, p_owner_id, p_month) on conflict do nothing returning id into inserted;
  -- A retried grant may not mint another provider URL, even after refund.
  if inserted is null then return false; end if;
  insert into public.pub_pal_voice_usage(owner_id, usage_month, session_count, used_minutes)
    values(p_owner_id, p_month, 0, 3)
  on conflict(owner_id, usage_month) do update
    set used_minutes = public.pub_pal_voice_usage.used_minutes + 3
    where public.pub_pal_voice_usage.used_minutes <= 27
  returning used_minutes into admitted;
  if admitted is null then
    delete from public.pub_pal_voice_grants where id = p_grant_id;
    return false;
  end if;
  return true;
end;
$$;
create function public.refund_pub_pal_voice_grant(p_owner_id uuid, p_grant_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare grant_month date;
begin
  update public.pub_pal_voice_grants set refunded = true
    where id = p_grant_id and owner_id = p_owner_id and not refunded
    returning usage_month into grant_month;
  if grant_month is null then return false; end if;
  update public.pub_pal_voice_usage set used_minutes = greatest(0, used_minutes - 3)
    where owner_id = p_owner_id and usage_month = grant_month;
  return true;
end;
$$;

create function public.link_pub_pal_voice_conversation(p_grant_id uuid, p_conversation_id text)
returns boolean language plpgsql security definer set search_path = public as $$
declare linked uuid;
begin
  if p_conversation_id is null or p_conversation_id !~ '^[A-Za-z0-9_-]{1,128}$' then return false; end if;
  update public.pub_pal_voice_grants
    set provider_conversation_id = p_conversation_id, provider_status = 'issued'
    where id = p_grant_id and not refunded and provider_status = 'reserved'
    returning id into linked;
  return linked is not null;
end;
$$;

create function public.reconcile_pub_pal_voice_conversation(
  p_conversation_id text,
  p_event_timestamp bigint,
  p_status text,
  p_duration_seconds integer
)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  grant_row public.pub_pal_voice_grants%rowtype;
  inserted bigint;
  charged_minutes integer;
  reconciled_status text;
begin
  if p_conversation_id is null or p_conversation_id !~ '^[A-Za-z0-9_-]{1,128}$'
    or p_event_timestamp is null or p_event_timestamp <= 0
    or p_status not in ('done','failed')
    or p_duration_seconds is null or p_duration_seconds < 0 or p_duration_seconds > 86400 then
    return false;
  end if;
  select * into grant_row from public.pub_pal_voice_grants
    where provider_conversation_id = p_conversation_id for update;
  if not found then return false; end if;

  reconciled_status := case when p_duration_seconds > 180 then 'over_cap' else p_status end;
  insert into public.pub_pal_voice_provider_events(
    grant_id, conversation_id, event_timestamp, provider_status, call_duration_seconds
  ) values (
    grant_row.id, p_conversation_id, p_event_timestamp, reconciled_status, p_duration_seconds
  ) on conflict (conversation_id, event_timestamp) do nothing returning event_timestamp into inserted;
  if inserted is null or grant_row.reconciled_at is not null then return true; end if;
  if grant_row.refunded then return false; end if;

  charged_minutes := case
    when p_duration_seconds = 0 then 0
    else least(3, ceil(p_duration_seconds / 60.0)::integer)
  end;
  update public.pub_pal_voice_usage
    set used_minutes = greatest(0, used_minutes - (3 - charged_minutes))
    where owner_id = grant_row.owner_id and usage_month = grant_row.usage_month;
  update public.pub_pal_voice_grants
    set provider_status = reconciled_status,
        call_duration_seconds = p_duration_seconds,
        settled_minutes = charged_minutes,
        reconciled_at = now()
    where id = grant_row.id;
  return true;
end;
$$;
-- 0070/0088 exposed server-role RPCs that allow callers to reserve one legacy
-- session, release it, or report client-measured duration. Leaving them live
-- would let a mixed-version deployment bypass prepaid grants. Keep the
-- function definitions for rollback, but remove every application role's
-- ability to execute them atomically with the new grant contract.
revoke all on function public.consume_pub_pal_voice_trial(uuid,date,integer)
  from public, anon, authenticated, service_role;
revoke all on function public.release_pub_pal_voice_trial(uuid,date)
  from public, anon, authenticated, service_role;
revoke all on function public.record_pub_pal_voice_minutes(uuid,date,integer)
  from public, anon, authenticated, service_role;
revoke all on function public.prepay_pub_pal_voice_grant(uuid,date,uuid) from public, anon, authenticated;
revoke all on function public.refund_pub_pal_voice_grant(uuid,uuid) from public, anon, authenticated;
revoke all on function public.link_pub_pal_voice_conversation(uuid,text) from public, anon, authenticated;
revoke all on function public.reconcile_pub_pal_voice_conversation(text,bigint,text,integer) from public, anon, authenticated;
grant execute on function public.prepay_pub_pal_voice_grant(uuid,date,uuid) to service_role;
grant execute on function public.refund_pub_pal_voice_grant(uuid,uuid) to service_role;
grant execute on function public.link_pub_pal_voice_conversation(uuid,text) to service_role;
grant execute on function public.reconcile_pub_pal_voice_conversation(text,bigint,text,integer) to service_role;
commit;
