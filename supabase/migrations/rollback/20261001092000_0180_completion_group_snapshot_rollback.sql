begin;

-- Cost: erases all private completion-time account snapshots. Reapplying 0180
-- cannot reconstruct them from a roster that may have changed since completion.
drop function if exists pubmax_private.completion_group_week(date);
drop trigger if exists erase_plan_completion_groups_on_account_delete
  on auth.users;
drop function if exists pubmax_private.erase_plan_completion_groups_on_account_delete();
drop trigger if exists snapshot_plan_completion_group_after_insert
  on public.plan_completions;
drop function if exists pubmax_private.snapshot_plan_completion_group();
drop table if exists pubmax_private.plan_completion_group_snapshots;

commit;
