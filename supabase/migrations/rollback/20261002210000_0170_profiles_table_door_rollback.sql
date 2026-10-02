-- Reopens the profiles table door that 0170 closed.
-- Restores the grants the chain leaves after 0050 and 0067, and the two
-- owner write policies from 0009. SELECT for authenticated is granted again
-- because revoke all took it. service_role is untouched.
--
-- Cost: a signed-in JWT can again rewrite its own profiles row and insert
-- an ownerless one. Apply the forward migration again to close that.

begin;

grant insert, update, delete on table public.profiles to anon;
grant select, insert, update, delete on table public.profiles to authenticated;

drop policy if exists profiles_owner_update on public.profiles;
create policy profiles_owner_update
  on public.profiles
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists profiles_owner_insert on public.profiles;
create policy profiles_owner_insert
  on public.profiles
  for insert
  to authenticated
  with check (user_id is null or user_id = (select auth.uid()));

commit;
