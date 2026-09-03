-- Restore 0128's index predicate and 0127's claim body exactly.
--
-- Rolling back re-admits the defect this migration closes: a revoked row will
-- again hold an account's seat for the life of the Plan, and the claim RPC will
-- again count seats that are not there. That is the point of a rollback, but it
-- is worth stating so nobody reads it as neutral.
--
-- Deploy order for the rollback is the mirror of the forward one: the app half
-- must be back on the revoked-aware linkPlanMemberUser body BEFORE this runs,
-- or the app will be calling an RPC that has stopped reading the column again.

begin;

-- THIS ROLLBACK IS NOT ALWAYS POSSIBLE, and it says so rather than dying on a
-- constraint violation.
--
-- Once the narrowed index has allowed an account to hold a REVOKED seat and an
-- ACTIVE seat in the same Plan, those two rows collide under 0128's wider
-- predicate and the index cannot be rebuilt. Proven on PostgreSQL 16: without
-- this guard the rollback aborts with `Key (plan_id, user_id)=(...) is
-- duplicated` and leaves the narrowed index in place, which is a confusing way
-- to learn that the data has moved past the point of return.
--
-- So stop first, with the exact identifiers, in the same fail-loud idiom 0131
-- uses for split Social and account membership. An operator decides what to do
-- with those rows; a rollback may not decide it for them by deleting a seat.
do $$
declare
  colliding record;
begin
  select plan_id,
         user_id,
         count(*) as seats
    into colliding
  from public.plan_crew_members
  where user_id is not null
  group by plan_id, user_id
  having count(*) > 1
  order by plan_id, user_id
  limit 1;

  if found then
    raise exception using
      errcode = 'check_violation',
      message = format(
        'cannot restore the wider unique index: plan_id=%s user_id=%s holds %s seats',
        colliding.plan_id, colliding.user_id, colliding.seats
      ),
      detail = 'The narrowed index allowed a revoked seat and an active seat for one account in one Plan. 0128 permits only one row per (plan_id, user_id) whatever its revoked state.',
      hint = 'Reconcile those rows into one membership before rolling back, or stay on 0135.';
  end if;
end;
$$;

drop index if exists public.plan_crew_members_plan_user_unique_idx;

create unique index if not exists plan_crew_members_plan_user_unique_idx
  on public.plan_crew_members(plan_id, user_id)
  where user_id is not null;

create or replace function public.claim_plan_membership(
  p_plan_id uuid,
  p_member_id uuid,
  p_user_id uuid
) returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_user_id uuid;
  v_member_user_id uuid;
  v_host_member_id uuid;
begin
  select owner_user_id
    into v_owner_user_id
  from public.plans
  where id = p_plan_id
    and social_owner_account_id is null
  for update;
  if not found then return 'not_found'; end if;

  select user_id
    into v_member_user_id
  from public.plan_crew_members
  where id = p_member_id
    and plan_id = p_plan_id
  for update;
  if not found then return 'not_found'; end if;

  select id
    into v_host_member_id
  from public.plan_crew_members
  where plan_id = p_plan_id
  order by joined_at, id
  limit 1;

  if exists (
    select 1
    from public.plan_crew_members
    where plan_id = p_plan_id
      and id <> p_member_id
      and user_id = p_user_id
  ) then
    return 'conflict';
  end if;

  if v_member_user_id is not null and v_member_user_id <> p_user_id then
    return 'conflict';
  end if;
  if p_member_id = v_host_member_id
     and v_owner_user_id is not null
     and v_owner_user_id <> p_user_id then
    return 'conflict';
  end if;

  if v_member_user_id = p_user_id
     and (p_member_id <> v_host_member_id or v_owner_user_id = p_user_id) then
    return 'already_claimed';
  end if;

  update public.plan_crew_members
  set user_id = p_user_id,
      updated_at = now()
  where id = p_member_id
    and plan_id = p_plan_id;

  if p_member_id = v_host_member_id then
    update public.plans
    set owner_user_id = p_user_id
    where id = p_plan_id;
  end if;

  return 'claimed';
end;
$$;

commit;
