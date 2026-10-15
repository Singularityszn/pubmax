-- Restore the previous application before rollback. Removing these names means
-- previously cleared display names can reappear in surviving public Story text.
-- Private source Moments were never rewritten, so that loss is irreversible.
begin;
drop function if exists public.clear_profile_for_caller(text, uuid);
drop table if exists public.private_story_redaction_names;
commit;
