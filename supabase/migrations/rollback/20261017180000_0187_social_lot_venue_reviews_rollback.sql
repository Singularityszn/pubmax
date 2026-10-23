-- Rollback for 0187 (your lot on one pub).
--
-- Drops the one read function. It wrote nothing, so nothing is lost; the pub
-- page's lot section answers empty until it is back. Safe to re-run.

begin;

drop function if exists public.read_lot_venue_social_reviews(uuid, text, integer);

commit;
