-- Incomplete job cursors are lost. Existing delivery claims remain.
drop function public.advance_nudge_job(text,uuid,text,boolean);
drop function public.claim_nudge_job(text,uuid);
drop table public.nudge_job_cursors;
