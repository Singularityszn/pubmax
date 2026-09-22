-- Rollback 0158. Dropping the functions returns both stores to their
-- read-modify-write fallback, which stays correct for a single reporter and
-- only loses the atomic append under concurrency. No data is written or
-- removed here.

drop function if exists public.append_venue_photo_report_actor(uuid, text, text);
drop function if exists public.append_visit_report_report_actor(uuid, text, text);
