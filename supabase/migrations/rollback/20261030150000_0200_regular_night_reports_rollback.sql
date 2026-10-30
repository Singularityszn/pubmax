-- Rollback 0200: drop the regular night report tables. THIS DELETES EVERY
-- REGULAR NIGHT A DRINKER HAS ADDED, open, confirmed or hidden, and every
-- "still on" beside them. Nothing else reads these tables, so no pack, pin or
-- listing moves. The board photos stay in Storage under regular-night-boards/
-- with no row naming them: sweep that folder first if the bytes must go too.

begin;

drop index if exists public.regular_night_report_still_on_user_idx;
drop table if exists public.regular_night_report_still_on;

drop index if exists public.regular_night_reports_reporter_created_idx;
drop index if exists public.regular_night_reports_status_created_idx;
drop index if exists public.regular_night_reports_venue_live_idx;
drop index if exists public.regular_night_reports_weekday_live_idx;

drop table if exists public.regular_night_reports;

commit;
