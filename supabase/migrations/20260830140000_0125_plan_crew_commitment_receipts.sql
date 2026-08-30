-- 0125: Make the two-person crew threshold an atomic, replayable join result.
-- The receipt stays on the member whose join crossed the threshold. Later
-- joins get no receipt, while an idempotent replay of that member gets the
-- original timestamp and Route-readiness decision.

alter table public.plan_crew_members
  add column if not exists crew_committed_at timestamptz,
  add column if not exists crew_committed_route_ready boolean;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.plan_crew_members'::regclass
      and conname = 'plan_crew_members_commitment_receipt_pair'
  ) then
    alter table public.plan_crew_members
      add constraint plan_crew_members_commitment_receipt_pair check (
        (crew_committed_at is null and crew_committed_route_ready is null)
        or
        (crew_committed_at is not null and crew_committed_route_ready is not null)
      );
  end if;
end
$$;

create unique index if not exists plan_crew_one_commitment_receipt_idx
  on public.plan_crew_members (plan_id)
  where crew_committed_at is not null;

create or replace function pubmax_private.plan_join_commitment_result(
  p_plan_id uuid,
  p_member_id uuid,
  p_status text,
  p_joined_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_committed_at timestamptz;
  v_route_ready boolean;
begin
  if p_status = 'joined'
     and (select count(*) from public.plan_crew_members where plan_id = p_plan_id) = 2
     and not exists (
       select 1
       from public.plan_crew_members
       where plan_id = p_plan_id and crew_committed_at is not null
     ) then
    select coalesce(
      plan.plan_outcome = 'route'
      and plan.route_ready_at is not null
      and (
        select count(*)
        from public.plan_stops stop
        where stop.plan_id = p_plan_id
      ) between 3 and 6,
      false
    )
    into v_route_ready
    from public.plans plan
    where plan.id = p_plan_id;

    update public.plan_crew_members
    set crew_committed_at = p_joined_at,
        crew_committed_route_ready = v_route_ready
    where plan_id = p_plan_id and id = p_member_id;
  end if;

  if p_status in ('joined', 'replayed') then
    select member.crew_committed_at, member.crew_committed_route_ready
    into v_committed_at, v_route_ready
    from public.plan_crew_members member
    where member.plan_id = p_plan_id and member.id = p_member_id;
  end if;

  return jsonb_build_object(
    'status', p_status,
    'crewCommittedAt', v_committed_at,
    'crewCommittedRouteReady', v_route_ready
  );
end;
$$;

create or replace function public.join_plan_idempotent_atomic_with_commitment(
  p_plan_id uuid,
  p_member_id uuid,
  p_member_name text,
  p_token_hash text,
  p_joined_at timestamptz,
  p_can_collaborate boolean,
  p_idempotency_key_hash text,
  p_request_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('plan:join:' || p_plan_id::text, 0)
  );
  v_status := public.join_plan_idempotent_atomic(
    p_plan_id,
    p_member_id,
    p_member_name,
    p_token_hash,
    p_joined_at,
    p_can_collaborate,
    p_idempotency_key_hash,
    p_request_hash
  );
  return pubmax_private.plan_join_commitment_result(
    p_plan_id,
    p_member_id,
    v_status,
    p_joined_at
  );
end;
$$;

create or replace function public.redeem_plan_invite_idempotent_atomic_with_commitment(
  p_plan_id uuid,
  p_invite_token_hash text,
  p_member_id uuid,
  p_member_name text,
  p_member_token_hash text,
  p_joined_at timestamptz,
  p_idempotency_key_hash text,
  p_request_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('plan:join:' || p_plan_id::text, 0)
  );
  v_status := public.redeem_plan_invite_idempotent_atomic(
    p_plan_id,
    p_invite_token_hash,
    p_member_id,
    p_member_name,
    p_member_token_hash,
    p_joined_at,
    p_idempotency_key_hash,
    p_request_hash
  );
  return pubmax_private.plan_join_commitment_result(
    p_plan_id,
    p_member_id,
    v_status,
    p_joined_at
  );
end;
$$;

revoke all on function pubmax_private.plan_join_commitment_result(uuid,uuid,text,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.join_plan_idempotent_atomic_with_commitment(uuid,uuid,text,text,timestamptz,boolean,text,text)
  from public, anon, authenticated;
revoke all on function public.redeem_plan_invite_idempotent_atomic_with_commitment(uuid,text,uuid,text,text,timestamptz,text,text)
  from public, anon, authenticated;

grant execute on function public.join_plan_idempotent_atomic_with_commitment(uuid,uuid,text,text,timestamptz,boolean,text,text)
  to service_role;
grant execute on function public.redeem_plan_invite_idempotent_atomic_with_commitment(uuid,text,uuid,text,text,timestamptz,text,text)
  to service_role;
