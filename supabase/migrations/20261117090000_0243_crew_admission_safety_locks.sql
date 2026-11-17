-- 0243: crew admission refuses blocked and removed people, under participant-account locks.
--
-- 1. _lock_social_participant_accounts takes one transaction advisory lock per
--    participant account, in account-ID order. A later pair lock comes after these.
-- 2. Lock order. An admission locks the crew row, then the account locks. A block
--    or suspension write takes its account locks before any profile or account row
--    lock and never locks a crew. So no write waits for a lock that its waiter holds.
-- 3. A join request, a join decision and an invitation acceptance refuse, under those
--    locks, a person who is not active, whom this crew removed, or who has a block in
--    either direction with any accepted member. The answer is not_found, the same
--    answer an unknown crew gets. Cancelling a request never runs this check.
-- 4. A block insert takes the account locks of both people. It changes no membership:
--    a block between two accepted members leaves both places and the night as they are.
-- 5. A suspension takes the account lock before it locks the profile and account rows.
--
-- Removal bars that one crew. It is not a suspension. Rollback restores the 0110, 0075
-- and 0224 function bodies and drops the trigger and both helpers.
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

-- The caller holds the crew row lock, so the accepted roster cannot change here.
create function public._social_crew_admission_refused(p_crew uuid,p_account uuid)
returns boolean language plpgsql security definer set search_path=''
as $$
begin
  perform public._lock_social_participant_accounts(array(
    select member.social_account_id from public.social_crew_members member
    where member.crew_id=p_crew and member.state='active'
  ) || p_account);
  return not exists(
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
end;
$$;

create function public._lock_social_block_participants()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  perform public._lock_social_participant_accounts(array(
    select account.id from public.private_social_accounts account
    where account.profile_id in (new.blocker_profile_id,new.blocked_profile_id)
  ));
  return new;
end;
$$;

create trigger social_blocks_lock_participant_accounts
before insert on public.social_blocks
for each row execute function public._lock_social_block_participants();

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
    v_member:=public._activate_social_crew_member(p_crew_id,v_request.requester_account_id);
    if v_member is null then return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'full'); end if;
    v_response:=jsonb_build_object('ok',true,'code','accepted','member_id',v_member);
  elsif p_decision='declined' then v_response:=jsonb_build_object('ok',true,'code','declined');
  else return public._social_crew_fail_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,'invalid'); end if;
  update public.social_crew_join_requests set state=p_decision,decided_at=now(),decided_by_member_id=v_decider where id=v_request.id;
  return public._social_crew_finish_write(p_actor_account_id,v_operation,p_idempotency_key,p_payload_digest,v_response);
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

commit;
