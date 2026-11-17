-- 0243: crew admission and invitation refuse blocked and removed people, under
-- participant-account locks that blocks, suspension and account deletion share.
--
-- 1. _lock_social_participant_accounts takes one transaction advisory lock per
--    participant account, in account-ID order. A later pair lock comes after these.
-- 2. _social_crew_admission_ineligible is the one read-only rule: the person is not
--    active, this crew removed them, or a block in either direction joins them to
--    any accepted member. _social_crew_admission_refused takes the account locks of
--    every accepted member and the person, then asks that rule in a new statement.
--    A crew holds at most 20 accepted members (capacity 4 to 20, default 20), so one
--    admission takes at most 21 account locks.
-- 3. A join request, a join decision, an invitation and an invitation acceptance
--    answer not_found, the answer an unknown crew gets, when the rule refuses. A
--    decision also rechecks, after the locks, that its actor is still an active
--    owner or cohost. The host queue hides a request the rule refuses and takes no
--    lock. A requester cancels their own pending request with no relationship check.
--    Declining an invitation takes no admission check.
-- 4. Lock order. An admission or invitation locks the crew row, then the account
--    locks. A block insert, or an update that moves a block, takes the account locks
--    of every person it names. A suspension takes the account lock after its
--    supabase user lock and before the profile and account rows. Account deletion
--    takes the account lock in the first BEFORE DELETE trigger on auth.users, before
--    0198's tombstone writes the account and profile rows. No crew row is locked
--    after an account lock, so these writes cannot wait on each other in a circle.
-- 5. auth.users DELETE locks the auth row before any trigger runs. An approval that
--    creates a new plan seat for its requester checks that row through the
--    plan_crew_members foreign key while it holds the requester's account lock.
--    When that requester deletes their account at that same moment, PostgreSQL
--    reports a deadlock and rolls back one of the two. Nothing is half done, and
--    either caller can retry. Before 0243 the same race failed the approval on the
--    foreign key instead.
-- 6. A block between two accepted members changes no membership and pauses nothing.
--
-- Removal bars that one crew. It is not a suspension, and no moderator correction
-- path for a mistaken removal exists yet. Rollback restores the 0110, 0114, 0075
-- and 0224 function bodies and drops the triggers and helpers.
begin;

create function public._lock_social_participant_accounts(p_accounts uuid[])
returns void language plpgsql security definer set search_path=''
as $$
declare v_account uuid;
begin
  for v_account in
    select distinct listed.account from unnest(p_accounts) as listed(account)
    where listed.account is not null order by listed.account
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('social-account:' || v_account::text, 0));
  end loop;
end;
$$;

create function public._social_crew_admission_ineligible(p_crew uuid,p_account uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select not exists(
      select 1 from public.private_social_accounts
      where id=p_account and ownership_state='active')
    or exists(
      select 1 from public.social_crew_members
      where crew_id=p_crew and social_account_id=p_account and state='removed')
    or exists(
      select 1
      from public.private_social_accounts candidate
      join public.social_crew_members member
        on member.crew_id=p_crew and member.state='active' and member.social_account_id<>candidate.id
      join public.private_social_accounts other on other.id=member.social_account_id
      join public.social_blocks block
        on (block.blocker_profile_id=candidate.profile_id and block.blocked_profile_id=other.profile_id)
        or (block.blocker_profile_id=other.profile_id and block.blocked_profile_id=candidate.profile_id)
      where candidate.id=p_account);
$$;

-- The caller holds the crew row lock, so the accepted roster cannot change here.
create function public._social_crew_admission_refused(p_crew uuid,p_account uuid)
returns boolean language plpgsql security definer set search_path=''
as $$
begin
  perform public._lock_social_participant_accounts(array(
    select member.social_account_id from public.social_crew_members member
    where member.crew_id=p_crew and member.state='active'
  ) || p_account);
  return public._social_crew_admission_ineligible(p_crew,p_account);
end;
$$;

create function public._lock_social_block_participants()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  perform public._lock_social_participant_accounts(array(
    select account.id from public.private_social_accounts account
    where account.profile_id in (new.blocker_profile_id,new.blocked_profile_id)
      or (tg_op='UPDATE' and account.profile_id in (old.blocker_profile_id,old.blocked_profile_id))
  ));
  return new;
end;
$$;

create trigger social_blocks_lock_participant_accounts
before insert or update of blocker_profile_id, blocked_profile_id on public.social_blocks
for each row execute function public._lock_social_block_participants();

-- Named to fire before profiles_tombstone_on_auth_user_delete: BEFORE triggers run
-- in name order, so the account lock comes before the tombstone's row writes.
create function public._lock_social_auth_user_accounts()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  perform public._lock_social_participant_accounts(array(
    select account.id from public.private_social_accounts account
    where account.supabase_user_id=old.id
  ));
  return old;
end;
$$;

create trigger lock_social_accounts_on_auth_user_delete
before delete on auth.users
for each row execute function public._lock_social_auth_user_accounts();

create or replace function public.request_social_crew_join_atomic(
  p_actor_account_id uuid,p_crew_id uuid,p_action text,p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_replay jsonb; v_owner uuid; v_visibility text; v_rel text; v_expiry timestamptz;
  v_request public.social_crew_join_requests%rowtype;
  v_id uuid:=gen_random_uuid(); v_response jsonb;
begin
  v_replay:=public._social_crew_begin_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.social_crews where id=p_crew_id for update;
  select owner_account_id, visibility into v_owner, v_visibility from public.social_crews where id=p_crew_id;
  if v_owner is null then
    return public._social_crew_fail_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,'not_found'); end if;
  if p_action='cancelled' then
    select * into v_request from public.social_crew_join_requests
      where crew_id=p_crew_id and requester_account_id=p_actor_account_id and state='pending' for update;
    if not found then return public._social_crew_fail_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,'not_found'); end if;
    update public.social_crew_join_requests set state='cancelled',decided_at=now() where id=v_request.id;
    v_response:=jsonb_build_object('ok',true,'code','cancelled','request_id',v_request.id);
  elsif p_action='pending' then
    v_rel:=public._social_crew_relationship_between_accounts(p_actor_account_id,v_owner);
    if (v_visibility='open' and v_rel is not distinct from 'blocked')
      or (v_visibility<>'open' and v_rel is distinct from 'mutual') then
      return public._social_crew_fail_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,'not_found'); end if;
    v_expiry:=public._social_crew_plan_expiry(p_crew_id);
    if v_expiry is null or v_expiry<=now() then return public._social_crew_fail_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,'invalid'); end if;
    update public.social_crew_join_requests set state='expired',decided_at=now()
      where crew_id=p_crew_id and requester_account_id=p_actor_account_id and state='pending' and now()>=expires_at;
    if exists(select 1 from public.social_crew_members
      where crew_id=p_crew_id and social_account_id=p_actor_account_id and state='active') then
      return public._social_crew_fail_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,'already_member'); end if;
    if exists(select 1 from public.social_crew_join_requests
      where crew_id=p_crew_id and requester_account_id=p_actor_account_id and state='pending') then
      return public._social_crew_fail_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,'already_pending'); end if;
    if public._social_crew_admission_refused(p_crew_id,p_actor_account_id) then
      return public._social_crew_fail_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,'not_found'); end if;
    insert into public.social_crew_join_requests(id,crew_id,requester_account_id,expires_at)
      values(v_id,p_crew_id,p_actor_account_id,v_expiry);
    v_response:=jsonb_build_object('ok',true,'code','requested','request_id',v_id);
  else return public._social_crew_fail_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,'invalid'); end if;
  return public._social_crew_finish_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,v_response);
end;
$$;

create or replace function public.decide_social_crew_join_request_atomic(
  p_actor_account_id uuid,p_crew_id uuid,p_request_id uuid,p_decision text,p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_operation text:='join-decision:'||p_crew_id::text; v_replay jsonb;
  v_request public.social_crew_join_requests%rowtype; v_role text; v_decider uuid; v_owner uuid;
  v_visibility text; v_rel text; v_member uuid; v_response jsonb;
begin
  v_replay:=public._social_crew_begin_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.social_crews where id=p_crew_id for update;
  if not found then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
  select * into v_request from public.social_crew_join_requests
    where id=p_request_id and crew_id=p_crew_id for update;
  if not found then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
  v_role:=public._social_crew_member_role(p_crew_id,p_actor_account_id);
  if v_role is null or v_role not in ('owner','cohost') then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
  if v_request.state<>'pending' then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'already_decided'); end if;
  if now()>=v_request.expires_at then
    update public.social_crew_join_requests set state='expired',decided_at=now() where id=v_request.id;
    return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'expired'); end if;
  select id into v_decider from public.social_crew_members where crew_id=p_crew_id and social_account_id=p_actor_account_id and state='active';
  if p_decision='accepted' then
    select owner_account_id, visibility into v_owner, v_visibility from public.social_crews where id=p_crew_id;
    v_rel:=public._social_crew_relationship_between_accounts(v_request.requester_account_id,v_owner);
    if v_visibility = 'open' then
      if v_rel is distinct from 'blocked' then
        null;
      else
        return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found');
      end if;
    elsif v_rel is distinct from 'mutual' then
      return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found');
    end if;
    if public._social_crew_admission_refused(p_crew_id,v_request.requester_account_id) then
      return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
    -- A new statement, so it reads what committed while the account locks waited.
    if not exists(select 1 from public.private_social_accounts where id=p_actor_account_id and ownership_state='active')
      or coalesce(public._social_crew_member_role(p_crew_id,p_actor_account_id),'') not in ('owner','cohost') then
      return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
    v_member:=public._activate_social_crew_member(p_crew_id,v_request.requester_account_id);
    if v_member is null then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'full'); end if;
    v_response:=jsonb_build_object('ok',true,'code','accepted','member_id',v_member);
  elsif p_decision='declined' then v_response:=jsonb_build_object('ok',true,'code','declined');
  else return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'invalid'); end if;
  update public.social_crew_join_requests set state=p_decision,decided_at=now(),decided_by_member_id=v_decider where id=v_request.id;
  return public._social_crew_finish_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,v_response);
end;
$$;

create or replace function public.invite_social_crew_member_atomic(
  p_actor_account_id uuid,p_crew_id uuid,p_target_profile_id uuid,
  p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_replay jsonb; v_role text; v_target uuid; v_owner uuid; v_expiry timestamptz;
  v_id uuid:=gen_random_uuid(); v_inviter uuid; v_response jsonb;
begin
  v_replay:=public._social_crew_begin_write(p_actor_account_id,'invite',p_idempotency_key,p_payload_digest);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.social_crews where id=p_crew_id for update;
  v_role:=public._social_crew_member_role(p_crew_id,p_actor_account_id);
  if v_role is null or v_role not in ('owner','cohost') then return public._social_crew_fail_write(p_actor_account_id,'invite',p_idempotency_key,p_payload_digest,'not_found'); end if;
  select account.id into v_target from public.private_social_accounts account
    where account.profile_id=p_target_profile_id and account.ownership_state='active';
  select owner_account_id into v_owner from public.social_crews where id=p_crew_id;
  if v_target is null or v_target=v_owner or public._social_crew_relationship_between_accounts(v_target,v_owner) is distinct from 'mutual'
    then return public._social_crew_fail_write(p_actor_account_id,'invite',p_idempotency_key,p_payload_digest,'not_found'); end if;
  v_expiry:=public._social_crew_plan_expiry(p_crew_id);
  if v_expiry is null or v_expiry<=now() then return public._social_crew_fail_write(p_actor_account_id,'invite',p_idempotency_key,p_payload_digest,'invalid'); end if;
  update public.social_crew_invitations set state='expired',decided_at=now()
    where crew_id=p_crew_id and target_account_id=v_target and state='pending' and now()>=expires_at;
  if exists(select 1 from public.social_crew_members where crew_id=p_crew_id and social_account_id=v_target and state='active') then
    return public._social_crew_fail_write(p_actor_account_id,'invite',p_idempotency_key,p_payload_digest,'already_member'); end if;
  if exists(select 1 from public.social_crew_invitations
    where crew_id=p_crew_id and target_account_id=v_target and state='pending') then
    return public._social_crew_fail_write(p_actor_account_id,'invite',p_idempotency_key,p_payload_digest,'already_pending'); end if;
  if public._social_crew_admission_refused(p_crew_id,v_target) then
    return public._social_crew_fail_write(p_actor_account_id,'invite',p_idempotency_key,p_payload_digest,'not_found'); end if;
  if not exists(select 1 from public.private_social_accounts where id=p_actor_account_id and ownership_state='active')
    or coalesce(public._social_crew_member_role(p_crew_id,p_actor_account_id),'') not in ('owner','cohost') then
    return public._social_crew_fail_write(p_actor_account_id,'invite',p_idempotency_key,p_payload_digest,'not_found'); end if;
  select id into v_inviter from public.social_crew_members where crew_id=p_crew_id and social_account_id=p_actor_account_id and state='active';
  insert into public.social_crew_invitations(id,crew_id,target_account_id,invited_by_member_id,expires_at)
    values(v_id,p_crew_id,v_target,v_inviter,v_expiry);
  v_response:=jsonb_build_object('ok',true,'code','invited','invitation_id',v_id);
  return public._social_crew_finish_write(p_actor_account_id,'invite',p_idempotency_key,p_payload_digest,v_response);
end;
$$;

create or replace function public.accept_social_crew_invitation_atomic(
  p_actor_account_id uuid,p_crew_id uuid,p_invitation_id uuid,p_action text,
  p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_operation text:='invitation-action:'||p_crew_id::text; v_replay jsonb;
  v_row public.social_crew_invitations%rowtype; v_owner uuid; v_member uuid; v_response jsonb;
begin
  v_replay:=public._social_crew_begin_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.social_crews where id=p_crew_id for update;
  if not found then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
  select * into v_row from public.social_crew_invitations
    where id=p_invitation_id and crew_id=p_crew_id for update;
  if not found or v_row.target_account_id<>p_actor_account_id then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
  if v_row.state<>'pending' then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'already_decided'); end if;
  if now()>=v_row.expires_at then
    update public.social_crew_invitations set state='expired',decided_at=now() where id=v_row.id;
    return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'expired');
  end if;
  if p_action='declined' then
    update public.social_crew_invitations set state='declined',decided_at=now() where id=v_row.id;
    v_response:=jsonb_build_object('ok',true,'code','declined');
  elsif p_action='accepted' then
    select owner_account_id into v_owner from public.social_crews where id=p_crew_id;
    if public._social_crew_relationship_between_accounts(p_actor_account_id,v_owner) is distinct from 'mutual' then
      return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
    if public._social_crew_admission_refused(p_crew_id,p_actor_account_id) then
      return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'not_found'); end if;
    v_member:=public._activate_social_crew_member(p_crew_id,p_actor_account_id);
    if v_member is null then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'full'); end if;
    update public.social_crew_invitations set state='accepted',decided_at=now() where id=v_row.id;
    v_response:=jsonb_build_object('ok',true,'code','accepted','member_id',v_member);
  else return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'invalid'); end if;
  return public._social_crew_finish_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,v_response);
end;
$$;

create or replace function public.read_social_crew_join_requests(
  p_viewer_account_id uuid,
  p_viewer_profile_id uuid,
  p_crew_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select account.id
    from public.private_social_accounts account
    join public.profiles profile on profile.id = account.profile_id
    where account.id = p_viewer_account_id
      and account.profile_id = p_viewer_profile_id
      and account.ownership_state = 'active'
  ),
  manager as (
    select crew.id as crew_id, crew.owner_account_id
    from actor
    join public.social_crews crew on crew.id = p_crew_id
    join public.plans plan
      on plan.id = crew.plan_id
      and plan.social_owner_account_id = crew.owner_account_id
    join public.private_social_accounts owner_account
      on owner_account.id = crew.owner_account_id
      and owner_account.ownership_state = 'active'
    join public.social_crew_members owner_member
      on owner_member.crew_id = crew.id
      and owner_member.social_account_id = crew.owner_account_id
      and owner_member.role = 'owner'
      and owner_member.state = 'active'
    join public.plan_crew_members owner_plan_member
      on owner_plan_member.id = owner_member.plan_member_id
      and owner_plan_member.plan_id = crew.plan_id
      and owner_plan_member.social_account_id = crew.owner_account_id
    join public.social_crew_members member
      on member.crew_id = crew.id
      and member.social_account_id = actor.id
      and member.state = 'active'
    join public.plan_crew_members plan_member
      on plan_member.id = member.plan_member_id
      and plan_member.plan_id = crew.plan_id
      and plan_member.social_account_id = actor.id
    where public._social_crew_member_role(p_crew_id, actor.id)
      in ('owner','cohost')
      and crew.visibility = 'open'
  )
  select jsonb_build_object(
    'items',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'requestId', pending.id,
          'requesterHandle', pending.handle
        ) order by pending.created_at, pending.id
      )
      from (
        select request.id, profile.handle,
          request.created_at, request.expires_at
        from public.social_crew_join_requests request
        join public.private_social_accounts account
          on account.id = request.requester_account_id
          and account.ownership_state = 'active'
        join public.profiles profile on profile.id = account.profile_id
        where request.crew_id = manager.crew_id
          and request.state = 'pending'
          and request.expires_at > statement_timestamp()
          and public._social_crew_relationship_between_accounts(
            request.requester_account_id,
            manager.owner_account_id
          ) is distinct from 'blocked'
          and not public._social_crew_admission_ineligible(request.crew_id, request.requester_account_id)
          and not exists (
            select 1
            from public.social_crew_members active_member
            where active_member.crew_id = request.crew_id
              and active_member.social_account_id = request.requester_account_id
              and active_member.state = 'active'
          )
        order by request.created_at, request.id
        limit 50
      ) pending
    ), '[]'::jsonb),
    'hasMore', exists(
      select 1
      from public.social_crew_join_requests request
      join public.private_social_accounts account
        on account.id = request.requester_account_id
        and account.ownership_state = 'active'
      where request.crew_id = manager.crew_id
        and request.state = 'pending'
        and request.expires_at > statement_timestamp()
        and public._social_crew_relationship_between_accounts(
          request.requester_account_id,
          manager.owner_account_id
        ) is distinct from 'blocked'
        and not public._social_crew_admission_ineligible(request.crew_id, request.requester_account_id)
        and not exists (
          select 1
          from public.social_crew_members active_member
          where active_member.crew_id = request.crew_id
            and active_member.social_account_id = request.requester_account_id
            and active_member.state = 'active'
        )
      order by request.created_at, request.id
      offset 50
      limit 1
    )
  )
  from manager;
$$;

create or replace function public.set_social_account_suspension_admin(
  p_staff_role_id uuid,
  p_profile_id uuid,
  p_action text,
  p_reason text,
  p_report_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff public.private_social_staff_roles;
  v_account public.private_social_accounts;
  v_profile public.profiles;
  v_user uuid;
  v_created boolean := false;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_next text;
  v_audit uuid;
begin
  select * into v_staff from public.private_social_staff_roles
  where id = p_staff_role_id and active and revoked_at is null and role = 'moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  if p_action is null or p_action not in ('suspend', 'reinstate') or char_length(v_reason) not between 3 and 500 then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if p_report_id is not null and not exists (
    select 1 from public.social_content_reports where id = p_report_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  select user_id into v_user from public.profiles where id = p_profile_id;
  if v_user is not null then
    perform pg_advisory_xact_lock(hashtextextended('supabase:' || v_user::text, 0));
  end if;
  perform public._lock_social_participant_accounts(array(
    select account.id from public.private_social_accounts account where account.profile_id = p_profile_id
  ));
  select * into v_profile from public.profiles where id = p_profile_id for update;
  if v_profile.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_profile.user_id is distinct from v_user then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  select * into v_account from public.private_social_accounts
  where profile_id = p_profile_id
  for update;
  if v_account.id is null and p_action = 'suspend' and v_profile.user_id is not null then
    insert into public.private_social_accounts(clerk_user_id, supabase_user_id, profile_id, ownership_state)
    values ('supabase:' || v_profile.user_id::text, v_profile.user_id, v_profile.id, 'suspended')
    returning * into v_account;
    v_created := true;
  end if;
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  -- Account deletion also leaves 'suspended' with no auth user. That account
  -- has gone; it is never reinstated and never suspended a second time.
  if v_account.supabase_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'gone');
  end if;
  v_next := case when p_action = 'suspend' then 'suspended' else 'active' end;
  if not v_created and v_account.ownership_state = v_next then
    return jsonb_build_object('ok', true, 'code', 'unchanged', 'state', v_next);
  end if;
  if not v_created then
    update public.private_social_accounts
    set ownership_state = v_next, ownership_changed_at = now(), updated_at = now()
    where id = v_account.id;
  end if;
  insert into public.social_account_moderation_audit(
    social_account_id, profile_handle, action, reason, staff_role_id, staff_display_name, report_id
  ) values (
    v_account.id, v_profile.handle, p_action, v_reason, v_staff.id, v_staff.display_name, p_report_id
  ) returning id into v_audit;
  return jsonb_build_object('ok', true, 'code', case when p_action = 'suspend' then 'suspended' else 'reinstated' end,
    'state', v_next, 'auditId', v_audit);
end;
$$;

revoke all on function public._lock_social_participant_accounts(uuid[]) from public, anon, authenticated;
revoke all on function public._social_crew_admission_refused(uuid,uuid) from public, anon, authenticated;
revoke all on function public._lock_social_block_participants() from public, anon, authenticated;
revoke all on function public._social_crew_admission_ineligible(uuid,uuid) from public, anon, authenticated;
revoke all on function public._lock_social_auth_user_accounts() from public, anon, authenticated;

commit;
