-- 0187: what your lot said about one pub, for its pub page.
-- Captain applies. Agents ship SQL only.
--
-- The pub page (app/pubs/[id]) shows a signed-in reader the scored posts
-- their mutual friends wrote about THAT pub, newest first, with the post's
-- words and its first photo. It is 0184's lot ranking narrowed to one venue
-- and opened to the posts themselves, under the same rules:
--   * only posts the reader may already read (social_post_readable), so a
--     friend's private post and a stranger's post never appear;
--   * never the reader's own, never an author either side has blocked;
--   * answered to that reader alone, writing nothing.
-- A post naming a pub is never public (0072), so a signed-out reader and a
-- reader with no lot get an empty answer, never somebody else's.
--
-- Reverse: supabase/migrations/rollback/20261017180000_0187_social_lot_venue_reviews_rollback.sql

begin;

create function public.read_lot_venue_social_reviews(
  p_viewer_profile_id uuid, p_venue_id text, p_limit integer
)
returns table(
  post_id uuid,
  author_profile_id uuid,
  author_handle text,
  rating numeric,
  body text,
  photo_media_id uuid,
  photo_alt_text text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select post.id, post.author_profile_id, post.author_handle, review.rating, post.body,
    post.photo_media_id, post.photo_alt_text, post.created_at
  from public.social_post_reviews review
  join public.social_posts post on post.id = review.post_id
  where post.venue_id = p_venue_id
    and post.author_profile_id <> p_viewer_profile_id
    and public.social_post_readable(post, p_viewer_profile_id)
    and not public.social_interaction_blocked(p_viewer_profile_id, post.author_profile_id)
  order by post.created_at desc, post.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.read_lot_venue_social_reviews(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.read_lot_venue_social_reviews(uuid, text, integer) to service_role;

commit;
