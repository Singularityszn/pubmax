-- Rollback 0209: drop the kitchen reports table. THIS DELETES EVERY "STILL
-- SERVING" AND "KITCHEN CLOSED" A DRINKER HAS TAPPED, and every confirmation
-- beside them. Nothing else reads this table, so no pack, pin or hours move.
-- The cost is the last 90 minutes of kitchen readings and the rows the
-- account export would have carried.

begin;

drop index if exists public.kitchen_reports_confirmed_by_idx;
drop index if exists public.kitchen_reports_reporter_reported_idx;
drop index if exists public.kitchen_reports_venue_reported_idx;

drop table if exists public.kitchen_reports;

commit;
