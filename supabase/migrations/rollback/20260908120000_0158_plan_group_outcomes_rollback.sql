-- Rollback deletes measurement snapshots and coverage, not Plans or endings.
-- Restore the previous app first: the attributed completion RPC is removed.
begin;
drop function public.read_plan_group_outcomes(timestamptz,timestamptz,text);
drop function public.complete_plan_with_group_outcome_atomic(uuid,text,integer,uuid,uuid,text,text,jsonb,timestamptz,text,text,text,integer,text[]);
drop function public.complete_plan_atomic(uuid,text,integer,uuid,uuid,text,text,timestamptz);
drop function public.complete_plan_atomic(uuid,text,integer,uuid,uuid,text,text,jsonb,timestamptz);
drop function public._0158_capture_plan_group_outcome(uuid,text,text,text,uuid[]);
drop function public._0158_lock_group_completion_accounts(uuid);
alter function public._0158_complete_plan_atomic_8(uuid,text,integer,uuid,uuid,text,text,timestamptz)
  rename to complete_plan_atomic;
alter function public._0158_complete_plan_atomic_9(uuid,text,integer,uuid,uuid,text,text,jsonb,timestamptz)
  rename to complete_plan_atomic;
grant execute on function public.complete_plan_atomic(uuid,text,integer,uuid,uuid,text,text,timestamptz),
  public.complete_plan_atomic(uuid,text,integer,uuid,uuid,text,text,jsonb,timestamptz) to service_role;
drop table public.plan_group_outcome_accounts;
drop table public.plan_group_outcomes;
drop table public.plan_group_outcome_capture;
drop table public.plan_group_outcome_classifications;
drop table public.plan_group_outcome_specifications;
drop function public._0158_preserve_used_group_specification();
drop index public.plan_group_outcomes_completed_at_idx;
commit;
