-- Rollback 0157: drop the withdrawn-profiles read.
--
-- COST: `lib/accountPublicAccess.server.ts` logs the missing function (once a
-- minute) and falls back to a direct read of the same rule for the profiles
-- being checked, so banned and suspended accounts stay hidden. Instead of one
-- round trip per minute, each check then pays the alias, profile and
-- suspension queries (chunked at 100 ids, run together) plus one GoTrue admin
-- `getUserById` per distinct profile owner, at most 8 in flight, each answer
-- held for 60 seconds. It never lists users. If any of those reads fails, the
-- public surface refuses rather than shows. No data is lost: the function
-- stored nothing.

begin;

drop function if exists public.public_withdrawn_profiles();

commit;
