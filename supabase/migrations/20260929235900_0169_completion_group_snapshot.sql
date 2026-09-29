-- Completion-time account membership is private historical evidence. Existing
-- completions are deliberately absent: the current roster cannot reconstruct them.
-- No foreign key to a Plan, completion or auth user: their later deletion must
-- not change the completed night's measured membership.
create table pubmax_private.plan_completion_group_snapshots (
  completion_id uuid primary key,
  plan_id uuid not null,
  completed_at timestamptz not null,
  account_keys text[] not null,
  captured_at timestamptz not null default now()
);

create index plan_completion_group_snapshots_completed_at_idx
  on pubmax_private.plan_completion_group_snapshots (completed_at);

alter table pubmax_private.plan_completion_group_snapshots enable row level security;
revoke all on pubmax_private.plan_completion_group_snapshots
  from public, anon, authenticated, service_role;

create function pubmax_private.snapshot_plan_completion_group()
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

revoke all on function pubmax_private.snapshot_plan_completion_group()
  from public, anon, authenticated, service_role;

create trigger snapshot_plan_completion_group_after_insert
after insert on public.plan_completions
for each row execute function pubmax_private.snapshot_plan_completion_group();
