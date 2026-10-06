-- 0176: Pub Pal voice minutes are metered by the server, never by the browser.
--
-- Before: the browser reported how long a session ran, and 0088's
-- record_pub_pal_voice_minutes billed that figure. A signed-in caller who sent
-- zero seconds was billed nothing, so the monthly allowance never filled.
--
-- After: issuing a signed URL PREPAYS the session cap (3 minutes) as one grant
-- row. Nothing the browser says moves the meter. Two server-side doors move it
-- afterwards: refund_pub_pal_voice_grant, only while the grant is still
-- 'reserved' (the server failed before it handed a URL out), and
-- settle_pub_pal_voice_conversation, fed ElevenLabs' own call duration for that
-- conversation. The route settles on release once the provider reports the call
-- ended, and settles the owner's still-issued grants for the month
-- (issued_pub_pal_voice_conversations) before it admits the next session. An
-- unsettled grant stays charged in full, so every failure is the safe
-- direction. A settle that measures more than the prepaid cap charges the
-- difference.
--
-- The three 0027/0070/0088 quota functions are closed to service_role, so a
-- mixed-version deploy cannot reach the client-trusted path. Until the new
-- route ships, the old route answers 503 and the browser falls back to text.
-- The captain applies this migration before the deploy that calls it.

begin;

create table public.pub_pal_voice_grants (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  usage_month date not null check (usage_month = date_trunc('month', usage_month)::date),
  prepaid_minutes integer not null check (prepaid_minutes > 0),
  state text not null default 'reserved'
    check (state in ('reserved', 'issued', 'refunded', 'settled')),
  conversation_id text unique
    check (conversation_id is null or conversation_id ~ '^conv_[A-Za-z0-9]{8,64}$'),
  settled_seconds integer check (settled_seconds is null or settled_seconds >= 0),
  settled_minutes integer check (settled_minutes is null or settled_minutes >= 0),
  settled_at timestamptz,
  created_at timestamptz not null default now()
);

create index pub_pal_voice_grants_owner_month_idx
  on public.pub_pal_voice_grants (owner_id, usage_month);

alter table public.pub_pal_voice_grants enable row level security;
revoke all on public.pub_pal_voice_grants from public, anon, authenticated;
grant select, insert, update, delete on public.pub_pal_voice_grants to service_role;

-- True when the grant was admitted and its minutes are charged. A retried grant
-- id never mints a second grant, even after a refund.
create function public.prepay_pub_pal_voice_grant(
  p_owner_id uuid,
  p_month date,
  p_grant_id uuid,
  p_minutes integer,
  p_limit integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted uuid;
  admitted integer;
begin
  if p_owner_id is null or p_grant_id is null
    or p_month is null or p_month <> date_trunc('month', p_month)::date
    or p_minutes is null or p_minutes <= 0
    or p_limit is null or p_limit <= 0 then
    return false;
  end if;

  insert into public.pub_pal_voice_grants (id, owner_id, usage_month, prepaid_minutes)
  values (p_grant_id, p_owner_id, p_month, p_minutes)
  on conflict (id) do nothing
  returning id into inserted;
  if inserted is null then
    return false;
  end if;

  -- One upsert is the admission test and the charge, so concurrent sessions
  -- queue on the usage row and each sees the minutes the last one charged.
  -- A session is admitted while the month is under the limit, which matches the
  -- pre-0176 rule and overshoots by less than one grant at most.
  insert into public.pub_pal_voice_usage (owner_id, usage_month, session_count, used_minutes)
  values (p_owner_id, p_month, 0, p_minutes)
  on conflict (owner_id, usage_month) do update
    set used_minutes = public.pub_pal_voice_usage.used_minutes + p_minutes
    where public.pub_pal_voice_usage.used_minutes < p_limit
  returning used_minutes into admitted;

  if admitted is null then
    delete from public.pub_pal_voice_grants where id = p_grant_id;
    return false;
  end if;
  return true;
end;
$$;

-- Server failure before a URL left the building. Only a 'reserved' grant can be
-- refunded, once, so a grant that reached a browser can never be taken back.
create function public.refund_pub_pal_voice_grant(
  p_owner_id uuid,
  p_grant_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_row public.pub_pal_voice_grants%rowtype;
begin
  update public.pub_pal_voice_grants
     set state = 'refunded'
   where id = p_grant_id and owner_id = p_owner_id and state = 'reserved'
  returning * into grant_row;
  if not found then
    return false;
  end if;

  update public.pub_pal_voice_usage
     set used_minutes = greatest(0, used_minutes - grant_row.prepaid_minutes)
   where owner_id = grant_row.owner_id and usage_month = grant_row.usage_month;
  return true;
end;
$$;

-- Ties the grant to the provider's conversation id once the URL is minted.
create function public.link_pub_pal_voice_conversation(
  p_owner_id uuid,
  p_grant_id uuid,
  p_conversation_id text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_conversation_id is null or p_conversation_id !~ '^conv_[A-Za-z0-9]{8,64}$' then
    return false;
  end if;
  update public.pub_pal_voice_grants
     set conversation_id = p_conversation_id, state = 'issued'
   where id = p_grant_id and owner_id = p_owner_id and state = 'reserved';
  return found;
end;
$$;

-- The conversations of one owner's month that are still charged at the cap,
-- for the route to settle before it admits that owner's next session.
create function public.issued_pub_pal_voice_conversations(
  p_owner_id uuid,
  p_month date
) returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(conversation_id order by created_at), '{}')
    from public.pub_pal_voice_grants
   where owner_id = p_owner_id and usage_month = p_month
     and state = 'issued' and conversation_id is not null;
$$;

-- Settles an issued grant from the provider's own duration, once. The charge is
-- the billed minutes of that duration (a zero-second call is free); the
-- prepayment above it is returned, and a call that ran past the prepaid cap
-- charges the difference. A second call, another owner's conversation or an
-- unknown conversation moves nothing.
create function public.settle_pub_pal_voice_conversation(
  p_owner_id uuid,
  p_conversation_id text,
  p_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_row public.pub_pal_voice_grants%rowtype;
  charged integer;
begin
  if p_owner_id is null or p_conversation_id is null
    or p_seconds is null or p_seconds < 0 or p_seconds > 86400 then
    return false;
  end if;

  select * into grant_row
    from public.pub_pal_voice_grants
   where owner_id = p_owner_id and conversation_id = p_conversation_id
   for update;
  if not found or grant_row.state <> 'issued' then
    return false;
  end if;

  charged := case when p_seconds = 0 then 0 else greatest(1, (p_seconds + 59) / 60) end;

  update public.pub_pal_voice_usage
     set used_minutes = greatest(0, used_minutes + charged - grant_row.prepaid_minutes)
   where owner_id = grant_row.owner_id and usage_month = grant_row.usage_month;

  update public.pub_pal_voice_grants
     set state = 'settled', settled_seconds = p_seconds,
         settled_minutes = charged, settled_at = now()
   where id = grant_row.id;
  return true;
end;
$$;

revoke all on function public.prepay_pub_pal_voice_grant(uuid, date, uuid, integer, integer)
  from public, anon, authenticated;
revoke all on function public.refund_pub_pal_voice_grant(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.link_pub_pal_voice_conversation(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.issued_pub_pal_voice_conversations(uuid, date)
  from public, anon, authenticated;
revoke all on function public.settle_pub_pal_voice_conversation(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.prepay_pub_pal_voice_grant(uuid, date, uuid, integer, integer)
  to service_role;
grant execute on function public.refund_pub_pal_voice_grant(uuid, uuid)
  to service_role;
grant execute on function public.link_pub_pal_voice_conversation(uuid, uuid, text)
  to service_role;
grant execute on function public.issued_pub_pal_voice_conversations(uuid, date)
  to service_role;
grant execute on function public.settle_pub_pal_voice_conversation(uuid, text, integer)
  to service_role;

-- The client-trusted path. Definitions stay for the rollback.
revoke all on function public.consume_pub_pal_voice_trial(uuid, date, integer) from service_role;
revoke all on function public.release_pub_pal_voice_trial(uuid, date) from service_role;
revoke all on function public.record_pub_pal_voice_minutes(uuid, date, integer) from service_role;

commit;
