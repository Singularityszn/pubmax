-- Rollback for 0183 (your lot's pubs).
--
-- Drops the one read function. It wrote nothing, so nothing is lost: every
-- score stays on its post and in its author's own ranking. Safe to re-run.

begin;

drop function if exists public.read_lot_social_pub_ranking(uuid, integer);

commit;
