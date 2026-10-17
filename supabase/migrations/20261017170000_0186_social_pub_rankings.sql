-- 0186: your pubs in your own order, built by "which did you prefer?".
-- Captain applies. Agents ship SQL only.
--
-- A person sorts each pub into one of three bands (loved it, it was fine,
-- not for me) and then places it inside that band by answering which of two
-- pubs they preferred. The answers are a binary search the browser runs; what
-- is stored is only the result: one row per pub with its band and an ordering
-- key. The 0-10 figure shown beside each pub is derived from band and place
-- (lib/socialPubRankings.ts) and never stored, so it cannot drift.
--
-- It is the person's own list. No venue rating, price, map layer or feed
-- order reads it, and no other account can read it (ADR 0017).
--
-- PLACING. place_social_pub_ranking takes the two neighbours the browser
-- landed between. If the list moved since the questions were asked (another
-- tab placed a pub between them), the call refuses as stale and the browser
-- asks again, so two tabs can never interleave a wrong order. Placing a pub
-- that is already ranked moves it.
--
-- Reverse: supabase/migrations/rollback/20261017170000_0186_social_pub_rankings_rollback.sql

begin;

create table public.social_pub_rankings (
  author_profile_id uuid not null references public.profiles(id) on delete cascade,
  venue_id text not null check (char_length(venue_id) between 1 and 100),
  band text not null check (band in ('loved', 'fine', 'not_for_me')),
  rank_key numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (author_profile_id, venue_id)
);

create index social_pub_rankings_order_idx
  on public.social_pub_rankings (author_profile_id, band, rank_key);

alter table public.social_pub_rankings enable row level security;
revoke all on table public.social_pub_rankings from public, anon, authenticated;
grant select, insert, update, delete on table public.social_pub_rankings to service_role;

-- Lower rank_key is better. p_above is the pub that ends up just above the new
-- one (null at the top of the band), p_below the one just below (null at the
-- bottom). They must be adjacent in the band right now.
create function public.place_social_pub_ranking(
  p_author_profile_id uuid, p_venue_id text, p_band text, p_above_venue_id text, p_below_venue_id text
)
returns table(venue_id text, band text, rank_key numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_above numeric;
  v_below numeric;
  v_key numeric;
begin
  if p_band is null or p_band not in ('loved', 'fine', 'not_for_me') then
    raise exception 'invalid Social ranking band';
  end if;
  if p_venue_id is null or char_length(p_venue_id) not between 1 and 100
     or p_venue_id = p_above_venue_id or p_venue_id = p_below_venue_id then
    raise exception 'invalid Social ranking venue';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('social-pub-ranking:' || p_author_profile_id::text, 0));
  -- The pub leaves its old place first, so moving it is one placement.
  delete from public.social_pub_rankings r
   where r.author_profile_id = p_author_profile_id and r.venue_id = p_venue_id;

  if p_above_venue_id is not null then
    select r.rank_key into v_above from public.social_pub_rankings r
     where r.author_profile_id = p_author_profile_id and r.venue_id = p_above_venue_id and r.band = p_band;
    if v_above is null then raise exception 'stale Social ranking'; end if;
  end if;
  if p_below_venue_id is not null then
    select r.rank_key into v_below from public.social_pub_rankings r
     where r.author_profile_id = p_author_profile_id and r.venue_id = p_below_venue_id and r.band = p_band;
    if v_below is null then raise exception 'stale Social ranking'; end if;
  end if;
  if v_above is not null and v_below is not null and v_above >= v_below then
    raise exception 'stale Social ranking';
  end if;
  -- Adjacent now: nothing of this author's in this band sits between them.
  if exists (
    select 1 from public.social_pub_rankings r
     where r.author_profile_id = p_author_profile_id and r.band = p_band
       and (v_above is null or r.rank_key > v_above)
       and (v_below is null or r.rank_key < v_below)
  ) then
    raise exception 'stale Social ranking';
  end if;

  v_key := case
    when v_above is null and v_below is null then 1000
    when v_above is null then v_below - 1000
    when v_below is null then v_above + 1000
    else (v_above + v_below) / 2
  end;

  return query
    insert into public.social_pub_rankings as r (author_profile_id, venue_id, band, rank_key)
    values (p_author_profile_id, p_venue_id, p_band, v_key)
    returning r.venue_id, r.band, r.rank_key;
end;
$$;

create function public.remove_social_pub_ranking(p_author_profile_id uuid, p_venue_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.social_pub_rankings r
   where r.author_profile_id = p_author_profile_id and r.venue_id = p_venue_id;
  return found;
end;
$$;

create function public.read_social_pub_rankings(p_author_profile_id uuid)
returns table(venue_id text, band text, rank_key numeric, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select r.venue_id, r.band, r.rank_key, r.updated_at
  from public.social_pub_rankings r
  where r.author_profile_id = p_author_profile_id
  order by case r.band when 'loved' then 0 when 'fine' then 1 else 2 end, r.rank_key, r.venue_id;
$$;

revoke all on function public.place_social_pub_ranking(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.remove_social_pub_ranking(uuid, text) from public, anon, authenticated;
revoke all on function public.read_social_pub_rankings(uuid) from public, anon, authenticated;
grant execute on function public.place_social_pub_ranking(uuid, text, text, text, text) to service_role;
grant execute on function public.remove_social_pub_ranking(uuid, text) to service_role;
grant execute on function public.read_social_pub_rankings(uuid) to service_role;

commit;
