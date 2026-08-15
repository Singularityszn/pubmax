-- 0070 - preserve departed contributor display names for public redaction
--
-- Account deletion clears profiles.display_name. Keep the small public-redaction
-- snapshot on the contributor row so published Story captions can still scrub
-- a departed person's display name after that profile field is erased.

alter table public.night_story_contributors
  add column if not exists departed_display_name text;

