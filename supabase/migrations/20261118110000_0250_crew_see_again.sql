-- 0250: private friendship choices after the host attendance window.
-- No dating context is enabled. No moderator choice reader or browser grants exist.
-- Lock order: Crew, auth rows in ID order, participant accounts in ID order,
-- stable unordered pair, then private rows. Reads take the same locks as writes.
-- Safety triggers never acquire another participant account from an AFTER trigger.
-- Subject account writers exclude paired transactions with that subject.
-- Leave, host removal, role, ownership and visibility changes lock roster
-- auth/accounts before invalidation, seat closure and receipt writes. Ownership
-- transfer also locks its Plan before pair invalidation, as cancellation does.
-- Moderator removal locks participant auth/accounts before its case row. Crew-scoped raw status writes
-- take pair locks in canonical order, as does the full visible-export batch.
-- Block and suspension invalidation spans Crews.
-- Rollback destroys private choices and requires an exact row-count acknowledgement.
begin;
lock table auth.users, public.private_social_accounts, public.social_blocks,
  public.social_mutes, public.social_crews, public.social_crew_members,
  public.social_crew_attendance, public.plans in share row exclusive mode;

create table public.social_crew_see_again_pairs (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.social_crews(id) on delete cascade,
  context text not null check (context='friendship'),
  low_account_id uuid not null,
  high_account_id uuid not null check (low_account_id<high_account_id),
  low_user_id uuid not null references auth.users(id) on delete cascade,
  high_user_id uuid not null references auth.users(id) on delete cascade,
  low_attendance_revision integer not null check (low_attendance_revision>0),
  high_attendance_revision integer not null check (high_attendance_revision>0),
  state text not null check (state in ('open','mutual','closed')),
  revision integer not null default 1 check (revision>0),
  formed_at timestamptz,
  choice_expires_at timestamptz not null,
  expires_at timestamptz not null,
  unique (crew_id,context,low_account_id,high_account_id),
  check ((state='mutual' and formed_at is not null and expires_at<=formed_at+interval '30 days')
    or (state in ('open','closed') and formed_at is null and expires_at=choice_expires_at))
);
create index social_crew_see_again_pairs_low_idx on public.social_crew_see_again_pairs(low_user_id);
create index social_crew_see_again_pairs_high_idx on public.social_crew_see_again_pairs(high_user_id);
create index social_crew_see_again_pairs_low_account_idx on public.social_crew_see_again_pairs(low_account_id,high_account_id,id);
create index social_crew_see_again_pairs_high_account_idx on public.social_crew_see_again_pairs(high_account_id,low_account_id,id);
create index social_crew_see_again_pairs_expiry_idx on public.social_crew_see_again_pairs(expires_at,id);
create table public.social_crew_see_again_choices (
  pair_id uuid not null references public.social_crew_see_again_pairs(id) on delete cascade,
  crew_id uuid not null,
  context text not null check (context='friendship'),
  picker_account_id uuid not null,
  picked_member_id uuid not null,
  picked_account_id uuid not null check (picker_account_id<>picked_account_id),
  picker_user_id uuid not null,
  choice text not null check (choice in ('chosen','withdrawn')),
  chosen_at timestamptz not null default clock_timestamp(),
  withdrawn_at timestamptz,
  expires_at timestamptz not null,
  primary key (crew_id,context,picker_account_id,picked_account_id),
  unique (pair_id,picker_account_id),
  check ((choice='withdrawn')=(withdrawn_at is not null))
);
create index social_crew_see_again_choices_owner_idx
  on public.social_crew_see_again_choices(picker_user_id,chosen_at,pair_id);
alter table public.social_crew_see_again_pairs enable row level security;
alter table public.social_crew_see_again_choices enable row level security;
revoke all on public.social_crew_see_again_pairs, public.social_crew_see_again_choices from public,anon,authenticated,service_role;

-- Evolve the existing guarded moderator writer inside this migration only.
create or replace function public.decide_social_crew_block_case_admin(
  p_staff_role_id uuid,p_case_id uuid,p_seen_blockers uuid[],p_decision text,p_member_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_staff public.private_social_staff_roles; v_case public.social_crew_block_cases;
  v_member public.social_crew_members; v_reason text:=btrim(coalesce(p_reason,'')); v_seen uuid[];
begin
  select * into v_staff from public.private_social_staff_roles
  where id=p_staff_role_id and active and revoked_at is null and role='moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  if p_decision is null or p_decision not in ('kept','removed') or char_length(v_reason) not between 3 and 500
    or (p_decision='removed') <> (p_member_id is not null)
    or p_seen_blockers is null or exists(select 1 from pg_catalog.unnest(p_seen_blockers) seen where seen is null) then
    return jsonb_build_object('ok',false,'code','invalid'); end if;
  v_seen:=array(select distinct seen from pg_catalog.unnest(p_seen_blockers) seen order by seen);
  select * into v_case from public.social_crew_block_cases where id=p_case_id;
  if v_case.id is null then return jsonb_build_object('ok',false,'code','not_found'); end if;
  perform 1 from public.social_crews where id=v_case.crew_id for update;
  if not found then return jsonb_build_object('ok',false,'code','not_found'); end if;
  -- Item 5: both auth rows before the case row. A deletion in flight holds its auth row
  -- while it deletes the case, so this waits, and then the case is gone.
  perform 1 from auth.users auth_user
    join public.private_social_accounts account on account.supabase_user_id=auth_user.id
    where account.id in (v_case.blocker_account_id,v_case.blocked_account_id)
    order by auth_user.id
    for key share of auth_user;
  -- W6 invalidation can wait for pair locks. Take account locks before the case,
  -- and before the live blockers check, never from a membership AFTER trigger.
  perform public._lock_social_participant_accounts(array[v_case.blocker_account_id,v_case.blocked_account_id]);
  select * into v_case from public.social_crew_block_cases where id=p_case_id for update;
  if v_case.id is null then return jsonb_build_object('ok',false,'code','not_found'); end if;
  -- Revocation can commit during the waits. SHARE keeps authority through the write.
  select staff.* into v_staff from public.private_social_staff_roles staff
  where staff.id=p_staff_role_id and staff.profile_id=v_staff.profile_id
    and staff.active and staff.revoked_at is null and staff.role='moderator' for share;
  if v_staff.id is null then raise exception 'staff required'; end if;
  if public._social_crew_block_case_moderator_conflicted(v_staff.profile_id,v_case.crew_id,
      v_case.blocker_account_id,v_case.blocked_account_id) then
    return jsonb_build_object('ok',false,'code','forbidden'); end if;
  if v_case.expires_at <= pg_catalog.statement_timestamp() then
    return jsonb_build_object('ok',false,'code','expired'); end if;
  if v_case.decided_at is not null then
    if v_case.decision=p_decision and v_case.removed_member_id is not distinct from p_member_id then
      return jsonb_build_object('ok',true,'code','unchanged','decision',v_case.decision); end if;
    return jsonb_build_object('ok',false,'code','already_decided','decision',v_case.decision);
  end if;
  -- Item 4: the queue's rule and blockers again, under the crew row, after the waits
  -- above, in one statement so both read one snapshot.
  if not public._social_crew_block_case_live(v_case.crew_id,v_case.blocker_account_id,v_case.blocked_account_id)
    or public._social_crew_block_case_blockers(v_case.crew_id,v_case.blocker_account_id,v_case.blocked_account_id)
      is distinct from v_seen then
    return jsonb_build_object('ok',false,'code','stale'); end if;
  if p_decision='removed' then
    select * into v_member from public.social_crew_members
    where id=p_member_id and crew_id=v_case.crew_id
      and social_account_id in (v_case.blocker_account_id,v_case.blocked_account_id)
    for update;
    if v_member.id is null or v_member.role='owner' then return jsonb_build_object('ok',false,'code','invalid'); end if;
    if v_member.state<>'active' then return jsonb_build_object('ok',false,'code','stale'); end if;
    update public.social_crew_members set state='removed',ended_at=now(),updated_at=now() where id=v_member.id;
    update public.social_crews set authority_revision=authority_revision+1,updated_at=now() where id=v_case.crew_id;
  end if;
  update public.social_crew_block_cases
  set decision=p_decision, removed_member_id=v_member.id, reason=v_reason, staff_role_id=v_staff.id,
    staff_display_name=v_staff.display_name, decided_at=pg_catalog.statement_timestamp()
  where id=v_case.id;
  return jsonb_build_object('ok',true,'code','decided','decision',p_decision);
end;
$$;

-- accountIsAdult parity: a stored DOB wins, otherwise a recorded assertion passes.
-- Month/day comparison preserves the existing London leap-day birthday rule.
create function public._see_again_adult(p_account uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.private_social_accounts a
    join auth.users u on u.id=a.supabase_user_id
    join public.profiles p on p.id=a.profile_id and p.user_id=u.id and p.tombstoned_at is null
    left join public.private_account_identities i on i.user_id=u.id
    left join public.adult_self_assertions s on s.user_id=u.id
    where a.id=p_account and a.ownership_state='active' and p.handle is not null
    and case when i.date_of_birth is not null then
      pg_catalog.isfinite(i.date_of_birth) and i.date_of_birth>=date '0001-01-01' and
      extract(year from (clock_timestamp() at time zone 'Europe/London'))-extract(year from i.date_of_birth)
        - case when to_char(clock_timestamp() at time zone 'Europe/London','MMDD')<to_char(i.date_of_birth,'MMDD') then 1 else 0 end >=18
      else s.asserted_at is not null and pg_catalog.isfinite(s.asserted_at) end);
$$;
-- Match the existing Crew authority and seat boundary, without a full snapshot.
create function public._see_again_crew_access(p_crew uuid,p_account uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.social_crews c
    join public.plans plan on plan.id=c.plan_id and plan.social_owner_account_id=c.owner_account_id and plan.status<>'abandoned'
    join public.private_social_accounts host on host.id=c.owner_account_id and host.ownership_state='active'
    join auth.users u on u.id=host.supabase_user_id
    join public.profiles profile on profile.id=host.profile_id and profile.user_id=u.id and profile.tombstoned_at is null
    join public.social_crew_members owner on owner.crew_id=c.id and owner.social_account_id=host.id and owner.state='active' and owner.role='owner'
    join public.plan_crew_members owner_seat on owner_seat.id=owner.plan_member_id and owner_seat.plan_id=plan.id and owner_seat.social_account_id=host.id
    join public.social_crew_members member on member.crew_id=c.id and member.social_account_id=p_account and member.state='active'
    join public.plan_crew_members seat on seat.id=member.plan_member_id and seat.plan_id=plan.id and seat.social_account_id=p_account
    where c.id=p_crew and c.visibility='open'
    and public._social_crew_relationship_between_accounts(p_account,host.id) is distinct from 'blocked');
$$;
create function public._see_again_participant(p_crew uuid,p_account uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select public._see_again_adult(p_account) and public._see_again_crew_access(p_crew,p_account)
    and exists(select 1 from public.social_crew_members m where m.crew_id=p_crew and m.social_account_id=p_account and m.state='active' and m.role='member')
    and exists(select 1 from public._social_crew_attendance_current(p_crew,p_account) mark where mark.state='attended');
$$;
create function public._see_again_allowed(p_crew uuid,p_a uuid,p_b uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select p_a<>p_b and public._see_again_participant(p_crew,p_a) and public._see_again_participant(p_crew,p_b)
    and public._social_crew_relationship_between_accounts(p_a,p_b) is distinct from 'blocked'
    and not exists(select 1 from public.social_mutes mute
      join public.private_social_accounts a on a.id=p_a join public.private_social_accounts b on b.id=p_b
      where (mute.muter_profile_id=a.profile_id and mute.muted_profile_id=b.profile_id)
        or (mute.muter_profile_id=b.profile_id and mute.muted_profile_id=a.profile_id));
$$;
create function public._see_again_pair_lock(p_a uuid,p_b uuid) returns void
language sql security definer set search_path='' as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'crew-see-again-pair:'||least(p_a,p_b)::text||':'||greatest(p_a,p_b)::text,0));
$$;
-- Shared with nextSeeAgainPair in lib/crewSeeAgain.ts. Terminal states never reopen.
create function public._see_again_next(p_state text,p_event text) returns text
language sql immutable set search_path='' as $$
  select case when p_event in ('invalidate','withdraw') then 'closed'
    when p_state='open' and p_event='form' then 'mutual' else p_state end;
$$;

-- Caller holds the Crew row. Take every roster auth/account lock once in order.
-- This also keeps a roster read from accumulating accounts in a different order.
create function public._see_again_lock_roster(p_crew uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from auth.users u join public.private_social_accounts a on a.supabase_user_id=u.id
    join public.social_crew_members m on m.social_account_id=a.id
    where m.crew_id=p_crew and m.state='active' order by u.id for key share of u;
  perform public._lock_social_participant_accounts(array(select m.social_account_id
    from public.social_crew_members m where m.crew_id=p_crew and m.state='active'));
end;
$$;

-- Seat invalidation and receipt writes must follow auth/account locks too.
create or replace function public.remove_social_crew_member_atomic(
  p_actor_account_id uuid,p_crew_id uuid,p_target_member_id uuid,p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_replay jsonb; v_role text; v_target public.social_crew_members%rowtype; v_response jsonb;
begin
  v_replay:=public._social_crew_begin_write(p_actor_account_id,'remove-member',p_idempotency_key,p_payload_digest);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.social_crews where id=p_crew_id for update;
  perform public._see_again_lock_roster(p_crew_id);
  v_role:=public._social_crew_member_role(p_crew_id,p_actor_account_id);
  if v_role is null or v_role not in ('owner','cohost') then return public._social_crew_fail_write(p_actor_account_id,'remove-member',p_idempotency_key,p_payload_digest,'not_found'); end if;
  select * into v_target from public.social_crew_members where id=p_target_member_id and crew_id=p_crew_id and state='active' for update;
  if not found or v_target.role='owner' then return public._social_crew_fail_write(p_actor_account_id,'remove-member',p_idempotency_key,p_payload_digest,'not_found'); end if;
  update public.social_crew_members set state='removed',ended_at=now(),updated_at=now() where id=v_target.id;
  update public.social_crews set authority_revision=authority_revision+1,updated_at=now() where id=p_crew_id;
  v_response:=jsonb_build_object('ok',true,'code','removed','member_id',v_target.id);
  return public._social_crew_finish_write(p_actor_account_id,'remove-member',p_idempotency_key,p_payload_digest,v_response);
end;
$$;

create or replace function public.leave_social_crew_atomic(
  p_actor_account_id uuid,p_crew_id uuid,p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_replay jsonb; v_member public.social_crew_members%rowtype; v_response jsonb;
begin
  v_replay:=public._social_crew_begin_write(p_actor_account_id,'leave',p_idempotency_key,p_payload_digest);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.social_crews where id=p_crew_id for update;
  perform public._see_again_lock_roster(p_crew_id);
  select * into v_member from public.social_crew_members where crew_id=p_crew_id and social_account_id=p_actor_account_id and state='active' for update;
  if not found then return public._social_crew_fail_write(p_actor_account_id,'leave',p_idempotency_key,p_payload_digest,'not_found'); end if;
  if v_member.role='owner' then return public._social_crew_fail_write(p_actor_account_id,'leave',p_idempotency_key,p_payload_digest,'owner_cannot_leave'); end if;
  update public.social_crew_members set state='left',ended_at=now(),updated_at=now() where id=v_member.id;
  update public.social_crews set authority_revision=authority_revision+1,updated_at=now() where id=p_crew_id;
  v_response:=jsonb_build_object('ok',true,'code','left','member_id',v_member.id);
  return public._social_crew_finish_write(p_actor_account_id,'leave',p_idempotency_key,p_payload_digest,v_response);
end;
$$;

create or replace function public.update_social_crew_visibility_atomic(
  p_actor_account_id uuid,p_crew_id uuid,p_visibility text,p_expected_authority_revision integer,
  p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_replay jsonb; v_revision integer; v_response jsonb;
begin
  v_replay:=public._social_crew_begin_write(p_actor_account_id,'visibility',p_idempotency_key,p_payload_digest);
  if v_replay is not null then return v_replay; end if;
  select authority_revision into v_revision from public.social_crews where id=p_crew_id for update;
  perform public._see_again_lock_roster(p_crew_id);
  if public._social_crew_member_role(p_crew_id,p_actor_account_id) is distinct from 'owner' or p_visibility is null or p_visibility not in ('private','friends','open')
    then return public._social_crew_fail_write(p_actor_account_id,'visibility',p_idempotency_key,p_payload_digest,'not_found'); end if;
  if v_revision is distinct from p_expected_authority_revision then return public._social_crew_fail_write(p_actor_account_id,'visibility',p_idempotency_key,p_payload_digest,'conflict'); end if;
  update public.social_crews set visibility=p_visibility,authority_revision=authority_revision+1,updated_at=now() where id=p_crew_id
    returning authority_revision into v_revision;
  v_response:=jsonb_build_object('ok',true,'code','updated','authority_revision',v_revision);
  return public._social_crew_finish_write(p_actor_account_id,'visibility',p_idempotency_key,p_payload_digest,v_response);
end;
$$;

create or replace function public.set_social_crew_role_atomic(
  p_actor_account_id uuid,p_crew_id uuid,p_target_member_id uuid,p_role text,
  p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_replay jsonb; v_target public.social_crew_members%rowtype; v_response jsonb;
begin
  v_replay:=public._social_crew_begin_write(p_actor_account_id,'set-role',p_idempotency_key,p_payload_digest);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.social_crews where id=p_crew_id for update;
  perform public._see_again_lock_roster(p_crew_id);
  if public._social_crew_member_role(p_crew_id,p_actor_account_id) is distinct from 'owner' or p_role is null or p_role not in ('cohost','member')
    then return public._social_crew_fail_write(p_actor_account_id,'set-role',p_idempotency_key,p_payload_digest,'not_found'); end if;
  select * into v_target from public.social_crew_members where id=p_target_member_id and crew_id=p_crew_id and state='active' for update;
  if not found or v_target.role='owner' then return public._social_crew_fail_write(p_actor_account_id,'set-role',p_idempotency_key,p_payload_digest,'not_found'); end if;
  update public.social_crew_members set role=p_role,updated_at=now() where id=v_target.id;
  update public.social_crews set authority_revision=authority_revision+1,updated_at=now() where id=p_crew_id;
  v_response:=jsonb_build_object('ok',true,'code','updated','member_id',v_target.id);
  return public._social_crew_finish_write(p_actor_account_id,'set-role',p_idempotency_key,p_payload_digest,v_response);
end;
$$;

create or replace function public.transfer_social_crew_owner_atomic(
  p_actor_account_id uuid,p_crew_id uuid,p_target_member_id uuid,
  p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_replay jsonb; v_target public.social_crew_members%rowtype; v_old uuid; v_plan uuid; v_response jsonb;
begin
  v_replay:=public._social_crew_begin_write(p_actor_account_id,'transfer-owner',p_idempotency_key,p_payload_digest);
  if v_replay is not null then return v_replay; end if;
  select plan_id into v_plan from public.social_crews where id=p_crew_id for update;
  perform public._see_again_lock_roster(p_crew_id);
  if public._social_crew_member_role(p_crew_id,p_actor_account_id) is distinct from 'owner' then return public._social_crew_fail_write(p_actor_account_id,'transfer-owner',p_idempotency_key,p_payload_digest,'not_found'); end if;
  select * into v_target from public.social_crew_members where id=p_target_member_id and crew_id=p_crew_id and state='active' for update;
  if not found or v_target.role='owner' or public._social_crew_relationship_between_accounts(v_target.social_account_id,p_actor_account_id) is distinct from 'mutual'
    then return public._social_crew_fail_write(p_actor_account_id,'transfer-owner',p_idempotency_key,p_payload_digest,'not_found'); end if;
  -- A standalone cancellation holds its Plan before invalidating pairs.
  perform 1 from public.plans where id=v_plan for update;
  select id into v_old from public.social_crew_members where crew_id=p_crew_id and social_account_id=p_actor_account_id and state='active' for update;
  update public.social_crew_members set role='cohost',updated_at=now() where id=v_old;
  update public.social_crew_members set role='owner',updated_at=now() where id=v_target.id;
  update public.social_crews set owner_account_id=v_target.social_account_id,authority_revision=authority_revision+1,updated_at=now() where id=p_crew_id;
  update public.plans set social_owner_account_id=v_target.social_account_id where id=v_plan;
  v_response:=jsonb_build_object('ok',true,'code','transferred','member_id',v_target.id);
  return public._social_crew_finish_write(p_actor_account_id,'transfer-owner',p_idempotency_key,p_payload_digest,v_response);
end;
$$;

create function public.write_social_crew_see_again(p_actor uuid,p_profile uuid,p_crew uuid,p_member uuid,
  p_context text,p_action text,p_consent boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare other_account uuid; low_id uuid; high_id uuid; v_window record;
  pair public.social_crew_see_again_pairs; v_now timestamptz;
begin
  -- Every refusal is the same neutral acknowledgement. A write never reveals.
  if p_context is distinct from 'friendship' or p_action is null or p_action not in ('choose','withdraw')
    or (p_action='choose' and p_consent is distinct from true) then return '{"ok":true}'::jsonb; end if;
  perform 1 from public.social_crews where id=p_crew and visibility='open' for update;
  if not found then return '{"ok":true}'::jsonb; end if;
  perform public._see_again_lock_roster(p_crew);
  if not exists(select 1 from public.private_social_accounts where id=p_actor and profile_id=p_profile)
    then return '{"ok":true}'::jsonb; end if;
  select social_account_id into other_account from public.social_crew_members where id=p_member and crew_id=p_crew and state='active';
  if other_account is null then return '{"ok":true}'::jsonb; end if;
  perform public._see_again_pair_lock(p_actor,other_account);
  if not public._see_again_allowed(p_crew,p_actor,other_account) then return '{"ok":true}'::jsonb; end if;
  select * into v_window from public._social_crew_attendance_window(p_crew);
  v_now:=clock_timestamp();
  if v_window.cancelled or v_window.closes_at is null or v_now<v_window.closes_at then return '{"ok":true}'::jsonb; end if;
  low_id:=least(p_actor,other_account); high_id:=greatest(p_actor,other_account);
  select * into pair from public.social_crew_see_again_pairs
    where crew_id=p_crew and context=p_context and low_account_id=low_id and high_account_id=high_id for update;
  -- Withdrawals can dismiss a retained mutual after the choice window closes.
  if v_now>=v_window.closes_at+interval '72 hours' and (p_action<>'withdraw' or pair.state is distinct from 'mutual') then
    return '{"ok":true}'::jsonb; end if;
  if pair.id is not null and pair.expires_at<=v_now then return '{"ok":true}'::jsonb; end if;
  if p_action='withdraw' and pair.id is not null and v_now>=pair.choice_expires_at then
    delete from public.social_crew_see_again_pairs where id=pair.id;
    return '{"ok":true}'::jsonb;
  end if;
  if pair.id is null then
    insert into public.social_crew_see_again_pairs(crew_id,context,low_account_id,high_account_id,low_user_id,high_user_id,
      low_attendance_revision,high_attendance_revision,state,choice_expires_at,expires_at)
    select p_crew,p_context,low_id,high_id,l.supabase_user_id,h.supabase_user_id,lm.revision,hm.revision,'open',v_window.closes_at+interval '72 hours',v_window.closes_at+interval '72 hours'
      from public.private_social_accounts l,public.private_social_accounts h,
        public._social_crew_attendance_current(p_crew,low_id) lm,public._social_crew_attendance_current(p_crew,high_id) hm
      where l.id=low_id and h.id=high_id returning * into pair;
  end if;
  if p_action='withdraw' then
    insert into public.social_crew_see_again_choices(pair_id,crew_id,context,picker_account_id,picked_account_id,picked_member_id,picker_user_id,choice,withdrawn_at,expires_at)
      select pair.id,p_crew,p_context,p_actor,other_account,p_member,supabase_user_id,'withdrawn',v_now,pair.choice_expires_at
      from public.private_social_accounts where id=p_actor
      on conflict (crew_id,context,picker_account_id,picked_account_id) do update set choice='withdrawn',withdrawn_at=excluded.withdrawn_at;
    update public.social_crew_see_again_pairs set state=public._see_again_next(pair.state,'withdraw'),formed_at=null,expires_at=choice_expires_at,revision=revision+1
      where id=pair.id and revision=pair.revision;
  elsif p_action='choose' then
    insert into public.social_crew_see_again_choices(pair_id,crew_id,context,picker_account_id,picked_account_id,picked_member_id,picker_user_id,choice,expires_at)
      select pair.id,p_crew,p_context,p_actor,other_account,p_member,supabase_user_id,'chosen',pair.choice_expires_at from public.private_social_accounts where id=p_actor
      on conflict do nothing;
    if pair.state='open' and (select count(*) from public.social_crew_see_again_choices where pair_id=pair.id and choice='chosen')=2 then
      update public.social_crew_see_again_pairs set state=public._see_again_next(pair.state,'form'),revision=revision+1,
        formed_at=v_now,expires_at=least(v_now+interval '30 days',v_window.expires_at) where id=pair.id and revision=pair.revision;
    end if;
  end if;
  return '{"ok":true}'::jsonb;
end;
$$;

create function public.read_social_crew_see_again(p_actor uuid,p_profile uuid,p_crew uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_window record; candidates jsonb:='[]'; candidate record; pair public.social_crew_see_again_pairs;
  own_choice text; v_now timestamptz; is_mutual boolean;
begin
  perform 1 from public.social_crews where id=p_crew and visibility='open' for update;
  if not found then return null; end if;
  perform public._see_again_lock_roster(p_crew);
  if not exists(select 1 from public.private_social_accounts where id=p_actor and profile_id=p_profile)
    or not public._see_again_participant(p_crew,p_actor) then return null; end if;
  select * into v_window from public._social_crew_attendance_window(p_crew);
  v_now:=clock_timestamp();
  if v_window.cancelled or v_window.closes_at is null or v_now<v_window.closes_at then return null; end if;
  -- Lock all unordered pairs in account-ID order, independent of alphabetical display.
  for candidate in select m.id,m.social_account_id,p.handle from public.social_crew_members m
    join public.private_social_accounts a on a.id=m.social_account_id join public.profiles p on p.id=a.profile_id
    where m.crew_id=p_crew and m.state='active' and m.social_account_id<>p_actor order by m.social_account_id
  loop
    perform public._see_again_pair_lock(p_actor,candidate.social_account_id);
    if not public._see_again_allowed(p_crew,p_actor,candidate.social_account_id) then continue; end if;
    select * into pair from public.social_crew_see_again_pairs where crew_id=p_crew and context='friendship'
      and low_account_id=least(p_actor,candidate.social_account_id) and high_account_id=greatest(p_actor,candidate.social_account_id);
    is_mutual:=coalesce(pair.state='mutual' and pair.expires_at>clock_timestamp()
      and pair.low_attendance_revision=(select revision from public._social_crew_attendance_current(p_crew,pair.low_account_id))
      and pair.high_attendance_revision=(select revision from public._social_crew_attendance_current(p_crew,pair.high_account_id)),false);
    if v_now>=v_window.closes_at+interval '72 hours' and not is_mutual then continue; end if;
    select choice into own_choice from public.social_crew_see_again_choices where pair_id=pair.id and picker_account_id=p_actor and expires_at>clock_timestamp();
    candidates:=candidates||jsonb_build_array(jsonb_build_object('memberId',candidate.id,'handle',candidate.handle,
      'choice',coalesce(own_choice,'none'),'mutual',is_mutual));
  end loop;
  if v_now>=v_window.closes_at+interval '72 hours' and jsonb_array_length(candidates)=0 then return null; end if;
  return jsonb_build_object('open',v_now<v_window.closes_at+interval '72 hours',
    'closesAt',to_char((v_window.closes_at+interval '72 hours') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'items',coalesce((select jsonb_agg(item order by lower(item->>'handle'),item->>'memberId') from jsonb_array_elements(candidates) item),'[]'::jsonb));
end;
$$;

-- Caller has the subject account lock, or the Crew row for a scoped removal.
-- Never take another account lock here. Invalidation must also survive unblock,
-- reinstatement and attendance correction back to attended.
create function public._see_again_invalidate(p_subject uuid,p_crew uuid default null,p_other uuid default null,p_authority boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare pair record;
begin
  if p_subject is null and p_crew is null then return; end if;
  for pair in select p.* from public.social_crew_see_again_pairs p join public.social_crews c on c.id=p.crew_id
    where (p_crew is null or p.crew_id=p_crew) and (
      ((p_subject is null or p.low_account_id=p_subject or p.high_account_id=p_subject)
        and (p_other is null or p.low_account_id=p_other or p.high_account_id=p_other))
      or (p_authority and ((c.owner_account_id=p_subject and (p_other is null or p.low_account_id=p_other or p.high_account_id=p_other))
        or (c.owner_account_id=p_other and (p.low_account_id=p_subject or p.high_account_id=p_subject)))))
      and p.state<>'closed' order by p.low_account_id,p.high_account_id,p.id
  loop
    perform public._see_again_pair_lock(pair.low_account_id,pair.high_account_id);
    if pair.choice_expires_at<=clock_timestamp() then
      delete from public.social_crew_see_again_pairs where id=pair.id;
    else
      update public.social_crew_see_again_pairs set state='closed',formed_at=null,expires_at=choice_expires_at,revision=revision+1
        where id=pair.id and revision=pair.revision;
    end if;
  end loop;
end;
$$;
create function public._see_again_safety_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
declare subject uuid; other_account uuid;
begin
  if tg_table_name='social_blocks' then
    select id into subject from public.private_social_accounts where profile_id=new.blocker_profile_id;
    select id into other_account from public.private_social_accounts where profile_id=new.blocked_profile_id;
    if subject is not null and other_account is not null then
      perform public._see_again_invalidate(subject,null,other_account,true);
    end if;
  elsif tg_table_name='social_mutes' then
    select id into subject from public.private_social_accounts where profile_id=new.muter_profile_id;
    select id into other_account from public.private_social_accounts where profile_id=new.muted_profile_id;
    if subject is not null and other_account is not null then
      perform public._see_again_invalidate(subject,null,other_account);
    end if;
  elsif tg_table_name='social_crew_attendance' then
    perform public._see_again_invalidate(new.subject_account_id,new.crew_id);
  elsif tg_table_name='social_crew_members' then
    -- The Crew lock excludes paired operations in this occurrence. Acquire no
    -- account here: case and seat writers can already hold later row locks.
    perform public._see_again_invalidate(old.social_account_id,old.crew_id,null,true);
  elsif tg_table_name='private_social_accounts' then
    if new.supabase_user_id is null then
      -- Auth deletion has already taken its subject account lock. No Crew lock.
      perform public._see_again_invalidate(new.id,null,null,true);
      delete from public.social_crew_see_again_pairs where low_account_id=new.id or high_account_id=new.id;
    elsif new.ownership_state<>'active' then perform public._see_again_invalidate(new.id,null,null,true); end if;
  elsif tg_table_name='social_crews' then
    perform public._see_again_invalidate(null,new.id);
  elsif tg_table_name='plans' then
    perform public._see_again_invalidate(null,(select id from public.social_crews where plan_id=new.id));
  end if;
  return null;
end;
$$;
create function public._see_again_lock_account_write() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform public._lock_social_participant_accounts(array[new.id]);
  return new;
end;
$$;
create function public._see_again_lock_mute() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform public._lock_social_participant_accounts(array(select id from public.private_social_accounts
    where profile_id in (new.muter_profile_id,new.muted_profile_id)));
  return new;
end;
$$;
create trigger see_again_lock_account before update of ownership_state,supabase_user_id on public.private_social_accounts
  for each row when (old.ownership_state is distinct from new.ownership_state
    or (old.supabase_user_id is not null and new.supabase_user_id is null))
  execute function public._see_again_lock_account_write();
create trigger see_again_account_invalidated after update of ownership_state,supabase_user_id on public.private_social_accounts
  for each row execute function public._see_again_safety_trigger();
create trigger see_again_block_invalidated after insert or update on public.social_blocks
  for each row execute function public._see_again_safety_trigger();
create trigger see_again_mute_lock before insert or update on public.social_mutes
  for each row execute function public._see_again_lock_mute();
create trigger see_again_mute_invalidated after insert or update on public.social_mutes
  for each row execute function public._see_again_safety_trigger();
create trigger see_again_attendance_invalidated after insert on public.social_crew_attendance
  for each row execute function public._see_again_safety_trigger();
create trigger see_again_member_invalidated after update of state,role on public.social_crew_members
  for each row when (old.state is distinct from new.state or old.role is distinct from new.role)
  execute function public._see_again_safety_trigger();

create trigger see_again_crew_hidden after update of visibility on public.social_crews
  for each row when (old.visibility is distinct from new.visibility and new.visibility<>'open')
  execute function public._see_again_safety_trigger();
create trigger see_again_plan_cancelled after update of status on public.plans
  for each row when (old.status is distinct from new.status and new.status='abandoned')
  execute function public._see_again_safety_trigger();

-- Own directional records only. No other person's pick, outcome, DOB or assertion.
create function public.export_social_crew_see_again(p_user uuid,p_limit integer) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(entry),'[]'::jsonb) from (
    select jsonb_build_object('crewId',choice.crew_id,'pickedMemberId',choice.picked_member_id,'context',choice.context,'choice',choice.choice,
      'chosenAt',choice.chosen_at,'withdrawnAt',choice.withdrawn_at) entry
    from public.social_crew_see_again_choices choice join public.social_crew_see_again_pairs pair on pair.id=choice.pair_id
    where choice.picker_user_id=p_user and choice.expires_at>clock_timestamp()
    order by choice.chosen_at,choice.pair_id limit greatest(0,least(coalesce(p_limit,0),1001))
  ) owned;
$$;

-- Exporting a visible connection is an authorised product read. Take the full
-- lock order for the selected Crew batch before reusing that guarded projection.
create function public.export_visible_crew_see_again(p_user uuid,p_limit integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; profile uuid; crews uuid[]; crew uuid; view jsonb; entry jsonb; result jsonb:='[]';
  bounded integer:=greatest(0,least(coalesce(p_limit,0),1001)); other uuid;
begin
  select id,profile_id into actor,profile from public.private_social_accounts
    where supabase_user_id=p_user and ownership_state='active';
  if actor is null or bounded=0 then return result; end if;
  crews:=array(select c.id from public.social_crews c where c.id in (
    select p.crew_id from public.social_crew_see_again_pairs p
    where (p.low_account_id=actor or p.high_account_id=actor) and p.state='mutual' and p.expires_at>clock_timestamp()
    order by p.crew_id,p.id limit bounded) order by c.id for update);
  perform 1 from auth.users u join public.private_social_accounts a on a.supabase_user_id=u.id
    join public.social_crew_members m on m.social_account_id=a.id
    where m.crew_id=any(crews) and m.state='active' order by u.id for key share of u;
  perform public._lock_social_participant_accounts(array(select m.social_account_id from public.social_crew_members m
    where m.crew_id=any(crews) and m.state='active'));
  -- With one fixed actor, account-ID order is canonical pair order across Crews.
  for other in select distinct m.social_account_id from public.social_crew_members m
    where m.crew_id=any(crews) and m.state='active' and m.social_account_id<>actor
    order by m.social_account_id loop
    perform public._see_again_pair_lock(actor,other);
  end loop;
  foreach crew in array crews loop
    view:=public.read_social_crew_see_again(actor,profile,crew);
    for entry in select item from jsonb_array_elements(coalesce(view->'items','[]')) item where (item->>'mutual')::boolean loop
      result:=result||jsonb_build_array(jsonb_build_object('crewId',crew,'memberId',entry->>'memberId','context','friendship'));
    end loop;
  end loop;
  return coalesce((select jsonb_agg(item) from (select item from jsonb_array_elements(result) item limit bounded) limited),'[]');
end;
$$;

create function public.purge_expired_social_crew_see_again(p_limit integer default 1000) returns jsonb
language plpgsql security definer set search_path='' as $$
declare pair record; deleted integer:=0; count_choices integer;
  bounded integer:=greatest(0,least(coalesce(p_limit,1000),1000)); ids uuid[]; crews uuid[];
begin
  -- Reserve at most three physical rows per pair, including cascading directions.
  ids:=array(select p.id from public.social_crew_see_again_pairs p
    where p.expires_at<=clock_timestamp() or exists(select 1 from public.social_crew_see_again_choices d
      where d.pair_id=p.id and d.expires_at<=clock_timestamp())
      or (p.state='mutual' and (not public._see_again_allowed(p.crew_id,p.low_account_id,p.high_account_id)
        or p.low_attendance_revision<>(select revision from public._social_crew_attendance_current(p.crew_id,p.low_account_id))
        or p.high_attendance_revision<>(select revision from public._social_crew_attendance_current(p.crew_id,p.high_account_id))))
    order by p.expires_at,p.id limit bounded/3);
  -- Acquire each lock class for the whole batch in one order across all Crews.
  crews:=array(select c.id from public.social_crews c where c.id in
    (select p.crew_id from public.social_crew_see_again_pairs p where p.id=any(ids)) order by c.id for update skip locked);
  ids:=array(select p.id from public.social_crew_see_again_pairs p where p.id=any(ids) and p.crew_id=any(crews));
  perform 1 from auth.users u where u.id in (
    select a.supabase_user_id from public.private_social_accounts a join public.social_crew_members m on m.social_account_id=a.id
      where m.crew_id=any(crews) and m.state='active'
    union select p.low_user_id from public.social_crew_see_again_pairs p where p.id=any(ids)
    union select p.high_user_id from public.social_crew_see_again_pairs p where p.id=any(ids))
    order by u.id for key share of u;
  perform public._lock_social_participant_accounts(array(select m.social_account_id from public.social_crew_members m
    where m.crew_id=any(crews) and m.state='active'
    union select p.low_account_id from public.social_crew_see_again_pairs p where p.id=any(ids)
    union select p.high_account_id from public.social_crew_see_again_pairs p where p.id=any(ids)));
  for pair in select * from public.social_crew_see_again_pairs where id=any(ids) order by low_account_id,high_account_id,id
  loop
    perform public._see_again_pair_lock(pair.low_account_id,pair.high_account_id);
    if pair.state='mutual' and (not public._see_again_allowed(pair.crew_id,pair.low_account_id,pair.high_account_id)
      or pair.low_attendance_revision<>(select revision from public._social_crew_attendance_current(pair.crew_id,pair.low_account_id))
      or pair.high_attendance_revision<>(select revision from public._social_crew_attendance_current(pair.crew_id,pair.high_account_id))) then
      select count(*) into count_choices from public.social_crew_see_again_choices where pair_id=pair.id;
      perform public._see_again_invalidate(pair.low_account_id,pair.crew_id,pair.high_account_id);
      if not exists(select 1 from public.social_crew_see_again_pairs where id=pair.id) then
        deleted:=deleted+1+count_choices;
        continue;
      end if;
    end if;
    if exists(select 1 from public.social_crew_see_again_pairs where id=pair.id and expires_at<=clock_timestamp()) then
      select count(*) into count_choices from public.social_crew_see_again_choices where pair_id=pair.id;
      delete from public.social_crew_see_again_pairs where id=pair.id;
      deleted:=deleted+1+count_choices;
    else
      delete from public.social_crew_see_again_choices where pair_id=pair.id and expires_at<=clock_timestamp();
      get diagnostics count_choices=row_count;
      deleted:=deleted+count_choices;
    end if;
  end loop;
  return jsonb_build_object('ok',true,'deleted',deleted);
end;
$$;

-- Supabase default privileges grant function EXECUTE broadly. Close every helper.
do $$
declare fn regprocedure;
begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname like '\_see\_again\_%' escape '\'
      or p.proname in ('write_social_crew_see_again','read_social_crew_see_again','export_social_crew_see_again','export_visible_crew_see_again','purge_expired_social_crew_see_again'))
  loop execute format('revoke all on function %s from public,anon,authenticated,service_role',fn); end loop;
end;
$$;
grant execute on function public.write_social_crew_see_again(uuid,uuid,uuid,uuid,text,text,boolean),
  public.read_social_crew_see_again(uuid,uuid,uuid),public.export_social_crew_see_again(uuid,integer),
  public.export_visible_crew_see_again(uuid,integer), public.purge_expired_social_crew_see_again(integer) to service_role;
commit;
