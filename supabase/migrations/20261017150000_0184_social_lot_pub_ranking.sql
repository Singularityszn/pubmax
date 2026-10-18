-- 0184: Your lot's pubs, the friends' ranking.
-- Captain applies. Agents ship SQL only.
--
-- ADR 0017 kept every score personal. The captain has since asked for the
-- friends' ranking (17 Oct 2026), so this adds ONE aggregate, and only this
-- one: for a reader, the pubs their lot (mutual follows) have scored, each
-- friend's newest score per pub averaged, best first.
--
-- WHAT IT READS. Only scores on posts the reader may already read
-- (social_post_readable: visible, approved, and a mutual follow for a
-- friends post; a post naming a pub is never public, 0072), never the
-- reader's own, never an author either side has blocked. A friend's private
-- post adds nothing.
--
-- WHAT IT IS NOT. It is a view for one reader of their own friends. No venue
-- rating, price, map layer or feed order reads it, and nobody else's lot is
-- reachable through it. It writes nothing.
--
-- Reverse: supabase/migrations/rollback/20261017150000_0184_social_lot_pub_ranking_rollback.sql

begin;

create function public.read_lot_social_pub_ranking(p_viewer_profile_id uuid, p_limit integer)
returns table(
  venue_id text,
  average_rating numeric,
  rater_count integer,
  rater_handles text[],
  last_reviewed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with newest as (
    select distinct on (post.author_profile_id, post.venue_id)
      post.author_profile_id, post.author_handle, post.venue_id, review.rating, review.updated_at
    from public.social_post_reviews review
    join public.social_posts post on post.id = review.post_id
    where post.venue_id is not null
      and post.author_profile_id <> p_viewer_profile_id
      and public.social_post_readable(post, p_viewer_profile_id)
      and not public.social_interaction_blocked(p_viewer_profile_id, post.author_profile_id)
    order by post.author_profile_id, post.venue_id, review.updated_at desc, review.post_id desc
  )
  select
    newest.venue_id,
    round(avg(newest.rating), 1) as average_rating,
    count(*)::integer as rater_count,
    (array_agg(newest.author_handle order by newest.rating desc, newest.updated_at desc))[1:3] as rater_handles,
    max(newest.updated_at) as last_reviewed_at
  from newest
  group by newest.venue_id
  order by average_rating desc, rater_count desc, last_reviewed_at desc, newest.venue_id
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

revoke all on function public.read_lot_social_pub_ranking(uuid, integer) from public, anon, authenticated;
grant execute on function public.read_lot_social_pub_ranking(uuid, integer) to service_role;

commit;
