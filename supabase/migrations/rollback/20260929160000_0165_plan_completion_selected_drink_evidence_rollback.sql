-- 0165 rollback: Future completions omit selected drink evidence. Existing
-- completion snapshots keep their recorded evidence.

drop trigger if exists plan_completion_capture_selected_drink_evidence on public.plan_completions;
drop function if exists public.plan_completion_capture_selected_drink_evidence();
