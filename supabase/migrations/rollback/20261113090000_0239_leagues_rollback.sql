-- Rollback 0239: drop leagues. THIS DELETES EVERY LEAGUE AND EVERY
-- MEMBERSHIP, and every invite code stops working. No points are lost, because
-- a league holds no score: each person's points come from their own records,
-- and those stay. Once the tables are gone the league pages say leagues are
-- not open yet.

begin;

drop function if exists public.join_league(uuid, uuid, text);
drop function if exists public.create_league(uuid, uuid, text, text);

drop table if exists public.league_members;
drop table if exists public.leagues;

commit;
