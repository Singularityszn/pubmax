-- Restores the exact 0245 writers. This restores their cached-authority race:
-- a revoked moderator can finish a write after waiting. Existing data, audits,
-- grants and committed moderation effects remain. No record is deleted.

begin;

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
    perform 1 from auth.users where id = v_user for key share;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'gone');
    end if;
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

create or replace function public.correct_social_crew_removal_admin(
  p_staff_role_id uuid,p_crew_id uuid,p_member_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_staff public.private_social_staff_roles; v_member public.social_crew_members;
  v_reason text:=btrim(coalesce(p_reason,'')); v_audit uuid; v_subject uuid;
begin
  select * into v_staff from public.private_social_staff_roles
  where id=p_staff_role_id and active and revoked_at is null and role='moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  if char_length(v_reason) not between 3 and 500 then
    return jsonb_build_object('ok',false,'code','invalid'); end if;
  perform 1 from public.social_crews where id=p_crew_id for update;
  if not found then return jsonb_build_object('ok',false,'code','not_found'); end if;
  select * into v_member from public.social_crew_members
  where id=p_member_id and crew_id=p_crew_id for update;
  if v_member.id is null then return jsonb_build_object('ok',false,'code','not_found'); end if;
  -- The subject's auth row before the account lock, as admission does. A deletion in
  -- flight makes this wait, and then the subject is gone.
  select account.supabase_user_id into v_subject from public.private_social_accounts account
  where account.id=v_member.social_account_id;
  if v_subject is null then return jsonb_build_object('ok',false,'code','gone'); end if;
  perform 1 from auth.users where id=v_subject for key share;
  if not found then return jsonb_build_object('ok',false,'code','gone'); end if;
  perform public._lock_social_participant_accounts(array[v_member.social_account_id]);
  if exists(select 1 from public.private_social_accounts
    where id=v_member.social_account_id and profile_id=v_staff.profile_id) then
    return jsonb_build_object('ok',false,'code','forbidden'); end if;
  if v_member.state<>'removed' then
    return jsonb_build_object('ok',true,'code','unchanged','state',v_member.state); end if;
  update public.social_crew_members set state='left',updated_at=now() where id=v_member.id;
  update public.social_crews set authority_revision=authority_revision+1,updated_at=now() where id=p_crew_id;
  insert into public.social_crew_removal_corrections(
    crew_id,subject_user_id,member_id,social_account_id,reason,staff_role_id,staff_display_name
  ) values (
    p_crew_id,v_subject,v_member.id,v_member.social_account_id,v_reason,v_staff.id,v_staff.display_name
  ) returning id into v_audit;
  return jsonb_build_object('ok',true,'code','corrected','state','left','auditId',v_audit);
end;
$$;

commit;
