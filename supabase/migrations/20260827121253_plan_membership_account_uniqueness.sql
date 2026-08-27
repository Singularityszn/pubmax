-- One account represents one membership in a Plan. The claim RPC already
-- checks this rule for a clear conflict outcome; this index also closes the
-- concurrent-writer race at the database boundary.

create unique index if not exists plan_crew_members_plan_user_unique_idx
  on public.plan_crew_members(plan_id, user_id)
  where user_id is not null;
