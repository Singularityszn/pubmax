begin;

-- Completion-time account membership is private historical evidence. Existing
-- completions are deliberately absent: the current roster cannot reconstruct them.
-- Plan deletion removes its private membership evidence.
create table pubmax_private.plan_completion_group_snapshots (
  completion_id uuid primary key,
  plan_id uuid not null references public.plans(id) on delete cascade,
  completed_at timestamptz not null,
  account_keys text[] not null,
  captured_at timestamptz not null default now()
);

create index plan_completion_group_snapshots_completed_at_idx
  on pubmax_private.plan_completion_group_snapshots (completed_at);

create index plan_completion_group_snapshots_plan_id_idx
  on pubmax_private.plan_completion_group_snapshots (plan_id);

create index plan_completion_group_snapshots_account_keys_idx
  on pubmax_private.plan_completion_group_snapshots using gin (account_keys);

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

-- The auth deletion path keeps Social account rows for Crew history. Remove
-- snapshots containing either identity before its auth binding is cleared.
create function pubmax_private.erase_plan_completion_groups_on_account_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  erased_keys text[];
begin
  select array_prepend('auth:' || old.id::text,
    coalesce(array_agg('social:' || social_account.id::text), '{}'::text[]))
    into erased_keys
  from public.private_social_accounts social_account
  join public.profiles profile on profile.id = social_account.profile_id
  where profile.user_id = old.id
    or social_account.supabase_user_id = old.id;

  delete from pubmax_private.plan_completion_group_snapshots snapshot
  where snapshot.account_keys && erased_keys;
  return old;
end;
$$;

revoke all on function pubmax_private.erase_plan_completion_groups_on_account_delete()
  from public, anon, authenticated, service_role;

create trigger erase_plan_completion_groups_on_account_delete
before delete on auth.users
for each row execute function pubmax_private.erase_plan_completion_groups_on_account_delete();

-- One row per requested ISO week. Account keys stay inside this private query.
create function pubmax_private.completion_group_week(p_day date)
returns table (
  week_start date,
  groups_completed bigint,
  groups_repeated bigint,
  repeat_rate numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with requested_week as (
    select date_trunc('week', p_day::timestamp)::date as first_day
  ), normalized as (
    select snapshot.plan_id, snapshot.completed_at,
      array(
        select distinct coalesce('auth:' || linked.supabase_user_id::text, member.account_key)
        from unnest(snapshot.account_keys) as member(account_key)
        left join public.private_social_accounts linked
          on member.account_key = 'social:' || linked.id::text
        order by 1
      ) as account_keys
    from pubmax_private.plan_completion_group_snapshots snapshot
  ), counted as (
    select count(*) as completed,
      count(*) filter (where exists (
        select 1
        from normalized earlier
        where earlier.plan_id <> current_night.plan_id
          and earlier.completed_at < current_night.completed_at
          and earlier.completed_at >= current_night.completed_at - interval '28 days'
          and cardinality(earlier.account_keys) >= 2
          and (
            select count(*) from unnest(current_night.account_keys) as member(account_key)
            where member.account_key = any(earlier.account_keys)
          ) >= 2
      )) as repeated
    from normalized current_night
    cross join requested_week week
    where current_night.completed_at >= week.first_day::timestamp at time zone 'UTC'
      and current_night.completed_at < (week.first_day + 7)::timestamp at time zone 'UTC'
      and cardinality(current_night.account_keys) >= 2
  )
  select week.first_day, counted.completed, counted.repeated,
    counted.repeated::numeric / nullif(counted.completed, 0)
  from requested_week week cross join counted;
$$;

revoke all on function pubmax_private.completion_group_week(date)
  from public, anon, authenticated;
grant execute on function pubmax_private.completion_group_week(date)
  to service_role;

commit;
