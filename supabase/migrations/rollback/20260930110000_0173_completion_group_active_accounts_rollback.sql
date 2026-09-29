-- Cost: restores the 0169 capture rule, so a later completion may include a
-- suspended Social member whose Crew seat remains active.
create or replace function pubmax_private.snapshot_plan_completion_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into pubmax_private.plan_completion_group_snapshots
    (completion_id, plan_id, completed_at, account_keys)
  select new.id, new.plan_id, new.completed_at,
    coalesce(array_agg(distinct identity.account_key order by identity.account_key)
      filter (where identity.account_key is not null), '{}'::text[])
  from public.plan_crew_members member
  left join public.private_social_accounts linked
    on linked.supabase_user_id = member.user_id
  cross join lateral (select case
    when member.social_account_id is not null
      then 'social:' || member.social_account_id::text
    when linked.id is not null then 'social:' || linked.id::text
    when member.user_id is not null then 'auth:' || member.user_id::text
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
