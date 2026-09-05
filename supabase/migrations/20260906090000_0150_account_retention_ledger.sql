-- 0150: a contribution outlives the account, and the account is remembered
-- where only we can read it.
--
-- Captain, 5 September 2026: "We keep the prices, but we remember these
-- accounts and what they have logged in." Verification scout verify-preview-4
-- (sections 7.3, 10 and 13) measured what that ruling is about: a throwaway
-- account deleted itself through the product, its two Pint Drops stayed on the
-- map exactly as they should, and both were still printed under the retired
-- handle `vp4qa39758`, one of them leading the Blackfriar sheet on production.
--
-- TWO CHANGES, and the division of labour has to stay written down.
--
-- (1) THE LEDGER REMEMBERS. `public.account_retention_ledger` takes ONE row per
--     account that leaves: the auth user id, the handle it retired, the day it
--     left, and the ids of everything it logged. It is written by the tombstone
--     trigger BEFORE any row of that account is deleted, because the Memories,
--     the Moments and the wall photo rows are gone by the end of the same
--     statement and an id nobody wrote down is an id nobody can answer for.
--     Client roles get NOTHING: this table pairs a person's account id with
--     their public contributions, which is exactly the pairing the deletion
--     took away from every reader.
--
-- (2) THE CONTRIBUTIONS STAY, THE NAME DOES NOT. A leaving account's public
--     observations keep their price, their measure, their date and their place
--     in every trust lane: nothing here demotes a figure, and no lane predicate
--     reads this stamp. What changes is the NAME on them. Each lane that PRINTS
--     a contributor handle to a stranger takes an `author_retired_at` column,
--     stamped here, and its one public projection swaps the retired handle for
--     the label an anonymous drop already wears (`lib/retiredContributor.ts`).
--     A stamp rather than a join, because the answer is a fact about the row
--     and a public read may not pay for it. Handles are RESERVED by the
--     tombstone (0078 keeps the profile row), so a retired handle is never
--     re-issued and the stamp can never name the wrong person.
--
--     THREE LANES CARRY IT, and the boundary is account-bound authorship:
--     `pint_drops`, `structured_visit_reports` and `weather_recommendations`
--     each print a handle the server derived from a verified actor.
--     `community_prices` is in the ledger and takes no stamp, because its
--     `contributor_handle` never rides a public price DTO; it reaches a reader
--     only through the contributor leaderboard, which this file narrows below.
--     `pint_drop_comments` is deliberately absent: its handle is typed by the
--     commenter beside an IP hash and proves no account, so stamping by handle
--     match would retire words the leaving account never wrote.
--
--     The leaderboard is the third public naming and needs no stamp, because
--     `public_contributor_leaderboard` already joins `profiles`: a tombstoned
--     profile leaves the named board, while every contribution behind it stays
--     in its own table, still shown, unnamed, on the pub's own sheet.
--
-- Rollback: rollback/20260906090000_0150_account_retention_ledger_rollback.sql
-- Proof: __tests__/accountRetentionLedgerMigrationEffective.test.ts
-- (PostgreSQL 16 carrying the storage delete guard replica 0145 is proved under).

begin;

create table if not exists public.account_retention_ledger (
  account_user_id uuid primary key,
  retired_handle text,
  profile_id uuid,
  deleted_at timestamptz not null default now(),
  pint_drop_ids uuid[] not null default '{}',
  visit_report_ids uuid[] not null default '{}',
  community_price_ids uuid[] not null default '{}',
  weather_recommendation_ids uuid[] not null default '{}',
  night_memory_ids uuid[] not null default '{}',
  night_moment_ids uuid[] not null default '{}',
  venue_photo_ids uuid[] not null default '{}'
);

comment on table public.account_retention_ledger is
  'One row per deleted PUBMAXX account: the retired handle and the ids of every contribution it made. Service role only. Deliberately un-indexed beyond its primary key: one row per departure is a small table, and an index per lane would be machinery over a sequential scan.';

alter table public.account_retention_ledger enable row level security;

revoke all on table public.account_retention_ledger from public, anon, authenticated;
grant select, insert, update, delete on table public.account_retention_ledger to service_role;

drop policy if exists account_retention_ledger_client_deny
  on public.account_retention_ledger;
create policy account_retention_ledger_client_deny
  on public.account_retention_ledger
  for all to anon, authenticated
  using (false) with check (false);

-- The stamp each public lane reads. Nullable and absent by default, so every
-- row written before this file reads as a live author, which it is.
alter table public.pint_drops
  add column if not exists author_retired_at timestamptz;
alter table public.structured_visit_reports
  add column if not exists author_retired_at timestamptz;
alter table public.weather_recommendations
  add column if not exists author_retired_at timestamptz;

comment on column public.pint_drops.author_retired_at is
  'When the account behind `handle` deleted itself. The drop keeps its price, its measure and its date and stays in every trust lane; only the name is withheld (lib/retiredContributor.ts).';

-- Restated whole, because `create or replace function` replaces the body and
-- drops any SET clause it does not carry: the `search_path` line is
-- load-bearing. Everything below the ledger and the stamps is 0145 unchanged.
create or replace function public.stamp_profile_tombstone_on_auth_user_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_handle text;
begin
  select p.id, p.handle
    into v_profile_id, v_handle
    from public.profiles p
   where p.user_id = old.id
   limit 1;

  -- FIRST, before anything of this account's is deleted: what it was, and what
  -- it logged. An account that claimed no handle still earns a row, because the
  -- captain's sentence remembers the ACCOUNT as well as the log.
  insert into public.account_retention_ledger as l (
    account_user_id,
    retired_handle,
    profile_id,
    deleted_at,
    pint_drop_ids,
    visit_report_ids,
    community_price_ids,
    weather_recommendation_ids,
    night_memory_ids,
    night_moment_ids,
    venue_photo_ids
  )
  values (
    old.id,
    v_handle,
    v_profile_id,
    now(),
    coalesce((select array_agg(d.id order by d.id) from public.pint_drops d
               where v_handle is not null and d.handle = v_handle), '{}'),
    coalesce((select array_agg(r.id order by r.id) from public.structured_visit_reports r
               where v_handle is not null and r.handle = v_handle), '{}'),
    coalesce((select array_agg(c.id order by c.id) from public.community_prices c
               where v_profile_id is not null and c.actor = 'profile:' || v_profile_id::text), '{}'),
    coalesce((select array_agg(w.id order by w.id) from public.weather_recommendations w
               where v_handle is not null and w.contributor_handle = v_handle), '{}'),
    coalesce((select array_agg(m.id order by m.id) from public.night_memories m
               where m.owner_id = old.id), '{}'),
    coalesce((select array_agg(mo.id order by mo.id) from public.night_moments mo
               where mo.owner_id = old.id), '{}'),
    coalesce((select array_agg(vp.id order by vp.id) from public.venue_photos vp
               where v_profile_id is not null and vp.author_profile_id = v_profile_id), '{}')
  )
  on conflict (account_user_id) do update
    set retired_handle = excluded.retired_handle,
        profile_id = excluded.profile_id,
        deleted_at = excluded.deleted_at,
        pint_drop_ids = excluded.pint_drop_ids,
        visit_report_ids = excluded.visit_report_ids,
        community_price_ids = excluded.community_price_ids,
        weather_recommendation_ids = excluded.weather_recommendation_ids,
        night_memory_ids = excluded.night_memory_ids,
        night_moment_ids = excluded.night_moment_ids,
        venue_photo_ids = excluded.venue_photo_ids
   where l.account_user_id = excluded.account_user_id;

  -- The name comes off the public lanes. The rows, their prices and their dates
  -- do not move, and no trust predicate reads this column.
  if v_handle is not null then
    update public.pint_drops
       set author_retired_at = coalesce(author_retired_at, now())
     where handle = v_handle;

    update public.structured_visit_reports
       set author_retired_at = coalesce(author_retired_at, now())
     where handle = v_handle;

    update public.weather_recommendations
       set author_retired_at = coalesce(author_retired_at, now())
     where contributor_handle = v_handle;
  end if;

  -- Wall photo ROWS. The objects they name were removed through the Storage
  -- API before this row delete ran; see 0145's header.
  delete from public.venue_photos vp
   using public.profiles p
   where p.id = vp.author_profile_id
     and p.user_id = old.id;

  -- The cover rotation's rows. The cascade on profiles would not fire (the
  -- profile row stays as a tombstone), so they are deleted explicitly.
  delete from public.profile_cover_photos c
   using public.profiles p
   where p.id = c.profile_id
     and p.user_id = old.id;

  -- Message photos: the columns that pointed at them. The message keeps its
  -- words. When it had none, one line says the photo is gone, because a blank
  -- bubble in somebody else's thread explains nothing and the content CHECK
  -- would refuse it anyway.
  update public.messages m
     set body = case when char_length(m.body) >= 1 then m.body else 'Photo removed.' end,
         attachment_kind = null,
         attachment_object_key = null,
         attachment_width = null,
         attachment_height = null,
         attachment_venue_id = null
    from public.profiles p
   where p.handle = m.sender_handle
     and p.user_id = old.id
     and m.attachment_kind is not null;

  -- The Social product account: suspended and unbound, kept for the Crew rows
  -- that reference it. `suspended` is the state every Social RPC refuses.
  update public.private_social_accounts
     set ownership_state = 'suspended',
         ownership_changed_at = now(),
         supabase_user_id = null,
         updated_at = now()
   where supabase_user_id = old.id;

  update public.profiles
     set tombstoned_at = coalesce(tombstoned_at, now()),
         avatar_url = null,
         avatar_object_key = null,
         avatar_generation = null,
         avatar_moderation_state = null,
         avatar_report_count = 0,
         avatar_reported_at = null,
         avatar_report_reason = null,
         avatar_report_actors = '{}'::text[],
         avatar_moderated_at = null,
         avatar_moderator_note = null,
         cover_object_key = null,
         cover_generation = null,
         cover_moderation_state = null,
         cover_report_count = 0,
         cover_reported_at = null,
         cover_report_reason = null,
         cover_report_actors = '{}'::text[],
         cover_moderated_at = null,
         cover_moderator_note = null,
         favourite_drink = null,
         interests = null,
         workplace = null,
         updated_at = now()
   where user_id = old.id;

  return old;
end;
$$;

revoke all on function public.stamp_profile_tombstone_on_auth_user_delete() from public, anon, authenticated;

-- The named board drops a retired contributor. Restated whole from 0079 with
-- one added predicate; `set search_path = ''` is why every name is qualified.
create or replace function public.public_contributor_leaderboard()
returns table (
  handle text,
  prices bigint,
  reviews bigint,
  recommendations bigint,
  total bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with visible_contributions as (
    select contributor_handle as handle, 'price'::text as lane,
           submitted_at as recorded_at
      from public.community_prices
     where contributor_handle is not null
       and hidden_at is null
    union all
    select handle, 'review'::text as lane,
           created_at as recorded_at
      from public.structured_visit_reports
     where status = 'visible'
    union all
    select contributor_handle as handle, 'recommendation'::text as lane,
           submitted_at as recorded_at
      from public.weather_recommendations
     where status = 'visible'
  ),
  canonical_contributions as (
    select profile.handle,
           contribution.lane
      from visible_contributions as contribution
      join public.profile_handle_aliases as alias
        on lower(alias.handle) = lower(contribution.handle)
       and contribution.recorded_at >= alias.claimed_at
      join public.profiles as profile
        on profile.id = alias.profile_id
       -- A retired account is not named on the public record board. Its
       -- contributions stay in their own tables, unnamed, where they were.
       and profile.tombstoned_at is null
  )
  select
    handle,
    count(*) filter (where lane = 'price') as prices,
    count(*) filter (where lane = 'review') as reviews,
    count(*) filter (where lane = 'recommendation') as recommendations,
    count(*) as total
  from canonical_contributions
  group by handle
  order by total desc, handle asc;
$$;

revoke all on function public.public_contributor_leaderboard() from public;
grant execute on function public.public_contributor_leaderboard() to service_role;

commit;
