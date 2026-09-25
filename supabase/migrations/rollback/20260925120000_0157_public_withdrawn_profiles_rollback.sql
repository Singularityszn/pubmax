-- Rollback 0157: drop the withdrawn-profiles read.
--
-- COST: `lib/accountPublicAccess.server.ts` logs the missing function and
-- falls back to a direct batched read of the same rule, so banned and
-- suspended accounts stay hidden, at the price of one GoTrue admin user list
-- and a few table reads per check instead of one round trip. No data is lost:
-- the function stored nothing.

begin;

drop function if exists public.public_withdrawn_profiles();

commit;
