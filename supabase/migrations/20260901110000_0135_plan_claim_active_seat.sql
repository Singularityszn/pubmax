-- A REVOKED seat is not a seat.
--
-- Issue #1294: production's claim_plan_membership predates #1270's
-- membership_revoked_at column and does not read it, so the app side was held
-- to the older revoked-aware body in linkPlanMemberUser rather than swapping to
-- this RPC. This migration is what unblocks that swap.
--
-- TWO things move together, and neither works alone. The RPC's own checks are
-- taught the column, AND 0128's unique index is narrowed to match. Without the
-- index change the function would decide a claim is allowed and then take a
-- unique_violation from a revoked row still holding (plan_id, user_id); without
-- the function change the index would allow a claim the function still refuses.
--
-- Semantics follow 0134, which already treats `membership_revoked_at is null`
-- as what ACTIVE means, so all three lanes now agree on one definition.

begin;

-- 1. The seat an account holds is its ACTIVE seat.
--
-- 0128 made this partial on `user_id is not null` alone, so a revoked row went
-- on occupying the account's seat for the life of the Plan and no later claim,
-- join or redeem could ever bind that account again. A predicate cannot be
-- added in place, so the index is replaced.
drop index if exists public.plan_crew_members_plan_user_unique_idx;

create unique index if not exists plan_crew_members_plan_user_unique_idx
  on public.plan_crew_members(plan_id, user_id)
  where user_id is not null and membership_revoked_at is null;

-- 2. The claim RPC reads the same column.
--
-- Three lanes change, and each was a different way of counting a seat that is
-- not there:
--   * the member being claimed must itself be active, so claiming a revoked
--     seat answers `not_found`. The row exists, but the seat does not, and
--     `not_found` is already the vocabulary for that;
--   * the host is the first ACTIVE member, so a revoked first member no longer
--     makes every later claimant look like the host;
--   * the one-account-one-seat check counts ACTIVE seats only, which is the
--     defect this issue opened with: an account whose earlier seat was revoked
--     could never claim another one.
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
    and membership_revoked_at is null
  for update;
  if not found then return 'not_found'; end if;

  select id
    into v_host_member_id
  from public.plan_crew_members
  where plan_id = p_plan_id
    and membership_revoked_at is null
  order by joined_at, id
  limit 1;

  if exists (
    select 1
    from public.plan_crew_members
    where plan_id = p_plan_id
      and id <> p_member_id
      and user_id = p_user_id
      and membership_revoked_at is null
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
    and plan_id = p_plan_id
    and membership_revoked_at is null;

  if p_member_id = v_host_member_id then
    update public.plans
    set owner_user_id = p_user_id
    where id = p_plan_id;
  end if;

  return 'claimed';
end;
$$;

commit;
