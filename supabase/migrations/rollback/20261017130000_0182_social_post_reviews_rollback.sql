-- Rollback for 0182 (Social post reviews).
--
-- Drops the two functions and the table. Every score anybody gave a pub is
-- deleted with it; the posts themselves, their venues and their photos are
-- untouched. Nothing else reads the table, so no other surface changes.
-- Safe to re-run.

begin;

drop function if exists public.read_own_social_pub_ranking(uuid, integer);
drop function if exists public.attach_social_post_review(uuid, uuid, numeric);
drop table if exists public.social_post_reviews;

commit;
