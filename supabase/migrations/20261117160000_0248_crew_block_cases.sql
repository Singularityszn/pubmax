-- 0248: a block between two accepted members of one crew opens a private moderator case.
--
-- 1. The night continues. The block changes no place, seat, roster revision or Plan, and
--    sends no notification. Guests and co-hosts keep the private Leave this crew. No
--    attendee and no host reads the case or learns of it.
-- 2. social_blocks_open_crew_cases fires after a block insert, or an update that moves a
--    block, and opens one case for each crew where both people hold an active place and
--    the night is neither cancelled nor past its close (start + 12 hours,
--    OPEN_CRAWL_ARRIVAL_CLOSE_MS). A case names the crew and who blocked whom. A crew
--    has at most one open case per pair, either way round: a repeat, a reverse block or
--    a moved block onto an open pair opens nothing new. A block after a decision opens a
--    new case. A deleted account (unbound) opens none.
-- 3. A case is live while _social_crew_block_case_live holds: both people hold their
--    places, a block still joins them either way, and the night is neither cancelled
--    nor closed. read_social_crew_block_cases_admin lists, oldest first, the open,
--    unexpired, live cases. Each names the two people, earlier accepted first, and says
--    whether each blocks the other now (_social_crew_block_case_blockers, the one rule for
--    who blocks whom); who opened the case is not shown. The queue and
--    the decision leave a moderator out through one rule,
--    _social_crew_block_case_moderator_conflicted: the moderator owns the crew, has any
--    member row in it in any role or state, has a pending request or invitation for it,
--    or is blocked either way with either person.
-- 4. decide_social_crew_block_case_admin: an active moderator with no such tie names the
--    blockers the queue showed (the member IDs with blocksOther) and, with a
--    3 to 500 character reason, keeps both places ('kept') or removes one of the two
--    people ('removed', never the owner), as a host removal does: that crew bars them,
--    their seat ends and the roster revision moves. From expiry every call answers
--    'expired'. A decided case answers 'unchanged' with its decision when the call
--    names the same decision and the same person, and 'already_decided' otherwise.
--    Under its locks an open case is checked by the live rule and the blockers again; a
--    case that is no longer live, or whose blockers differ from the named ones, answers
--    'stale' and changes nothing.
--    correct_social_crew_removal_admin (0245) lifts a mistaken removal.
-- 5. Lock order. 0245's social_blocks_lock_participant_accounts already holds both
--    people's account locks before the case opens. The case row carries no foreign key:
--    a key to the crew or to auth.users would take a crew row or an auth row after the
--    account locks, the reverse of admission and account deletion, and could close a
--    cycle. So a block takes no crew row and no auth row. A decision takes the crew row,
--    then both people's auth rows (KEY SHARE, in ID order), then the case row, then the
--    member row and seat, as a host removal does, and never an account lock. An account
--    deletion holds the auth row while it deletes the cases that name the account.
--    The live rule needs no account lock. Leave, host removal, admission and 0246 take
--    the crew row first, so a decision sees what they committed. A block takes the
--    account locks but no crew row. An unblock takes neither account nor crew locks
--    and never waits for a decision. A block between the same two people can wait for
--    a decision that closes their case, then follows it. The live rule and the blockers
--    are read in one statement, with its committed snapshot.
--    An overlapping block, unblock or standalone Plan cancellation unseen by that
--    snapshot follows the decision in serial order, even if it commits first. This is
--    a check of the named blockers against that snapshot, not a revision. Cancellation
--    and removal can share live-location row locks; neither order takes a participant
--    account lock.
-- 6. A case's expiry is fixed when it opens, 30 days after the planned close. Reads and
--    decisions deny it from expiry. An expired open case still holds its pair's open
--    slot until the cleanup deletes it; a later edit of the Plan's start moves neither.
--    purge_expired_social_crew_block_cases deletes at most 1,000 expired cases, and
--    cases whose crew is gone, per call. Nothing schedules it.
--    A case goes with either person's account deletion, in the same transaction, and
--    with its crew. A block that lands while its crew is deleted can leave a case with
--    no crew: no call reads it, and only that cleanup deletes it. The own-record export
--    does not include cases, as it includes no report about a person.
-- 7. No browser role and not the service role reads the table. Only the service role
--    runs the read, the decision and the cleanup (docs/CREW_REMOVAL_CORRECTION_RUNBOOK.md).
-- 8. Applying opens cases for blocks that already join two accepted members of a live
--    night.
--
-- Rollback drops the table, with every case and decision, and its triggers and functions.
-- It takes its locks without waiting and stops while cases exist unless the session sets
-- pubmax.crew_block_cases_discarded to the exact row count. Roll back 0248 before 0247,
-- 0246 and 0245. The 0245 rollback refuses while this table exists.
begin;

do $$
begin
  if not exists(select 1 from pg_catalog.pg_trigger
      where tgrelid='public.social_blocks'::regclass and tgname='social_blocks_lock_participant_accounts') then
    raise exception '0248 needs 0245: a block must take its participants'' account locks first';
  end if;
end;
$$;

-- An account deletion and a block both reach these tables. Take them in deletion's
-- order, and before any trigger is created, so no writer interleaves with the backfill.
-- These locks wait for busy writers and hold through backfill. Sign-ins and other
-- auth.users writes can wait until this transaction commits.
lock table auth.users, public.private_social_accounts, public.social_blocks, public.social_crews
  in share row exclusive mode;

create table public.social_crew_block_cases (
  id uuid primary key default gen_random_uuid(),
  -- No foreign keys: see item 5.
  crew_id uuid not null,
  blocker_account_id uuid not null,
  blocked_account_id uuid not null check (blocked_account_id <> blocker_account_id),
  opened_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decision text check (decision in ('kept','removed')),
  removed_member_id uuid,
  reason text check (char_length(reason) between 3 and 500),
  staff_role_id uuid,
  staff_display_name text check (char_length(staff_display_name) between 1 and 120),
  decided_at timestamptz,
  check ((decision is null and removed_member_id is null and reason is null and staff_role_id is null
      and staff_display_name is null and decided_at is null)
    or (decision is not null and reason is not null and staff_role_id is not null
      and staff_display_name is not null and decided_at is not null
      and (decision='removed') = (removed_member_id is not null)))
);
create unique index social_crew_block_cases_open_pair_idx on public.social_crew_block_cases
  (crew_id, least(blocker_account_id,blocked_account_id), greatest(blocker_account_id,blocked_account_id))
  where decided_at is null;
create index social_crew_block_cases_crew_idx on public.social_crew_block_cases (crew_id);
create index social_crew_block_cases_blocker_idx on public.social_crew_block_cases (blocker_account_id);
create index social_crew_block_cases_blocked_idx on public.social_crew_block_cases (blocked_account_id);
create index social_crew_block_cases_expires_idx on public.social_crew_block_cases (expires_at);
alter table public.social_crew_block_cases enable row level security;
revoke all on table public.social_crew_block_cases from public, anon, authenticated, service_role;

-- Item 2: the cases one block opens. The trigger runs after 0245's trigger took both
-- account locks, so each statement here reads the places that committed while they waited.
create function public._open_social_crew_block_cases_for(p_blocker_profile uuid,p_blocked_profile uuid)
returns void language sql security definer set search_path=''
as $$
  insert into public.social_crew_block_cases(crew_id,blocker_account_id,blocked_account_id,expires_at)
  select blocker_member.crew_id, blocker.id, blocked.id, plan.start_time + interval '12 hours' + interval '30 days'
  from public.private_social_accounts blocker
  join public.private_social_accounts blocked
    on blocked.profile_id=p_blocked_profile and blocked.supabase_user_id is not null
  join public.social_crew_members blocker_member
    on blocker_member.social_account_id=blocker.id and blocker_member.state='active'
  join public.social_crew_members blocked_member
    on blocked_member.crew_id=blocker_member.crew_id and blocked_member.social_account_id=blocked.id
      and blocked_member.state='active'
  join public.social_crews crew on crew.id=blocker_member.crew_id
  join public.plans plan on plan.id=crew.plan_id
  where blocker.profile_id=p_blocker_profile and blocker.supabase_user_id is not null
    and blocker.id<>blocked.id and plan.status<>'abandoned'
    and pg_catalog.statement_timestamp() < plan.start_time + interval '12 hours'
  on conflict (crew_id, least(blocker_account_id,blocked_account_id), greatest(blocker_account_id,blocked_account_id))
    where decided_at is null
  do nothing;
$$;

create function public._open_social_crew_block_cases()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  perform public._open_social_crew_block_cases_for(new.blocker_profile_id,new.blocked_profile_id);
  return null;
end;
$$;

create trigger social_blocks_open_crew_cases
after insert or update of blocker_profile_id, blocked_profile_id on public.social_blocks
for each row execute function public._open_social_crew_block_cases();

-- Only account deletion unbinds an account. Its cases go in the same transaction.
create function public._delete_social_crew_block_cases_on_unbind()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  delete from public.social_crew_block_cases where blocker_account_id=new.id or blocked_account_id=new.id;
  return new;
end;
$$;

create trigger social_account_unbind_deletes_crew_block_cases
after update of supabase_user_id on public.private_social_accounts
for each row when (old.supabase_user_id is not null and new.supabase_user_id is null)
execute function public._delete_social_crew_block_cases_on_unbind();

create function public._delete_social_crew_block_cases_with_crew()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  delete from public.social_crew_block_cases where crew_id=old.id;
  return old;
end;
$$;

create trigger social_crews_delete_block_cases
after delete on public.social_crews
for each row execute function public._delete_social_crew_block_cases_with_crew();

-- Items 3 and 4: the member IDs, in ID order, of those of the two people in the crew who
-- block the other now. The queue shows it as blocksOther, and a decision must name it.
create function public._social_crew_block_case_blockers(p_crew uuid,p_first uuid,p_second uuid)
returns uuid[] language sql stable security definer set search_path=''
as $$
  select coalesce(array_agg(member.id order by member.id), '{}')
  from public.social_crew_members member
  join public.private_social_accounts account on account.id=member.social_account_id
  join public.private_social_accounts other on other.id in (p_first,p_second) and other.id<>account.id
  where member.crew_id=p_crew and member.social_account_id in (p_first,p_second)
    and exists(select 1 from public.social_blocks social_block
      where social_block.blocker_profile_id=account.profile_id and social_block.blocked_profile_id=other.profile_id);
$$;

-- Item 3: a case stays live while both people hold their places, a block still joins
-- them either way, and the night is neither cancelled nor past its close.
create function public._social_crew_block_case_live(p_crew uuid,p_first uuid,p_second uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select exists(select 1 from public.social_crews crew
    join public.plans plan on plan.id=crew.plan_id
    where crew.id=p_crew and plan.status<>'abandoned'
      and pg_catalog.statement_timestamp() < plan.start_time + interval '12 hours'
      and 2=(select count(*) from public.social_crew_members member
        where member.crew_id=p_crew and member.state='active' and member.social_account_id in (p_first,p_second))
      and pg_catalog.cardinality(public._social_crew_block_case_blockers(p_crew,p_first,p_second))>0);
$$;

-- Item 3: true when this moderator profile owns the crew, has any member row in it (in
-- any role or state: roles change in place, so a former co-host looks like a guest), has
-- a pending request or invitation for it, or is blocked either way with either person.
create function public._social_crew_block_case_moderator_conflicted(
  p_staff_profile uuid,p_crew uuid,p_first uuid,p_second uuid
) returns boolean language sql stable security definer set search_path=''
as $$
  select exists(select 1 from public.private_social_accounts staff_account
      where staff_account.profile_id=p_staff_profile and (
        exists(select 1 from public.social_crews crew where crew.id=p_crew and crew.owner_account_id=staff_account.id)
        or exists(select 1 from public.social_crew_members insider
          where insider.crew_id=p_crew and insider.social_account_id=staff_account.id)
        or exists(select 1 from public.social_crew_join_requests asked
          where asked.crew_id=p_crew and asked.requester_account_id=staff_account.id and asked.state='pending')
        or exists(select 1 from public.social_crew_invitations invited
          where invited.crew_id=p_crew and invited.target_account_id=staff_account.id and invited.state='pending')))
    or exists(select 1 from public.private_social_accounts party
      join public.social_blocks social_block
        on (social_block.blocker_profile_id=p_staff_profile and social_block.blocked_profile_id=party.profile_id)
        or (social_block.blocker_profile_id=party.profile_id and social_block.blocked_profile_id=p_staff_profile)
      where party.id in (p_first,p_second));
$$;

create function public.read_social_crew_block_cases_admin(p_staff_role_id uuid,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_staff public.private_social_staff_roles;
begin
  if p_limit is null or p_limit<1 or p_limit>50 then raise exception 'invalid queue size'; end if;
  select * into v_staff from public.private_social_staff_roles
  where id=p_staff_role_id and active and revoked_at is null and role='moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  return coalesce((
    select jsonb_agg(item.entry order by item.opened_at, item.id)
    from (
      select block_case.id, block_case.opened_at, jsonb_build_object(
        'caseId', block_case.id,
        'openedAt', pg_catalog.to_char(block_case.opened_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'crewId', block_case.crew_id,
        'nightStartsAt', pg_catalog.to_char(plan.start_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'expiresAt', pg_catalog.to_char(block_case.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        -- The two people, earlier accepted first, and whether each blocks the other now.
        'people', (select jsonb_agg(jsonb_build_object('memberId', member.id, 'handle', profile.handle,
            'role', member.role,
            'joinedAt', pg_catalog.to_char(member.joined_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'blocksOther', member.id=any(blockers.ids))
            order by member.joined_at, member.id)
          from public.social_crew_members member
          join public.private_social_accounts account on account.id=member.social_account_id
          join public.profiles profile on profile.id=account.profile_id
          where member.crew_id=block_case.crew_id
            and member.social_account_id in (block_case.blocker_account_id,block_case.blocked_account_id))
      ) as entry
      from public.social_crew_block_cases block_case
      join public.social_crews crew on crew.id=block_case.crew_id
      join public.plans plan on plan.id=crew.plan_id
      cross join lateral (select public._social_crew_block_case_blockers(block_case.crew_id,
        block_case.blocker_account_id,block_case.blocked_account_id) as ids) blockers
      where block_case.decided_at is null and block_case.expires_at > pg_catalog.statement_timestamp()
        and public._social_crew_block_case_live(block_case.crew_id,block_case.blocker_account_id,block_case.blocked_account_id)
        and not public._social_crew_block_case_moderator_conflicted(v_staff.profile_id, block_case.crew_id,
          block_case.blocker_account_id, block_case.blocked_account_id)
      order by block_case.opened_at, block_case.id
      limit p_limit
    ) item
  ), '[]'::jsonb);
end;
$$;

-- p_seen_blockers: the member IDs that the queue showed with blocksOther, in any order.
create function public.decide_social_crew_block_case_admin(
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

create function public.purge_expired_social_crew_block_cases(p_limit integer default 1000)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_limit integer:=greatest(1,least(coalesce(p_limit,1000),1000)); v_deleted integer;
begin
  with doomed as (
    select block_case.id from public.social_crew_block_cases block_case
    where block_case.expires_at <= pg_catalog.statement_timestamp()
      or not exists(select 1 from public.social_crews crew where crew.id=block_case.crew_id)
    order by block_case.expires_at, block_case.id
    limit v_limit
    for update skip locked
  )
  delete from public.social_crew_block_cases block_case using doomed where block_case.id=doomed.id;
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('ok',true,'deleted',v_deleted);
end;
$$;

-- Item 8. The table locks above keep every block write out, so no account lock is needed.
do $$
begin
  perform public._open_social_crew_block_cases_for(blocker_profile_id,blocked_profile_id) from public.social_blocks;
end;
$$;

revoke all on function public._open_social_crew_block_cases_for(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public._open_social_crew_block_cases() from public, anon, authenticated, service_role;
revoke all on function public._delete_social_crew_block_cases_on_unbind() from public, anon, authenticated, service_role;
revoke all on function public._delete_social_crew_block_cases_with_crew() from public, anon, authenticated, service_role;
revoke all on function public._social_crew_block_case_moderator_conflicted(uuid,uuid,uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public._social_crew_block_case_live(uuid,uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public._social_crew_block_case_blockers(uuid,uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.read_social_crew_block_cases_admin(uuid,integer) from public, anon, authenticated;
revoke all on function public.decide_social_crew_block_case_admin(uuid,uuid,uuid[],text,uuid,text) from public, anon, authenticated;
revoke all on function public.purge_expired_social_crew_block_cases(integer) from public, anon, authenticated;
grant execute on function public.read_social_crew_block_cases_admin(uuid,integer) to service_role;
grant execute on function public.decide_social_crew_block_case_admin(uuid,uuid,uuid[],text,uuid,text) to service_role;
grant execute on function public.purge_expired_social_crew_block_cases(integer) to service_role;

commit;
