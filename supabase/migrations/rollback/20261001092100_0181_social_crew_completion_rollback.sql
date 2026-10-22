begin;

-- Completed nights and private membership snapshots written while 0181 was
-- active remain. Rolling back removes the Social completion write path only.
drop function if exists public.complete_social_crew_plan_atomic(
  uuid,uuid,integer,uuid,uuid,uuid,integer,text,text,jsonb,timestamptz
);

commit;
