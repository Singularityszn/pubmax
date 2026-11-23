-- 0265 rollback: restore the whole-table SELECT that 0170 granted.
--
-- Cost: this discloses again. A signed-in account can read the reporter's text,
-- the reporter hashes and the moderator's note on its own profile row.

begin;

revoke select on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;

commit;
