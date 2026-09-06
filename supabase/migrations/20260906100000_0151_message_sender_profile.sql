-- 0151: a message names its sender by PROFILE, so renaming cannot hide a photo
-- from the account's own deletion.
--
-- Review finding F-4 (5 September 2026). Both halves of account deletion joined
-- messages on the CURRENT handle: `lib/accountDeletion.server.ts` read
-- `messages.attachment_object_key where sender_handle = <handle>`, and 0145's
-- tombstone trigger (as restated by 0150) cleared the attachment columns
-- `where p.handle = m.sender_handle`. `sender_handle` is TEXT stamped at send
-- time (0019), renaming is a live feature once every 30 days
-- (`app/api/identity/handle/rename/route.ts`), and nothing in the rename path
-- touches `messages`. So an account that had ever renamed deleted itself and
-- left every photo it sent under an older handle in the bucket, with the
-- `attachment_object_key` column still pointing at it: the other participant
-- could still fetch it through `lib/messagePhotoServe.server.ts` after the
-- sender was tombstoned. `AGENTS.md` and 0145's own header both say the
-- account's message photos leave with it; for a renamed account that was false.
--
-- THREE CHANGES.
--
-- (1) `messages.sender_profile_id` is the identity that cannot be renamed, and
--     it is STAMPED BY THE DATABASE. A BEFORE INSERT trigger resolves it from
--     `profile_handle_aliases`, the table that already remembers every handle a
--     profile has ever held. The app is not asked to carry it: the send path
--     knows only the handle, and a lookup there would be a network round trip
--     on the hottest write in the product, where this is an index probe inside
--     the same transaction. It also means the memory-store lane, this backfill
--     and any future writer agree by construction.
--
--     NO FOREIGN KEY, deliberately. The value can only ever come from an alias
--     row, and `profile_handle_aliases.profile_id` already references
--     `public.profiles(id) on delete cascade`, so the relationship is enforced
--     one table up. What an FK would add here is a per-INSERT check on the
--     messaging hot path for a guarantee that is already held.
--
-- (2) THE BACKFILL reads the alias table, so every message already sent under a
--     retired handle gains its author. A row whose `sender_handle` matches no
--     alias at all keeps a null and stays reachable by the handle match below.
--
-- (3) THE TOMBSTONE TRIGGER ASKS BOTH, and the union is the point: a message is
--     the leaving account's when its `sender_profile_id` is that profile OR its
--     `sender_handle` is that account's current handle. The second half is what
--     the trigger did before, kept so nothing that was covered stops being
--     covered by a row the backfill could not resolve. It cannot reach another
--     account's rows: `profile_handle_aliases_handle_lower_unique` on
--     `lower(handle)` keeps a retired handle unclaimable, and 0078 keeps the
--     profile row, so a handle is never re-issued.
--
-- Rollback: rollback/20260906100000_0151_message_sender_profile_rollback.sql
-- Proof: __tests__/accountRemovalMigrationEffective.test.ts (PostgreSQL 16 under
-- the storage delete guard replica, with an account that renamed).

begin;

alter table public.messages
  add column if not exists sender_profile_id uuid;

comment on column public.messages.sender_profile_id is
  'The profile that sent this message, stamped from profile_handle_aliases on insert. sender_handle is text captured at send time and a rename does not rewrite it, so this is the identity account deletion joins on (0151).';

-- The deletion read is `where sender_profile_id = <profile>`; nothing else
-- reads this column, so the index is partial on the rows that carry one.
create index if not exists messages_sender_profile_idx
  on public.messages (sender_profile_id)
  where sender_profile_id is not null;

-- Every message already sent, including under a handle its author has retired.
update public.messages m
   set sender_profile_id = a.profile_id
  from public.profile_handle_aliases a
 where m.sender_profile_id is null
   and lower(a.handle) = lower(m.sender_handle);

create or replace function public.stamp_message_sender_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A writer that already knows the profile keeps its answer; nothing in the
  -- app sets it today, and the alias lookup is one index probe on
  -- `profile_handle_aliases_handle_lower_unique`.
  if new.sender_profile_id is null then
    select a.profile_id
      into new.sender_profile_id
      from public.profile_handle_aliases a
     where lower(a.handle) = lower(new.sender_handle)
     limit 1;
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_message_sender_profile() from public, anon, authenticated;

drop trigger if exists messages_stamp_sender_profile on public.messages;
create trigger messages_stamp_sender_profile
before insert on public.messages
for each row execute function public.stamp_message_sender_profile();

-- Restated whole, because `create or replace function` replaces the body and
-- drops any SET clause it does not carry: the `search_path` line is
-- load-bearing. Everything but the message update is 0150 unchanged.
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
  --
  -- BOTH IDENTITIES, and the profile one is why a renamed account's older
  -- photos leave with it (F-4). The handle half is kept for a row the 0151
  -- backfill could not resolve; it can only ever match this account, because a
  -- retired handle is never re-issued.
  update public.messages m
     set body = case when char_length(m.body) >= 1 then m.body else 'Photo removed.' end,
         attachment_kind = null,
         attachment_object_key = null,
         attachment_width = null,
         attachment_height = null,
         attachment_venue_id = null
   where m.attachment_kind is not null
     and (
       (v_profile_id is not null and m.sender_profile_id = v_profile_id)
       or (v_handle is not null and lower(m.sender_handle) = lower(v_handle))
     );

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

commit;
