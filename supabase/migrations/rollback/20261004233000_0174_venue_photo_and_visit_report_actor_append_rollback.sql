-- Rollback provisional 0174. No table, row or report metadata is removed.
-- The new durable reporter callers return retryable 503 after these RPCs are
-- removed. Restore the application first if reporting must remain available.
-- The old application has the concurrent reporter loss this migration repairs.

begin;
drop function if exists public.append_venue_photo_report_actor(uuid, text, text);
drop function if exists public.append_visit_report_report_actor(uuid, text, text);
commit;
