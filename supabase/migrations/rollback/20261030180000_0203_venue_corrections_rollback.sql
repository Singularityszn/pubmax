-- Rollback 0203: drop the venue corrections table. THIS DELETES EVERY "THAT'S
-- WRONG" NOTE ANY DRINKER HAS SENT, open or decided. Nothing else reads the
-- table, so no pin, price or pub moves. Export first if any open rows matter.

begin;

drop index if exists public.venue_corrections_owner_created_idx;
drop index if exists public.venue_corrections_status_created_idx;

drop table if exists public.venue_corrections;

commit;
