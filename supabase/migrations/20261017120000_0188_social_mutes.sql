-- Social mutes (0188). Apply AFTER 0180. Captain applies; agents ship SQL only.
--
-- Reverse: supabase/migrations/rollback/20261017120000_0188_social_mutes_rollback.sql
--
-- WHAT A MUTE IS. One account choosing to stop seeing another's posts in its
-- own Social lanes. It is ONE-WAY and PRIVATE, which is what makes it different
-- from a block (0073): the muted account is not told, can still follow, can
-- still read the muter's posts, and its posts are still readable to the muter
-- by direct link. Only `read_social_post_feed` reads the table, so a mute
-- moves the muter's three lanes and nothing else.
--
-- WHAT THIS DOES.
--   1. `public.social_mutes`, keyed (muter, muted), the same shape and the same
--      service-only grants as `social_blocks`, with RLS on and no browser
--      grant: who you mute is nobody's business, the muted account's least.
--   2. `set_social_mute(actor, target, active)`, the desired-state write the
--      store calls, idempotent both ways like `set_social_block`.
--   3. `read_social_relationship(actor, target)`, the actor's OWN block and
--      mute against one account. It never answers whether the target blocked
--      the actor, because that would tell a blocked account who blocked it.
--   4. `read_social_post_feed` restated from 0074 with one more predicate: no
--      post from an account the viewer muted. Order, lanes, cursor and every
--      other rule are byte for byte 0074's.
--
-- A deploy ahead of this apply reads lanes with no mute filter and refuses a
-- mute write in production (the store's schema-miss guard), so nobody is told
-- a mute took when it did not.

begin;

create table public.social_mutes (
  muter_profile_id uuid not null references public.profiles(id) on delete cascade,
  muted_profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_profile_id, muted_profile_id),
  check (muter_profile_id <> muted_profile_id)
);

-- The feed probes (muter, muted) and the primary key already leads with the
-- muter, so the cascade from a deleted muted account is the one lookup left.
create index social_mutes_muted_idx on public.social_mutes (muted_profile_id);

alter table public.social_mutes enable row level security;
revoke all on table public.social_mutes from public, anon, authenticated;
grant select, insert, update, delete on table public.social_mutes to service_role;

create function public.set_social_mute(p_actor uuid, p_target uuid, p_active boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_actor = p_target then raise exception 'cannot mute self'; end if;
  if p_active then
    insert into public.social_mutes(muter_profile_id, muted_profile_id)
    values (p_actor, p_target) on conflict do nothing;
  else
    delete from public.social_mutes where muter_profile_id = p_actor and muted_profile_id = p_target;
  end if;
  return true;
end;
$$;

create function public.read_social_relationship(p_actor uuid, p_target uuid)
returns table (blocked boolean, muted boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from public.social_blocks
      where blocker_profile_id = p_actor and blocked_profile_id = p_target),
    exists (select 1 from public.social_mutes
      where muter_profile_id = p_actor and muted_profile_id = p_target);
$$;

create or replace function public.read_social_post_feed(
  p_viewer_profile_id uuid,
  p_lane text,
  p_area_slug text default null,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 20
)
returns setof public.social_posts
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_lane not in ('discover', 'nearby', 'following')
    or p_limit < 1 or p_limit > 51
    or (p_lane = 'nearby' and p_area_slug is null)
    or ((p_before_created_at is null) <> (p_before_id is null))
  then raise exception 'invalid social feed request';
  end if;
  return query
  select projected.*
  from public.social_posts post
  cross join lateral jsonb_populate_record(
    null::public.social_posts,
    to_jsonb(post) || jsonb_build_object(
      'venue_id', case when public.social_post_exact_venue_allowed(post, p_viewer_profile_id)
        then post.venue_id else null end
    )
  ) projected
  where public.social_post_readable(post, p_viewer_profile_id)
    and not public.social_interaction_blocked(p_viewer_profile_id, post.author_profile_id)
    and not exists (select 1 from public.social_mutes mute
      where mute.muter_profile_id = p_viewer_profile_id
        and mute.muted_profile_id = post.author_profile_id)
    and (p_before_created_at is null or (post.created_at, post.id) < (p_before_created_at, p_before_id))
    and case p_lane
      when 'discover' then post.visibility = 'public'
      when 'nearby' then post.visibility = 'public' and post.area_slug = p_area_slug
      when 'following' then exists (select 1 from public.follows
        where follower_id = p_viewer_profile_id and followee_id = post.author_profile_id)
        and (post.visibility = 'public' or (
          post.visibility = 'friends' and exists (select 1 from public.follows
            where follower_id = post.author_profile_id and followee_id = p_viewer_profile_id)
        ))
      else false
    end
  order by post.created_at desc, post.id desc
  limit p_limit;
end;
$$;

revoke all on function public.set_social_mute(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.read_social_relationship(uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_social_mute(uuid, uuid, boolean) to service_role;
grant execute on function public.read_social_relationship(uuid, uuid) to service_role;

commit;
