-- A Crew seat can remain active after its Social account is suspended by
-- account deletion. Capture only live account identities at completion time.
create or replace function pubmax_private.snapshot_plan_completion_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- DELETE locks the auth row before its snapshot erasure trigger runs. Wait
  -- for that transaction before taking the capture query's READ COMMITTED
  -- snapshot; if capture wins, deletion later erases the committed snapshot.
  -- Stable id order avoids cycles when a completion has several identities.
  perform 1
  from auth.users identity_user
  where identity_user.id in (
    select member.user_id
    from public.plan_crew_members member
    where member.plan_id = new.plan_id
      and member.user_id is not null
    union
    select social_account.supabase_user_id
    from public.plan_crew_members member
    join public.private_social_accounts social_account
      on social_account.id = member.social_account_id
    where member.plan_id = new.plan_id
      and social_account.supabase_user_id is not null
  )
  order by identity_user.id
  for key share of identity_user;

  insert into pubmax_private.plan_completion_group_snapshots
    (completion_id, plan_id, completed_at, account_keys)
  select new.id, new.plan_id, new.completed_at,
    coalesce(array_agg(distinct identity.account_key order by identity.account_key)
      filter (where identity.account_key is not null), '{}'::text[])
  from public.plan_crew_members member
  left join public.private_social_accounts linked
    on linked.supabase_user_id = member.user_id
    and linked.ownership_state = 'active'
  left join public.private_social_accounts social_account
    on social_account.id = member.social_account_id
    and social_account.ownership_state = 'active'
  left join auth.users classic_identity
    on classic_identity.id = member.user_id
  cross join lateral (select case
    when member.social_account_id is not null and social_account.id is not null
      then 'social:' || social_account.id::text
    when member.social_account_id is null and linked.id is not null
      and classic_identity.id is not null
      then 'social:' || linked.id::text
    when member.social_account_id is null and classic_identity.id is not null
      then 'auth:' || classic_identity.id::text
  end as account_key) identity
  where member.plan_id = new.plan_id
    and member.membership_revoked_at is null
    and member.joined_at <= new.completed_at
    and (member.social_account_id is null or exists (
      select 1 from public.social_crew_members social_member
      join public.social_crews crew on crew.id = social_member.crew_id
      where crew.plan_id = new.plan_id
        and social_member.plan_member_id = member.id
        and social_member.social_account_id = member.social_account_id
        and social_member.state = 'active'
    ));
  return new;
end;
$$;
