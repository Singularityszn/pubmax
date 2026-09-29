-- Cost: erases all private completion-time account snapshots. Reapplying 0169
-- cannot reconstruct them from a roster that may have changed since completion.
drop trigger if exists snapshot_plan_completion_group_after_insert
  on public.plan_completions;
drop function if exists pubmax_private.snapshot_plan_completion_group();
drop table if exists pubmax_private.plan_completion_group_snapshots;
