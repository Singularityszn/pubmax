-- 0249: one independent moderator cancels one reviewed Crew occurrence.
-- Only the service role can call this operation. A block never calls it.
-- The caller supplies the Crew authority revision and Plan status they reviewed.
-- The first cancellation keeps its reason and moderator snapshot with Crew history.
-- Rollback removes the operation but retains that audit and all completed effects.
begin;

-- Retained on rollback so reapplying restores the operation without losing history.
create table if not exists public.social_crew_occurrence_cancellations (
  crew_id uuid primary key references public.social_crews(id) on delete cascade,
  prior_authority_revision bigint not null check (prior_authority_revision >= 1),
  prior_status text not null check (prior_status in ('draft','ready','active','ending')),
  reason text not null check (char_length(reason) between 3 and 500),
  staff_role_id uuid not null,
  staff_display_name text not null check (char_length(staff_display_name) between 1 and 120),
  cancelled_at timestamptz not null default statement_timestamp()
);
alter table public.social_crew_occurrence_cancellations enable row level security;
revoke all on table public.social_crew_occurrence_cancellations from public, anon, authenticated, service_role;
grant select on table public.social_crew_occurrence_cancellations to service_role;

create function public.cancel_social_crew_occurrence_admin(
  p_staff_role_id uuid,p_crew_id uuid,p_expected_revision bigint,p_expected_status text,p_reason text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_staff public.private_social_staff_roles; v_crew public.social_crews;
  v_plan public.plans; v_saved public.social_crew_occurrence_cancellations;
  v_reason text:=btrim(coalesce(p_reason,'')); v_accounts uuid[]; v_staff_profile uuid;
begin
  select * into v_staff from public.private_social_staff_roles
  where id=p_staff_role_id and active and revoked_at is null and role='moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  v_staff_profile:=v_staff.profile_id;
  if char_length(v_reason) not between 3 and 500 or p_expected_revision is null or p_expected_revision<1
    or p_expected_status is null or p_expected_status not in ('draft','ready','active','ending') then
    return jsonb_build_object('ok',false,'code','invalid'); end if;
  select * into v_crew from public.social_crews where id=p_crew_id for update;
  if not found then return jsonb_build_object('ok',false,'code','not_found'); end if;

  -- Admission, attendance and case decisions hold the Crew row first. Deletion
  -- holds auth before account, Plan and seat rows. Include the original Plan owner,
  -- who can differ from the current Crew owner after an ownership transfer.
  select array_agg(distinct account_id) into v_accounts from (
    select social_account_id as account_id from public.social_crew_members where crew_id=p_crew_id
    union select owner_account_id from public.social_crews where id=p_crew_id
    union select id from public.private_social_accounts where profile_id=v_staff_profile
  ) people;
  perform 1 from auth.users auth_user
  where auth_user.id in (
    select supabase_user_id from public.private_social_accounts where id=any(v_accounts)
    union select owner_user_id from public.plans where id=v_crew.plan_id
    union select user_id from public.profiles where id=v_staff_profile
  ) order by auth_user.id for key share;
  perform public._lock_social_participant_accounts(v_accounts);

  -- Recheck authority after every wait. SHARE also serialises role revocation.
  select * into v_staff from public.private_social_staff_roles
  where id=p_staff_role_id and profile_id=v_staff_profile and active and revoked_at is null and role='moderator'
  for share;
  if v_staff.id is null or not exists(select 1 from public.profiles
      where id=v_staff_profile and tombstoned_at is null)
    or exists(select 1 from public.private_social_accounts where profile_id=v_staff_profile
      and (ownership_state<>'active' or supabase_user_id is null)) then raise exception 'staff required'; end if;

  -- Any past or current member, owner, pending applicant/invitee, or moderator
  -- blocked either way with a member must use another moderator. The refusal
  -- matches a missing occurrence and carries no participant or block information.
  if exists(select 1 from public.private_social_accounts staff_account where staff_account.profile_id=v_staff_profile
      and (staff_account.id=v_crew.owner_account_id
        or exists(select 1 from public.social_crew_members where crew_id=p_crew_id and social_account_id=staff_account.id)
        or exists(select 1 from public.social_crew_join_requests where crew_id=p_crew_id
          and requester_account_id=staff_account.id and state='pending')
        or exists(select 1 from public.social_crew_invitations where crew_id=p_crew_id
          and target_account_id=staff_account.id and state='pending')))
    or exists(select 1 from public.social_crew_members member
      join public.private_social_accounts party on party.id=member.social_account_id
      join public.social_blocks block
        on (block.blocker_profile_id=v_staff_profile and block.blocked_profile_id=party.profile_id)
        or (block.blocked_profile_id=v_staff_profile and block.blocker_profile_id=party.profile_id)
      where member.crew_id=p_crew_id) then return jsonb_build_object('ok',false,'code','not_found'); end if;

  select * into v_plan from public.plans where id=v_crew.plan_id for update;
  if not found or v_plan.social_owner_account_id is distinct from v_crew.owner_account_id then
    return jsonb_build_object('ok',false,'code','not_found'); end if;
  select * into v_saved from public.social_crew_occurrence_cancellations where crew_id=p_crew_id;
  if v_saved.crew_id is not null then
    if v_plan.status='abandoned' and v_saved.staff_role_id=p_staff_role_id and v_saved.reason=v_reason
      and v_saved.prior_authority_revision=p_expected_revision and v_saved.prior_status=p_expected_status then
      return jsonb_build_object('ok',true,'code','unchanged'); end if;
    return jsonb_build_object('ok',false,'code','stale'); end if;
  if v_plan.status in ('completed','abandoned')
    or pg_catalog.statement_timestamp() >= v_plan.start_time + interval '12 hours' then
    return jsonb_build_object('ok',false,'code','closed'); end if;
  if v_crew.authority_revision<>p_expected_revision or v_plan.status<>p_expected_status then
    return jsonb_build_object('ok',false,'code','stale'); end if;

  -- Existing Plan-end triggers clear live positions, stop markers and beacons.
  -- No membership, attendance, report or case history is removed.
  update public.plans set status='abandoned'
  where id=v_plan.id and status=p_expected_status and status in ('draft','ready','active','ending');
  if not found then return jsonb_build_object('ok',false,'code','stale'); end if;
  update public.social_crew_join_requests set state='expired',decided_at=now()
  where crew_id=p_crew_id and state='pending';
  update public.social_crew_invitations set state='expired',decided_at=now()
  where crew_id=p_crew_id and state='pending';
  update public.social_crews set authority_revision=authority_revision+1,updated_at=now() where id=p_crew_id;
  insert into public.social_crew_occurrence_cancellations(
    crew_id,prior_authority_revision,prior_status,reason,staff_role_id,staff_display_name
  ) values(p_crew_id,p_expected_revision,p_expected_status,v_reason,v_staff.id,v_staff.display_name);
  return jsonb_build_object('ok',true,'code','cancelled');
end;
$$;
revoke all on function public.cancel_social_crew_occurrence_admin(uuid,uuid,bigint,text,text) from public, anon, authenticated;
grant execute on function public.cancel_social_crew_occurrence_admin(uuid,uuid,bigint,text,text) to service_role;
commit;
