-- Rollback 0233: drop the guarded crew status writer.
-- Deploy the application that writes plan_crew_members.status directly before you apply this rollback.
-- It loses no data.
begin;
drop function if exists public.set_crew_status(uuid, text, text, uuid, uuid);
commit;
