-- Rollback for 0182 (Social post videos).
--
-- Drops the five functions and both tables. Every post loses its video and
-- every pending upload intent is forgotten; the posts, their words, photos and
-- scores are untouched. The video objects themselves stay in Storage under
-- social-video/, unreferenced, so sweep that prefix first if the bytes must go
-- too. Safe to re-run.

begin;

drop function if exists public.read_held_social_post_videos(integer);
drop function if exists public.review_social_post_video(uuid, text);
drop function if exists public.read_social_post_videos(uuid[], uuid);
drop function if exists public.attach_social_post_video(uuid, uuid, uuid, bigint, numeric);
drop function if exists public.create_social_video_upload(uuid, text, bigint);
drop table if exists public.social_post_videos;
drop table if exists public.social_video_uploads;

commit;
