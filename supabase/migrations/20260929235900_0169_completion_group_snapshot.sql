-- Completion-time account membership is private historical evidence. Existing
-- completions are deliberately absent: the current roster cannot reconstruct them.
-- No foreign key to a Plan, completion or auth user: their later deletion must
-- not change the completed night's measured membership.
create table pubmax_private.plan_completion_group_snapshots (
  completion_id uuid primary key,
  plan_id uuid not null,
  completed_at timestamptz not null,
  account_ids uuid[] not null,
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
    (completion_id, plan_id, completed_at, account_ids)
  select new.id, new.plan_id, new.completed_at,
    coalesce(array_agg(distinct member.user_id order by member.user_id)
      filter (where member.user_id is not null), '{}'::uuid[])
  from public.plan_crew_members member
  where member.plan_id = new.plan_id
    and member.membership_revoked_at is null
    and member.joined_at <= new.completed_at;
  return new;
end;
$$;

revoke all on function pubmax_private.snapshot_plan_completion_group()
  from public, anon, authenticated, service_role;

create trigger snapshot_plan_completion_group_after_insert
after insert on public.plan_completions
for each row execute function pubmax_private.snapshot_plan_completion_group();
