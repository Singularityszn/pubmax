-- 0248: a block between two accepted members of one crew opens a private moderator case.
--
-- 1. The night continues. The block changes no place, seat, roster revision or Plan, and
--    sends no notification. The blocker keeps the existing private Leave this crew. No
--    attendee and no host reads the case or learns of it.
-- 2. social_blocks_open_crew_cases fires after a block insert, or an update that moves a
--    block, and opens one case for each crew where both people hold an active place and
--    the night is neither cancelled nor past its close (start + 12 hours,
--    OPEN_CRAWL_ARRIVAL_CLOSE_MS). A case names the crew and who blocked whom. A crew
--    has at most one open case per pair, either way round: a repeat, a reverse block or
--    a moved block onto an open pair opens nothing new. A block after a decision opens a
--    new case. A deleted account (unbound) opens none.
-- 3. read_social_crew_block_cases_admin lists, oldest first, the open, unexpired cases
--    on a night that has not closed or been cancelled, where both people still hold
--    their places and a block still joins them. It leaves out every case of a crew the
--    moderator owns or holds any member row in, in any role or state.
-- 4. decide_social_crew_block_case_admin: an active moderator who was never in that crew,
--    with a 3 to 500 character reason, keeps both places ('kept') or removes one of the
--    two people ('removed', never the owner), as a host removal does: that crew bars
--    them, their seat ends and the roster revision moves. A decided case answers
--    'unchanged' with its decision. A person who no longer holds the place gets 'stale'.
--    correct_social_crew_removal_admin (0245) lifts a mistaken removal.
-- 5. Lock order. 0245's social_blocks_lock_participant_accounts already holds both
--    people's account locks before the case opens. The case row carries no foreign key:
--    a key to the crew or to auth.users would take a crew row or an auth row after the
--    account locks, the reverse of admission and account deletion, and could close a
--    cycle. So a block takes no crew row and no auth row. A decision takes the crew row,
--    then both people's auth rows (KEY SHARE, in ID order), then the case row, then the
--    member row and seat, as a host removal does, and never an account lock. An account
--    deletion holds the auth row while it deletes the cases that name the account.
-- 6. Retention, the 0247 rule: a case expires 30 days after the night's close. Reads and
--    decisions deny it from expiry. purge_expired_social_crew_block_cases deletes at most
--    1,000 expired cases, and cases whose crew is gone, per call. Nothing schedules it.
--    A case goes with either person's account deletion, in the same transaction, and
--    with its crew. The own-record export does not include cases, as it includes no
--    report about a person.
-- 7. No browser role and not the service role reads the table. Only the service role
--    runs the read, the decision and the cleanup (docs/CREW_REMOVAL_CORRECTION_RUNBOOK.md).
-- 8. Applying opens cases for blocks that already join two accepted members of a live
--    night.
--
-- Rollback drops the table, with every case and decision, and its triggers and functions.
-- It stops while cases exist unless the session sets pubmax.crew_block_cases_discarded
-- to the exact row count. Roll back 0248 before 0247, 0246 and 0245.
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

-- True when this moderator profile owns the crew or has any member row in it, in any
-- role or state. Roles change in place, so a former co-host looks like a guest.
create function public._social_crew_block_case_moderator_conflicted(p_staff_profile uuid,p_crew uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select exists(select 1 from public.private_social_accounts staff_account
    where staff_account.profile_id=p_staff_profile and (
      exists(select 1 from public.social_crews crew where crew.id=p_crew and crew.owner_account_id=staff_account.id)
      or exists(select 1 from public.social_crew_members insider
        where insider.crew_id=p_crew and insider.social_account_id=staff_account.id)));
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
        'blocker', jsonb_build_object('memberId', blocker_member.id, 'handle', blocker_profile.handle,
          'role', blocker_member.role,
          'joinedAt', pg_catalog.to_char(blocker_member.joined_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
        'blocked', jsonb_build_object('memberId', blocked_member.id, 'handle', blocked_profile.handle,
          'role', blocked_member.role,
          'joinedAt', pg_catalog.to_char(blocked_member.joined_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      ) as entry
      from public.social_crew_block_cases block_case
      join public.social_crews crew on crew.id=block_case.crew_id
      join public.plans plan on plan.id=crew.plan_id
      join public.social_crew_members blocker_member on blocker_member.crew_id=block_case.crew_id
        and blocker_member.social_account_id=block_case.blocker_account_id and blocker_member.state='active'
      join public.social_crew_members blocked_member on blocked_member.crew_id=block_case.crew_id
        and blocked_member.social_account_id=block_case.blocked_account_id and blocked_member.state='active'
      join public.private_social_accounts blocker on blocker.id=block_case.blocker_account_id
      join public.profiles blocker_profile on blocker_profile.id=blocker.profile_id
      join public.private_social_accounts blocked on blocked.id=block_case.blocked_account_id
      join public.profiles blocked_profile on blocked_profile.id=blocked.profile_id
      where block_case.decided_at is null and block_case.expires_at > pg_catalog.statement_timestamp()
        and plan.status<>'abandoned' and pg_catalog.statement_timestamp() < plan.start_time + interval '12 hours'
        and exists(select 1 from public.social_blocks social_block
          where (social_block.blocker_profile_id=blocker.profile_id and social_block.blocked_profile_id=blocked.profile_id)
             or (social_block.blocker_profile_id=blocked.profile_id and social_block.blocked_profile_id=blocker.profile_id))
        and not public._social_crew_block_case_moderator_conflicted(v_staff.profile_id, block_case.crew_id)
      order by block_case.opened_at, block_case.id
      limit p_limit
    ) item
  ), '[]'::jsonb);
end;
$$;

create function public.decide_social_crew_block_case_admin(
  p_staff_role_id uuid,p_case_id uuid,p_decision text,p_member_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_staff public.private_social_staff_roles; v_case public.social_crew_block_cases;
  v_member public.social_crew_members; v_reason text:=btrim(coalesce(p_reason,''));
begin
  select * into v_staff from public.private_social_staff_roles
  where id=p_staff_role_id and active and revoked_at is null and role='moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  if p_decision is null or p_decision not in ('kept','removed') or char_length(v_reason) not between 3 and 500
    or (p_decision='removed') <> (p_member_id is not null) then
    return jsonb_build_object('ok',false,'code','invalid'); end if;
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
  if public._social_crew_block_case_moderator_conflicted(v_staff.profile_id,v_case.crew_id) then
    return jsonb_build_object('ok',false,'code','forbidden'); end if;
  if v_case.decided_at is not null then
    return jsonb_build_object('ok',true,'code','unchanged','decision',v_case.decision); end if;
  if v_case.expires_at <= pg_catalog.statement_timestamp() then
    return jsonb_build_object('ok',false,'code','expired'); end if;
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
revoke all on function public._social_crew_block_case_moderator_conflicted(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.read_social_crew_block_cases_admin(uuid,integer) from public, anon, authenticated;
revoke all on function public.decide_social_crew_block_case_admin(uuid,uuid,text,uuid,text) from public, anon, authenticated;
revoke all on function public.purge_expired_social_crew_block_cases(integer) from public, anon, authenticated;
grant execute on function public.read_social_crew_block_cases_admin(uuid,integer) to service_role;
grant execute on function public.decide_social_crew_block_case_admin(uuid,uuid,text,uuid,text) to service_role;
grant execute on function public.purge_expired_social_crew_block_cases(integer) to service_role;

commit;
