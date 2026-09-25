-- Rollback 0157: drop the withdrawn-profiles read.
--
-- COST: `lib/accountPublicAccess.server.ts` fails soft when the function is
-- missing, so every banned or suspended account reappears on public surfaces
-- (profile, search, directory, feeds) until the function is restored or the
-- application stops asking. Sign-in still refuses a banned account, because
-- GoTrue enforces the ban itself. No data is lost: the function stored nothing.

begin;

drop function if exists public.public_withdrawn_profiles();

commit;
