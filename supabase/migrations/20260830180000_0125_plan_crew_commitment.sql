-- Record one durable crew commitment when a Plan first reaches two active
-- members. Existing RPC names stamp the occurrence so migration-before-app
-- deployment cannot lose a threshold crossing.

begin;

alter table public.plan_crew_members
  add column if not exists crew_committed_at timestamptz,
  add column if not exists crew_committed_event_id uuid;

alter table public.plan_crew_members
  add constraint plan_crew_members_commitment_pair_check
  check (
    (crew_committed_at is null and crew_committed_event_id is null)
    or (crew_committed_at is not null and crew_committed_event_id is not null)
  );

create unique index if not exists plan_crew_members_one_crew_commitment_idx
  on public.plan_crew_members(plan_id)
  where crew_committed_event_id is not null;

create unique index if not exists plan_crew_members_crew_commitment_event_idx
  on public.plan_crew_members(crew_committed_event_id)
  where crew_committed_event_id is not null;

create or replace function public._plan_crew_commitment_for_member(
  p_plan_id uuid,
  p_member_id uuid,
  p_allow_create boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.plan_crew_members%rowtype;
  v_plan_status text;
begin
  if p_allow_create then
    select plan.status into v_plan_status
    from public.plans plan
    where plan.id = p_plan_id
    for share;
  end if;

  if p_allow_create
     and v_plan_status not in ('completed', 'abandoned')
     and not exists (
       select 1
       from public.plan_crew_members existing_commitment
       where existing_commitment.plan_id = p_plan_id
         and existing_commitment.crew_committed_event_id is not null
     )
     and (
       select count(*)
       from public.plan_crew_members active_member
       where active_member.plan_id = p_plan_id
         and active_member.membership_revoked_at is null
     ) = 2 then
    update public.plan_crew_members threshold_member
    set crew_committed_at = clock_timestamp(),
        crew_committed_event_id = gen_random_uuid()
    where threshold_member.plan_id = p_plan_id
      and threshold_member.id = p_member_id
      and threshold_member.membership_revoked_at is null
      and threshold_member.crew_committed_at is null
      and threshold_member.crew_committed_event_id is null;
  end if;

  select * into v_member
  from public.plan_crew_members member
  where member.plan_id = p_plan_id
    and member.id = p_member_id;

  return jsonb_build_object(
    'crew_committed_at', v_member.crew_committed_at,
    'crew_committed_event_id', v_member.crew_committed_event_id
  );
end;
$$;

-- Keep public text RPCs compatible with deployed app. Renaming current
-- wrappers preserves Social-bound Plan guard byte for byte.
alter function public.join_plan_idempotent_atomic(
  uuid, uuid, text, text, timestamptz, boolean, text, text
) rename to _0125_join_plan_idempotent_atomic;

create function public.join_plan_idempotent_atomic(
  p_plan_id uuid,
  p_member_id uuid,
  p_member_name text,
  p_token_hash text,
  p_joined_at timestamptz,
  p_can_collaborate boolean,
  p_idempotency_key_hash text,
  p_request_hash text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outcome text;
begin
  perform pg_advisory_xact_lock(hashtextextended('plan:join:' || p_plan_id::text, 0));
  v_outcome := public._0125_join_plan_idempotent_atomic(
    p_plan_id, p_member_id, p_member_name, p_token_hash, p_joined_at,
    p_can_collaborate, p_idempotency_key_hash, p_request_hash
  );
  if v_outcome in ('joined', 'replayed') then
    perform public._plan_crew_commitment_for_member(
      p_plan_id, p_member_id, v_outcome = 'joined'
    );
  end if;
  return v_outcome;
end;
$$;

alter function public.redeem_plan_invite_idempotent_atomic(
  uuid, text, uuid, text, text, timestamptz, text, text
) rename to _0125_redeem_plan_invite_idempotent_atomic;

create function public.redeem_plan_invite_idempotent_atomic(
  p_plan_id uuid,
  p_invite_token_hash text,
  p_member_id uuid,
  p_member_name text,
  p_member_token_hash text,
  p_joined_at timestamptz,
  p_idempotency_key_hash text,
  p_request_hash text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outcome text;
begin
  perform pg_advisory_xact_lock(hashtextextended('plan:join:' || p_plan_id::text, 0));
  v_outcome := public._0125_redeem_plan_invite_idempotent_atomic(
    p_plan_id, p_invite_token_hash, p_member_id, p_member_name,
    p_member_token_hash, p_joined_at, p_idempotency_key_hash, p_request_hash
  );
  if v_outcome in ('joined', 'replayed') then
    perform public._plan_crew_commitment_for_member(
      p_plan_id, p_member_id, v_outcome = 'joined'
    );
  end if;
  return v_outcome;
end;
$$;

alter function public.upsert_plan_invite_rsvp_membership_atomic(
  uuid, text, text, text, uuid, uuid, text, text, text, text, timestamptz, integer
) rename to _0125_upsert_plan_invite_rsvp_membership_atomic;

create function public.upsert_plan_invite_rsvp_membership_atomic(
  p_plan_id uuid,
  p_submitter_hash text,
  p_display_name text,
  p_status text,
  p_member_id uuid,
  p_existing_member_id uuid,
  p_member_name text,
  p_member_token_hash text,
  p_member_join_key_hash text,
  p_member_request_hash text,
  p_joined_at timestamptz,
  p_rsvp_ceiling integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_member_id uuid;
  v_was_active boolean := false;
  v_commitment jsonb := jsonb_build_object(
    'crew_committed_at', null,
    'crew_committed_event_id', null
  );
begin
  perform pg_advisory_xact_lock(hashtextextended('plan:join:' || p_plan_id::text, 0));

  select exists (
    select 1
    from public.plan_crew_members member
    left join public.plan_invite_rsvps rsvp
      on rsvp.member_id = member.id
      and rsvp.plan_id = p_plan_id
      and rsvp.submitter_hash = p_submitter_hash
    where member.plan_id = p_plan_id
      and member.membership_revoked_at is null
      and (
        member.id = p_existing_member_id
        or member.join_key_hash = p_member_join_key_hash
        or rsvp.id is not null
      )
  ) into v_was_active;

  v_result := public._0125_upsert_plan_invite_rsvp_membership_atomic(
    p_plan_id, p_submitter_hash, p_display_name, p_status, p_member_id,
    p_existing_member_id, p_member_name, p_member_token_hash,
    p_member_join_key_hash, p_member_request_hash, p_joined_at, p_rsvp_ceiling
  );

  if v_result->>'outcome' = 'saved'
     and v_result->>'member_id' is not null then
    v_member_id := (v_result->>'member_id')::uuid;
    v_commitment := public._plan_crew_commitment_for_member(
      p_plan_id, v_member_id, not v_was_active
    );
  end if;

  return v_result || v_commitment;
end;
$$;

-- New app RPCs return durable threshold evidence. They call compatible
-- public RPCs above so Social-bound guards and migration-before-app behavior
-- stay in one path.
create or replace function public.join_plan_idempotent_with_crew_commitment_atomic(
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
  v_outcome text;
  v_commitment jsonb := jsonb_build_object(
    'crew_committed_at', null,
    'crew_committed_event_id', null
  );
begin
  v_outcome := public.join_plan_idempotent_atomic(
    p_plan_id, p_member_id, p_member_name, p_token_hash, p_joined_at,
    p_can_collaborate, p_idempotency_key_hash, p_request_hash
  );
  if v_outcome in ('joined', 'replayed') then
    v_commitment := public._plan_crew_commitment_for_member(
      p_plan_id, p_member_id, false
    );
  end if;
  return jsonb_build_object(
    'outcome', v_outcome,
    'member_id', case when v_outcome in ('joined', 'replayed') then p_member_id else null end
  ) || v_commitment;
end;
$$;

create or replace function public.redeem_plan_invite_idempotent_with_crew_commitment_atomic(
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
  v_outcome text;
  v_commitment jsonb := jsonb_build_object(
    'crew_committed_at', null,
    'crew_committed_event_id', null
  );
begin
  v_outcome := public.redeem_plan_invite_idempotent_atomic(
    p_plan_id, p_invite_token_hash, p_member_id, p_member_name,
    p_member_token_hash, p_joined_at, p_idempotency_key_hash, p_request_hash
  );
  if v_outcome in ('joined', 'replayed') then
    v_commitment := public._plan_crew_commitment_for_member(
      p_plan_id, p_member_id, false
    );
  end if;
  return jsonb_build_object(
    'outcome', v_outcome,
    'member_id', case when v_outcome in ('joined', 'replayed') then p_member_id else null end
  ) || v_commitment;
end;
$$;

create or replace function public.upsert_plan_invite_rsvp_membership_with_crew_commitment_atomic(
  p_plan_id uuid,
  p_submitter_hash text,
  p_display_name text,
  p_status text,
  p_member_id uuid,
  p_existing_member_id uuid,
  p_member_name text,
  p_member_token_hash text,
  p_member_join_key_hash text,
  p_member_request_hash text,
  p_joined_at timestamptz,
  p_rsvp_ceiling integer
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.upsert_plan_invite_rsvp_membership_atomic(
    p_plan_id, p_submitter_hash, p_display_name, p_status, p_member_id,
    p_existing_member_id, p_member_name, p_member_token_hash,
    p_member_join_key_hash, p_member_request_hash, p_joined_at, p_rsvp_ceiling
  );
$$;

-- Refreshed crew token keeps one durable event ID. Other verified event
-- receipts still bind one event ID to one token digest.
create or replace function public.claim_analytics_event_receipt(
  p_event_id uuid,
  p_token_hash text,
  p_event_name text,
  p_now timestamptz,
  p_lease_until timestamptz
) returns text
language plpgsql security invoker set search_path = public
as $$
declare receipt public.analytics_event_receipts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('analytics:event:' || p_event_id::text, 0));
  select * into receipt from public.analytics_event_receipts where event_id = p_event_id for update;
  if found then
    if receipt.event_name <> p_event_name then return 'conflict'; end if;
    if receipt.token_hash <> p_token_hash and p_event_name <> 'crew_committed' then return 'conflict'; end if;
    if receipt.status = 'delivered' then return 'delivered'; end if;
    if receipt.lease_until > p_now then return 'busy'; end if;
    update public.analytics_event_receipts
    set token_hash = p_token_hash,
        lease_until = p_lease_until
    where event_id = p_event_id;
    return 'claimed';
  end if;
  insert into public.analytics_event_receipts (event_id, token_hash, event_name, lease_until, created_at)
  values (p_event_id, p_token_hash, p_event_name, p_lease_until, p_now);
  return 'claimed';
end;
$$;

-- Renamed implementations and evidence helper are owner-only. Public RPC
-- names and evidence-returning RPCs remain service-only.
revoke all on function public._0125_join_plan_idempotent_atomic(
  uuid, uuid, text, text, timestamptz, boolean, text, text
) from public, anon, authenticated, service_role;
revoke all on function public._0125_redeem_plan_invite_idempotent_atomic(
  uuid, text, uuid, text, text, timestamptz, text, text
) from public, anon, authenticated, service_role;
revoke all on function public._0125_upsert_plan_invite_rsvp_membership_atomic(
  uuid, text, text, text, uuid, uuid, text, text, text, text, timestamptz, integer
) from public, anon, authenticated, service_role;
revoke all on function public._plan_crew_commitment_for_member(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;

revoke all on function public.join_plan_idempotent_atomic(
  uuid, uuid, text, text, timestamptz, boolean, text, text
) from public, anon, authenticated;
revoke all on function public.redeem_plan_invite_idempotent_atomic(
  uuid, text, uuid, text, text, timestamptz, text, text
) from public, anon, authenticated;
revoke all on function public.upsert_plan_invite_rsvp_membership_atomic(
  uuid, text, text, text, uuid, uuid, text, text, text, text, timestamptz, integer
) from public, anon, authenticated;
revoke all on function public.join_plan_idempotent_with_crew_commitment_atomic(
  uuid, uuid, text, text, timestamptz, boolean, text, text
) from public, anon, authenticated;
revoke all on function public.redeem_plan_invite_idempotent_with_crew_commitment_atomic(
  uuid, text, uuid, text, text, timestamptz, text, text
) from public, anon, authenticated;
revoke all on function public.upsert_plan_invite_rsvp_membership_with_crew_commitment_atomic(
  uuid, text, text, text, uuid, uuid, text, text, text, text, timestamptz, integer
) from public, anon, authenticated;
revoke all on function public.claim_analytics_event_receipt(
  uuid, text, text, timestamptz, timestamptz
) from public, anon, authenticated;

grant execute on function public.join_plan_idempotent_atomic(
  uuid, uuid, text, text, timestamptz, boolean, text, text
) to service_role;
grant execute on function public.redeem_plan_invite_idempotent_atomic(
  uuid, text, uuid, text, text, timestamptz, text, text
) to service_role;
grant execute on function public.upsert_plan_invite_rsvp_membership_atomic(
  uuid, text, text, text, uuid, uuid, text, text, text, text, timestamptz, integer
) to service_role;
grant execute on function public.join_plan_idempotent_with_crew_commitment_atomic(
  uuid, uuid, text, text, timestamptz, boolean, text, text
) to service_role;
grant execute on function public.redeem_plan_invite_idempotent_with_crew_commitment_atomic(
  uuid, text, uuid, text, text, timestamptz, text, text
) to service_role;
grant execute on function public.upsert_plan_invite_rsvp_membership_with_crew_commitment_atomic(
  uuid, text, text, text, uuid, uuid, text, text, text, text, timestamptz, integer
) to service_role;
grant execute on function public.claim_analytics_event_receipt(
  uuid, text, text, timestamptz, timestamptz
) to service_role;

commit;
