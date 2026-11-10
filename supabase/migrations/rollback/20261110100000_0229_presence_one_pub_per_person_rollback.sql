-- Reverses 20261110100000_0229_presence_one_pub_per_person.sql.
--
-- COST: the duplicate presence rows 0229 deleted are not restored. They were
-- live for two hours at most, so nothing is lost after that window.

begin;

drop index if exists public.pub_presence_actor_uidx;

commit;
