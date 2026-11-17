-- Rollback 0243: crew admission and invitation check only the host pair again, and
-- block, suspension, provisioning and account deletion writes stop taking the auth
-- row and participant-account locks in one order.
-- It restores the 0110 join request and decision bodies, the 0075 invitation and
-- invitation acceptance bodies, the 0114 host queue body, the 0092 provisioning body
-- and the 0224 suspension body, then drops the social_blocks trigger, the helpers, the removal
-- correction function and its ledger.
-- Rollback discloses nothing, but it removes protections. A removed person can request
-- that crew again, the host queue shows requests that acceptance refuses, and a
-- requester whom the host has since blocked cannot cancel their own request again.
--
-- THE auth.users TRIGGER STAYS. The migration role does not own auth.users, so it
-- cannot drop a trigger there. The rollback makes the trigger function return at once.
--
-- THE LEDGER IS NOT DROPPED SILENTLY. Before anything else, the rollback locks
-- social_crew_removal_corrections against new corrections and counts its rows. When
-- there are rows, the rollback stops unless the session first ran
-- set pubmax.crew_removal_corrections_exported = '<that exact row count>';
-- A correction that commits a row while the rollback waits for that lock changes the
-- count, so an export taken before it no longer matches and the rollback stops.

begin;

-- Locks. auth.users comes first, while this rollback holds nothing, so waiting for it
-- cannot close a cycle: a correction, admission, deletion or plan join that holds an
-- auth row finishes first. Every other lock is then taken without waiting. When one
-- is busy, the rollback stops at once with "could not obtain lock" and releases
-- auth.users; run it again. Sign-ins and Social writes wait while it runs.
lock table auth.users in access exclusive mode;
lock table public.social_crews, public.social_crew_members, public.social_crew_join_requests,
  public.social_crew_invitations, public.plan_crew_members, public.social_blocks,
  public.private_social_accounts in access exclusive mode nowait;

do $$
declare v_rows bigint := 0;
begin
  if to_regclass('public.social_crew_removal_corrections') is not null then
    -- Held until commit, so no correction can add a row between this count and the drop.
    lock table public.social_crew_removal_corrections in access exclusive mode nowait;
    select count(*) into v_rows from public.social_crew_removal_corrections;
  end if;
  if v_rows > 0
    and coalesce(current_setting('pubmax.crew_removal_corrections_exported', true), '') <> v_rows::text then
    raise exception 'Rollback 0243 would drop % crew removal corrections. Export social_crew_removal_corrections, then set pubmax.crew_removal_corrections_exported to that row count and run it again.', v_rows;
  end if;
end;
$$;

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
  v_rel:=public._social_crew_relationship_between_accounts(p_actor_account_id,v_owner);
  if v_owner is null then
    return public._social_crew_fail_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,'not_found'); end if;
  if v_visibility = 'open' then
    if v_rel is distinct from 'blocked' then
      null;
    else
      return public._social_crew_fail_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,'not_found');
    end if;
  elsif v_rel is distinct from 'mutual' then
    return public._social_crew_fail_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,'not_found');
  end if;
  if p_action='cancelled' then
    select * into v_request from public.social_crew_join_requests
      where crew_id=p_crew_id and requester_account_id=p_actor_account_id and state='pending' for update;
    if not found then return public._social_crew_fail_write(p_actor_account_id,'join-request',p_idempotency_key,p_payload_digest,'not_found'); end if;
    update public.social_crew_join_requests set state='cancelled',decided_at=now() where id=v_request.id;
    v_response:=jsonb_build_object('ok',true,'code','cancelled','request_id',v_request.id);
  elsif p_action='pending' then
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

create or replace function public.provision_social_product_account(
  p_supabase_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_account public.private_social_accounts%rowtype;
  v_clerk_placeholder text := 'supabase:' || p_supabase_user_id::text;
begin
  if p_supabase_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('supabase:' || p_supabase_user_id::text, 0)
  );

  select * into v_profile
    from public.profiles
   where user_id = p_supabase_user_id
   limit 1
   for update;

  if not found
     or v_profile.handle is null
     or char_length(trim(v_profile.handle)) = 0 then
    return jsonb_build_object('ok', false, 'code', 'profile_not_claimed');
  end if;

  select * into v_account
    from public.private_social_accounts
   where supabase_user_id = p_supabase_user_id
      or profile_id = v_profile.id
   order by id
   limit 1
   for update;

  if v_account.id is not null then
    if v_account.profile_id <> v_profile.id then
      return jsonb_build_object('ok', false, 'code', 'ownership_conflict');
    end if;
    if v_account.supabase_user_id is not null
       and v_account.supabase_user_id <> p_supabase_user_id then
      return jsonb_build_object('ok', false, 'code', 'ownership_conflict');
    end if;
    if v_account.supabase_user_id is null then
      update public.private_social_accounts
         set supabase_user_id = p_supabase_user_id,
             updated_at = now(),
             ownership_changed_at = now()
       where id = v_account.id;
    end if;
    return jsonb_build_object(
      'ok', true,
      'product_account_id', v_account.id,
      'provisioned', false
    );
  end if;

  insert into public.private_social_accounts (
    clerk_user_id,
    supabase_user_id,
    profile_id
  ) values (
    v_clerk_placeholder,
    p_supabase_user_id,
    v_profile.id
  ) returning * into v_account;

  return jsonb_build_object(
    'ok', true,
    'product_account_id', v_account.id,
    'provisioned', true
  );
exception when unique_violation then
  return jsonb_build_object('ok', false, 'code', 'ownership_conflict');
end;
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

-- The migration role does not own auth.users, so it cannot drop this trigger. The
-- trigger stays and its function, which this role owns, takes no lock any more.
create or replace function public._lock_social_auth_user_accounts()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  return old;
end;
$$;
drop trigger if exists social_blocks_lock_participant_accounts on public.social_blocks;
-- Receipts deleted while 0243 was applied stay deleted. A rollback cannot restore them.
drop trigger if exists social_account_unbind_purges_crew_receipts on public.private_social_accounts;
drop function if exists public._purge_social_crew_receipts_on_unbind();
create or replace function public._social_crew_finish_write(
  p_actor uuid, p_operation text, p_key text, p_digest text, p_response jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.private_social_crew_write_receipts(
    actor_account_id,operation,idempotency_key,payload_digest,response
  ) values(p_actor,p_operation,p_key,p_digest,p_response);
  return p_response;
end;
$$;

drop function if exists public._lock_social_block_participants();
drop function if exists public._social_crew_admission_refused(uuid,uuid);
drop function if exists public._social_crew_admission_ineligible(uuid,uuid);
drop function if exists public._lock_social_participant_accounts(uuid[]);
alter table public.social_crew_members
  drop constraint social_crew_members_plan_member_id_fkey,
  add constraint social_crew_members_plan_member_id_fkey
    foreign key (plan_member_id) references public.plan_crew_members(id) on delete restrict;
-- The ledger goes last. The lock taken at the top still holds it.
drop function if exists public.correct_social_crew_removal_admin(uuid,uuid,uuid,text);
drop table if exists public.social_crew_removal_corrections;

commit;
