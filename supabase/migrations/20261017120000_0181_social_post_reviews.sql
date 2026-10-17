-- 0181: a Social post can carry its author's own score for the pub it names.
-- Captain applies. Agents ship SQL only.
--
-- A review is one person's score, 1 to 5 in half steps, attached to a post
-- that already names a venue. It is a fact about that post and nothing else:
-- no venue rating, price or ranking reads this table, and there is no
-- cross-author aggregate (docs/social/SOCIAL_BETA_CONTRACT.md).
--
-- The venue is NOT copied here. The score reads the post's own venue_id, so a
-- review always means the pub the post names today, and a post edited down to
-- no venue carries no score until it names one again.
--
-- Writes go through attach_social_post_review(), which refuses a post the
-- caller does not own, a post with no venue, a removed post and a score off
-- the half-step scale. Browser roles hold no privilege on the table or the
-- functions; the routes use the service role, as every other Social table.
--
-- Reverse: supabase/migrations/rollback/20261017120000_0181_social_post_reviews_rollback.sql

begin;

create table public.social_post_reviews (
  post_id uuid primary key references public.social_posts(id) on delete cascade,
  author_profile_id uuid not null references public.profiles(id) on delete cascade,
  rating numeric(2,1) not null
    check (rating >= 1 and rating <= 5 and rating * 2 = trunc(rating * 2)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index social_post_reviews_author_rating_idx
  on public.social_post_reviews (author_profile_id, rating desc, created_at desc);

alter table public.social_post_reviews enable row level security;
revoke all on table public.social_post_reviews from public, anon, authenticated;
grant select, insert, update, delete on table public.social_post_reviews to service_role;

create function public.attach_social_post_review(
  p_post_id uuid, p_author_profile_id uuid, p_rating numeric
)
returns table(post_id uuid, rating numeric, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post public.social_posts%rowtype;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 or p_rating * 2 <> trunc(p_rating * 2) then
    raise exception 'invalid Social review rating';
  end if;
  select * into v_post from public.social_posts where id = p_post_id for update;
  if not found or v_post.author_profile_id <> p_author_profile_id or v_post.status = 'removed' then
    raise exception 'Social review post not found';
  end if;
  if v_post.venue_id is null then
    raise exception 'Social review needs a venue';
  end if;
  return query
    insert into public.social_post_reviews as review (post_id, author_profile_id, rating)
    values (p_post_id, p_author_profile_id, p_rating)
    on conflict on constraint social_post_reviews_pkey
      do update set rating = excluded.rating, updated_at = now()
    returning review.post_id, review.rating, review.updated_at;
end;
$$;

-- One row per venue the author has scored: the newest score for that venue,
-- best first. Only the author's own readable posts with a venue count.
create function public.read_own_social_pub_ranking(
  p_author_profile_id uuid, p_limit integer
)
returns table(post_id uuid, venue_id text, rating numeric, reviewed_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select ranked.post_id, ranked.venue_id, ranked.rating, ranked.reviewed_at
  from (
    select distinct on (post.venue_id)
      review.post_id, post.venue_id, review.rating, review.updated_at as reviewed_at
    from public.social_post_reviews review
    join public.social_posts post on post.id = review.post_id
    where review.author_profile_id = p_author_profile_id
      and post.author_profile_id = p_author_profile_id
      and post.status <> 'removed'
      and post.venue_id is not null
    order by post.venue_id, review.updated_at desc, review.post_id desc
  ) ranked
  order by ranked.rating desc, ranked.reviewed_at desc, ranked.post_id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

revoke all on function public.attach_social_post_review(uuid, uuid, numeric)
  from public, anon, authenticated;
revoke all on function public.read_own_social_pub_ranking(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.attach_social_post_review(uuid, uuid, numeric) to service_role;
grant execute on function public.read_own_social_pub_ranking(uuid, integer) to service_role;

commit;
