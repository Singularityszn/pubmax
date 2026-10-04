-- Close the profiles table door (0170).
-- Captain applies. Agents ship SQL only.
--
-- 0009 added profiles_owner_insert and profiles_owner_update so a signed-in
-- JWT could write the row it owns. 0050 revoked SELECT from anon and
-- authenticated. 0067 granted SELECT back to authenticated and kept both
-- write policies. Nothing revoked the table INSERT, UPDATE, or DELETE that
-- default privileges had already given those roles, so PostgREST with the
-- public anon key and any signed-in JWT could rewrite handle,
-- founding_member_number, and avatar moderation on the caller's own row,
-- and could insert ownerless rows that burn handles.
--
-- The app writes profiles through the service role. This migration leaves
-- that path alone: SELECT stays with authenticated, behind
-- profiles_owner_select, and service_role keeps full DML.
--
-- Reverse: supabase/migrations/rollback/20261002210000_0170_profiles_table_door_rollback.sql

begin;

revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;

drop policy if exists profiles_owner_insert on public.profiles;
drop policy if exists profiles_owner_update on public.profiles;

commit;
