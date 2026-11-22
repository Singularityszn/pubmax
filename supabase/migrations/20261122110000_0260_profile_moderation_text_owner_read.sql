-- 0260: An account cannot read the moderation text about itself (captain call K11).
-- Captain applies. Agents ship SQL only.
--
-- 0170 left authenticated a whole-table SELECT on public.profiles, and the
-- 0067 owner policy admits the caller's own row. A person whose avatar or cover
-- was reported could read, through the database API, the reporter's free text,
-- the reporter hashes and the moderator's note about them.
--
-- This swaps the table grant for a column grant that leaves out those six
-- columns. The owner policy and every other column stay as they were. No app
-- code reads profiles with a browser role; the app reads through the service
-- role, which keeps full access. A column added later is not readable by a
-- browser role until a migration grants it.
--
-- Reverse: supabase/migrations/rollback/20261122110000_0260_profile_moderation_text_owner_read_rollback.sql

begin;

revoke select on table public.profiles from authenticated;

grant select (
  id,
  user_id,
  handle,
  display_name,
  avatar_url,
  home_city,
  bio,
  created_at,
  updated_at,
  handle_changed_at,
  tombstoned_at,
  avatar_object_key,
  avatar_generation,
  avatar_moderation_state,
  avatar_report_count,
  avatar_reported_at,
  avatar_moderated_at,
  cover_object_key,
  cover_generation,
  cover_moderation_state,
  cover_report_count,
  cover_reported_at,
  cover_moderated_at,
  favourite_drink,
  interests,
  workplace,
  founding_member_number,
  visibility,
  founding_member_excluded
) on table public.profiles to authenticated;

commit;
