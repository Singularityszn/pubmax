-- Rollback for 0184 (Social extra photos).
--
-- Drops the five functions and the table. Every post keeps its first photo
-- and loses photos 2 to 4. Their objects stay in Storage under social-extra/,
-- unreferenced, so sweep that prefix first if the bytes must go too. Safe to
-- re-run.

begin;

drop function if exists public.complete_social_extra_photo_moderation(uuid, uuid, text, timestamptz);
drop function if exists public.claim_social_extra_photo_moderation(integer);
drop function if exists public.read_social_post_extra_photo_object(uuid, uuid);
drop function if exists public.read_social_post_extra_photos(uuid[], uuid);
drop function if exists public.attach_social_post_extra_photo(uuid, uuid, uuid, integer, text, integer, integer, integer, text);
drop table if exists public.social_post_extra_photos;

commit;
