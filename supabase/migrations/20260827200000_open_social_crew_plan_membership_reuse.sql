-- Open Crew acceptance and direct Plan invite acceptance must converge on one
-- account-owned Plan seat. Reuse a seat already stamped with the Supabase user
-- before creating a Social-only seat.

-- Old activation could create a Social-only seat after the same account had
-- already joined through a Plan invite. Do not guess which row owns child
-- history. Stop with exact identifiers so an operator can reconcile it first.
do $$
declare
  split_membership record;
begin
  select crew.plan_id,
         social_member.social_account_id,
         social_member.id as social_plan_member_id,
         account_member.id as account_plan_member_id
    into split_membership
  from public.social_crew_members crew_member
  join public.social_crews crew on crew.id=crew_member.crew_id
  join public.plan_crew_members social_member
    on social_member.id=crew_member.plan_member_id
   and social_member.plan_id=crew.plan_id
  join public.private_social_accounts account
    on account.id=crew_member.social_account_id
   and account.supabase_user_id is not null
  join public.plan_crew_members account_member
    on account_member.plan_id=crew.plan_id
   and account_member.user_id=account.supabase_user_id
   and account_member.id<>social_member.id
  order by crew.plan_id,crew_member.social_account_id
  limit 1;

  if found then
    raise exception using
      errcode='check_violation',
      message=format(
        'split Social and account Plan membership: plan_id=%s social_account_id=%s',
        split_membership.plan_id,
        split_membership.social_account_id
      ),
      detail=format(
        'Social seat %s and account seat %s both carry authority. No rows were changed.',
        split_membership.social_plan_member_id,
        split_membership.account_plan_member_id
      ),
      hint='Reconcile child references into one Plan member before rerunning this migration.';
  end if;
end;
$$;

create or replace function public._activate_social_crew_member(p_crew uuid,p_account uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare
  v_member public.social_crew_members%rowtype;
  v_plan uuid;
  v_handle text;
  v_user uuid;
  v_plan_member public.plan_crew_members%rowtype;
begin
  select crew.plan_id,profile.handle,account.supabase_user_id
    into v_plan,v_handle,v_user
  from public.social_crews crew
  join public.private_social_accounts account
    on account.id=p_account and account.ownership_state='active'
  join public.profiles profile on profile.id=account.profile_id
  where crew.id=p_crew;
  if v_plan is null then return null; end if;

  if v_user is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('plan:join-account:' || v_plan::text || ':' || v_user::text,0)
    );
  end if;

  select * into v_member
  from public.social_crew_members
  where crew_id=p_crew and social_account_id=p_account
  for update;

  if found then
    select * into v_plan_member
    from public.plan_crew_members
    where id=v_member.plan_member_id and plan_id=v_plan
    for update;
    if not found
      or (v_plan_member.social_account_id is not null and v_plan_member.social_account_id<>p_account)
      or (v_user is not null and v_plan_member.user_id is not null and v_plan_member.user_id<>v_user)
      or (v_user is not null and exists(
        select 1 from public.plan_crew_members other
        where other.plan_id=v_plan and other.user_id=v_user and other.id<>v_plan_member.id
      )) then
      return null;
    end if;
    update public.plan_crew_members
    set social_account_id=p_account,
        user_id=coalesce(user_id,v_user),
        status='in',
        can_collaborate=true,
        updated_at=now()
    where id=v_plan_member.id;
    if v_member.state<>'active' then
      if (select count(*) from public.social_crew_members where crew_id=p_crew and state='active')>=20 then
        return null;
      end if;
      update public.social_crew_members
      set state='active',role='member',ended_at=null,updated_at=now()
      where id=v_member.id;
      update public.social_crews
      set authority_revision=authority_revision+1,updated_at=now()
      where id=p_crew;
    end if;
    return v_member.id;
  end if;

  if (select count(*) from public.social_crew_members where crew_id=p_crew and state='active')>=20 then
    return null;
  end if;

  if v_user is not null then
    select * into v_plan_member
    from public.plan_crew_members
    where plan_id=v_plan and user_id=v_user
    for update;
  end if;
  if not found then
    select * into v_plan_member
    from public.plan_crew_members
    where plan_id=v_plan and social_account_id=p_account
    for update;
  end if;

  if found then
    if (v_plan_member.social_account_id is not null and v_plan_member.social_account_id<>p_account)
      or (v_user is not null and v_plan_member.user_id is not null and v_plan_member.user_id<>v_user) then
      return null;
    end if;
    update public.plan_crew_members
    set social_account_id=p_account,
        user_id=coalesce(user_id,v_user),
        status='in',
        can_collaborate=true,
        updated_at=now()
    where id=v_plan_member.id
    returning * into v_plan_member;
  else
    v_plan_member.id:=gen_random_uuid();
    perform pg_catalog.set_config('pubmax.social_crew_write','1',true);
    insert into public.plan_crew_members(
      id,plan_id,name,token_hash,status,user_id,joined_at,updated_at,can_collaborate,social_account_id
    ) values(
      v_plan_member.id,v_plan,v_handle,
      encode(extensions.digest(gen_random_uuid()::text || clock_timestamp()::text,'sha256'),'hex'),
      'in',v_user,now(),now(),true,p_account
    );
  end if;

  insert into public.social_crew_members(crew_id,social_account_id,plan_member_id,role,state)
  values(p_crew,p_account,v_plan_member.id,'member','active')
  returning * into v_member;
  update public.social_crews
  set authority_revision=authority_revision+1,updated_at=now()
  where id=p_crew;
  return v_member.id;
end;
$$;
