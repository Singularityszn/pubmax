-- Public withdrawn profiles (0157): the ONE read every public surface asks
-- before it shows an account or anything the account contributed.
-- Captain / firstmate applies. Agents ship SQL only.
--
-- WHAT WITHDRAWN MEANS: a LIVE profile (not tombstoned) whose owner is banned
-- in Supabase auth (`auth.users.banned_until` in the future) OR whose private
-- Social account is `suspended`. A tombstoned profile is DELETED, not banned:
-- the deletion trigger also marks its Social account suspended, but its
-- contributions stay public under the retired label (0150), so it is never
-- returned here.
--
-- WHY A FUNCTION: `auth.users` is not exposed to PostgREST, and asking GoTrue
-- per author fanned one public feed read out into one admin call per author.
-- This answers every withdrawn profile in one round trip, and the set is as
-- small as the moderation record, so a caller reads it whole and decides its
-- rows locally.
--
-- WHO MAY CALL IT: the service role alone. It pairs profiles with their
-- moderation state, which no browser role may enumerate. EXECUTE is revoked
-- from `public`, `anon` and `authenticated` and granted to `service_role`.
--
-- `search_path` is pinned empty so every name resolves schema-qualified.

begin;

create or replace function public.public_withdrawn_profiles()
returns table (profile_id uuid, handle text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.handle
  from public.profiles p
  join auth.users u on u.id = p.user_id
  where p.tombstoned_at is null
    and u.banned_until is not null
    and u.banned_until > now()
  union
  select p.id, p.handle
  from public.private_social_accounts s
  join public.profiles p on p.id = s.profile_id
  where p.tombstoned_at is null
    and s.ownership_state = 'suspended';
$$;

comment on function public.public_withdrawn_profiles() is
  'Live profiles withdrawn from public view: owner banned in auth, or Social account suspended. Tombstoned (deleted) profiles are excluded. Service role only.';

revoke all on function public.public_withdrawn_profiles() from public;
revoke all on function public.public_withdrawn_profiles() from anon;
revoke all on function public.public_withdrawn_profiles() from authenticated;
grant execute on function public.public_withdrawn_profiles() to service_role;

commit;
