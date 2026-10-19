-- Rollback for 0194 (a Pub Pal its owner shows to their crew).
--
-- Drops `pub_pals.crew_visible`. Every Pal goes back to private, which is
-- what the column's default already was: a lost choice, never a disclosure.
-- The app reads a missing column as "not shown", so roll the app back first
-- or accept that "Show my Pal to my crew" stops saving. Safe to re-run.

begin;

alter table public.pub_pals drop column if exists crew_visible;

commit;
