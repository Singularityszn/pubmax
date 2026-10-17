-- Rollback for 0186 (your pubs in your own order).
--
-- Drops the three functions and the table. Every order anybody built by
-- comparing pubs is deleted with it; their posts, star scores and the star
-- ranking are untouched. Nothing else reads the table. Safe to re-run.

begin;

drop function if exists public.read_social_pub_rankings(uuid);
drop function if exists public.remove_social_pub_ranking(uuid, text);
drop function if exists public.place_social_pub_ranking(uuid, text, text, text, text);
drop table if exists public.social_pub_rankings;

commit;
