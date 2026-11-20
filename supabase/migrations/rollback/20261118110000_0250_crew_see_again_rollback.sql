-- Rollback 0250 destroys all private directions and pair tombstones/outcomes.
-- No data can be recovered. Stop application choice writers first. A non-empty
-- store requires pubmax.see_again_discarded equal to the combined exact row count.
begin;
lock table auth.users in share row exclusive mode;
lock table public.private_social_accounts,public.social_blocks,public.social_mutes,
  public.social_crews,public.social_crew_members,public.social_crew_attendance,public.plans,
  public.private_account_identities,public.adult_self_assertions,
  public.social_crew_see_again_pairs,public.social_crew_see_again_choices in share row exclusive mode nowait;
do $$
declare total bigint;
begin
  select (select count(*) from public.social_crew_see_again_pairs)+(select count(*) from public.social_crew_see_again_choices) into total;
  if total>0 and current_setting('pubmax.see_again_discarded',true) is distinct from total::text then
    raise exception '0250 rollback destroys % private records. Set pubmax.see_again_discarded to that exact count.',total;
  end if;
end;
$$;
-- Restore the exact 0248 moderator writer, before removing W6 invalidation.
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

-- Restore the exact pre-0250 membership and visibility writers.
create or replace function public.remove_social_crew_member_atomic(
  p_actor_account_id uuid,p_crew_id uuid,p_target_member_id uuid,p_idempotency_key text,p_payload_digest text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_replay jsonb; v_role text; v_target public.social_crew_members%rowtype; v_response jsonb;
begin
  v_replay:=public._social_crew_begin_write(p_actor_account_id,'remove-member',p_idempotency_key,p_payload_digest);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.social_crews where id=p_crew_id for update;
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
  if public._social_crew_member_role(p_crew_id,p_actor_account_id) is distinct from 'owner' then return public._social_crew_fail_write(p_actor_account_id,'transfer-owner',p_idempotency_key,p_payload_digest,'not_found'); end if;
  select * into v_target from public.social_crew_members where id=p_target_member_id and crew_id=p_crew_id and state='active' for update;
  if not found or v_target.role='owner' or public._social_crew_relationship_between_accounts(v_target.social_account_id,p_actor_account_id) is distinct from 'mutual'
    then return public._social_crew_fail_write(p_actor_account_id,'transfer-owner',p_idempotency_key,p_payload_digest,'not_found'); end if;
  select id into v_old from public.social_crew_members where crew_id=p_crew_id and social_account_id=p_actor_account_id and state='active' for update;
  update public.social_crew_members set role='cohost',updated_at=now() where id=v_old;
  update public.social_crew_members set role='owner',updated_at=now() where id=v_target.id;
  update public.social_crews set owner_account_id=v_target.social_account_id,authority_revision=authority_revision+1,updated_at=now() where id=p_crew_id;
  update public.plans set social_owner_account_id=v_target.social_account_id where id=v_plan;
  v_response:=jsonb_build_object('ok',true,'code','transferred','member_id',v_target.id);
  return public._social_crew_finish_write(p_actor_account_id,'transfer-owner',p_idempotency_key,p_payload_digest,v_response);
end;
$$;

drop trigger see_again_lock_account on public.private_social_accounts;
drop trigger see_again_account_invalidated on public.private_social_accounts;
drop trigger see_again_block_invalidated on public.social_blocks;
drop trigger see_again_mute_lock on public.social_mutes;
drop trigger see_again_mute_invalidated on public.social_mutes;
drop trigger see_again_attendance_invalidated on public.social_crew_attendance;
drop trigger see_again_crew_hidden on public.social_crews;
drop trigger see_again_plan_cancelled on public.plans;
drop trigger see_again_member_invalidated on public.social_crew_members;
drop function public.write_social_crew_see_again(uuid,uuid,uuid,uuid,text,text,boolean);
drop function public.export_visible_crew_see_again(uuid,integer);
drop function public.read_social_crew_see_again(uuid,uuid,uuid);
drop function public.export_social_crew_see_again(uuid,integer);
drop function public.purge_expired_social_crew_see_again(integer);
drop function public._see_again_safety_trigger();
drop function public._see_again_lock_account_write();
drop function public._see_again_lock_mute();
drop function public._see_again_invalidate(uuid,uuid,uuid,boolean);
drop function public._see_again_lock_roster(uuid);
drop function public._see_again_allowed(uuid,uuid,uuid);
drop function public._see_again_participant(uuid,uuid);
drop function public._see_again_crew_access(uuid,uuid);
drop function public._see_again_adult(uuid);
drop function public._see_again_pair_lock(uuid,uuid);
drop function public._see_again_next(text,text);
drop table public.social_crew_see_again_choices;
drop table public.social_crew_see_again_pairs;
commit;
