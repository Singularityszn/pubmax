-- Account deletion reaches every handle the account ever held (0180). Apply
-- AFTER 0156. Captain applies; agents ship SQL only.
--
-- Reverse: supabase/migrations/rollback/20261016110000_0180_account_deletion_every_handle_rollback.sql
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE FAULT (DB-3). 0150's tombstone trigger, as 0156 last restated it, asked
-- every handle-keyed lane for the CURRENT `profiles.handle` only. A handle is
-- text stamped on a row at write time and `rename_pubmaxx_handle` (latest in
-- 0177) never rewrites an authored row, so everything an account wrote before
-- a rename was invisible to its own deletion. Replayed on PostgreSQL 16: claim
-- `carla`, post a Pint Drop, rename to `carlb`, post another, delete the auth
-- user. The `carla` drop kept `author_retired_at = NULL`, so the retired name
-- stayed printed on the public sheet, and the `account_retention_ledger` row
-- recorded ONE drop of the two. The same gap left the old-handle rows in
-- `structured_visit_reports` and `weather_recommendations` unstamped and
-- unrecorded, a group seat taken under the old handle LIVE (so a departed
-- account kept being read new messages), and a poll answer given under the old
-- handle in the table under a retired name.
--
-- THE FIX. One array, `v_handles`: the current handle as stored, its lower-case
-- form, and every `profile_handle_aliases.handle` the profile has held (0029
-- keeps those lower case by CHECK). Every lane, the ledger arrays AND the
-- stamps AND the seat AND the vote, matches `= any(v_handles)`. The current
-- handle as stored is kept in the array so no row the 0156 body matched is
-- matched less.
--
-- WHY AN ALIAS MAY BE MATCHED WITHOUT A DATE WINDOW. `rename_pubmaxx_handle`
-- and `claim_pubmaxx_handle` refuse any handle already in
-- `profile_handle_aliases`, in any letter case, so a retired handle is never
-- re-issued: after the alias row exists nobody else can author under it. The
-- leaderboard (0150) also bounds a contribution by `claimed_at`; this trigger
-- deliberately does not, because 0029 back-filled aliases with
-- `claimed_at = now()` at apply time, and a profile older than 0029 that later
-- renamed would have every pre-0029 row under its first handle silently
-- excluded from its own deletion. That is the fault this file exists to close,
-- and the current handle has always been matched unbounded too.
--
-- THE SPEED HALF (DB-4). The deletion runs while the auth delete holds its
-- locks, so a sequential scan here is a scan of `messages` under a held row.
--   • `conversation_members`: the seat update now says `left_at is null`, the
--     only rows it ever changed, so it reads 0155's partial
--     `conversation_members_handle_idx`; `handle` is lower case by 0155's CHECK
--     so no `lower()` is spent on the column.
--   • `messages`: the `sender_profile_id = … OR lower(sender_handle) = …` is
--     split into two UPDATEs, so the first reads 0151's
--     `messages_sender_profile_idx` and the second a new partial expression
--     index on `lower(sender_handle)` over the rows that carry an attachment.
--     `sender_handle` carries no lower-case CHECK, so `lower()` stays.
--   • `message_poll_votes`: the primary key leads with `message_id`, so the
--     voter delete gets its own `lower(voter_handle)` index (no CHECK there
--     either).
--   • Four foreign keys to `auth.users` with no covering index, each walked by
--     the cascade on the very delete this trigger rides:
--     `night_stories.host_editor_id` (also read by four RLS predicates),
--     `night_story_publish_proposals.requested_by`,
--     `venue_occupancy_reports.reporter_user_id`, `social_oauth_states.owner_id`.
-- Plain `create index if not exists` inside the transaction, the 0159 pattern:
-- `concurrently` cannot run in a transaction block, and every one of these
-- tables is small enough on production that the brief build lock is the
-- cheaper risk than a half-applied file.
--
-- WHY THE FUNCTION IS RESTATED WHOLE. `create or replace function` replaces the
-- body and drops any SET clause it does not carry, so `security definer` and
-- `set search_path` are restated. Everything but the matching is 0156's text,
-- unchanged: the ledger written FIRST, 0145's rule that no storage delete lives
-- in this trigger, every attachment column 0156 clears, the Social account
-- suspension and the profile scrub.

begin;

create or replace function public.stamp_profile_tombstone_on_auth_user_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_handle text;
  v_handles text[];
begin
  select p.id, p.handle
    into v_profile_id, v_handle
    from public.profiles p
   where p.user_id = old.id
   limit 1;

  -- EVERY handle this account has held: the current one as stored, its lower
  -- case, and every alias. A retired handle is never re-issued (the claim and
  -- rename RPCs refuse anything already in profile_handle_aliases), so each of
  -- these can only ever name this account's own rows.
  select coalesce(array_agg(distinct h.handle), '{}'::text[])
    into v_handles
    from (
      select v_handle as handle where v_handle is not null
      union
      select lower(v_handle) where v_handle is not null
      union
      select lower(a.handle)
        from public.profile_handle_aliases a
       where v_profile_id is not null
         and a.profile_id = v_profile_id
    ) h;

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
               where d.handle = any(v_handles)), '{}'),
    coalesce((select array_agg(r.id order by r.id) from public.structured_visit_reports r
               where r.handle = any(v_handles)), '{}'),
    coalesce((select array_agg(c.id order by c.id) from public.community_prices c
               where v_profile_id is not null and c.actor = 'profile:' || v_profile_id::text), '{}'),
    coalesce((select array_agg(w.id order by w.id) from public.weather_recommendations w
               where w.contributor_handle = any(v_handles)), '{}'),
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

  -- The name comes off the public lanes, under every handle it was written
  -- under. The rows, their prices and their dates do not move, and no trust
  -- predicate reads this column.
  if cardinality(v_handles) > 0 then
    update public.pint_drops
       set author_retired_at = coalesce(author_retired_at, now())
     where handle = any(v_handles);

    update public.structured_visit_reports
       set author_retired_at = coalesce(author_retired_at, now())
     where handle = any(v_handles);

    update public.weather_recommendations
       set author_retired_at = coalesce(author_retired_at, now())
     where contributor_handle = any(v_handles);
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

  -- A group seat is a LIVE membership, so it ends with the account: a departed
  -- handle stops being read a new message. The words they wrote stay in the
  -- thread, exactly as their side of a DM does. A seat taken under an older
  -- handle is still this person's seat. `handle` is lower case by 0155's CHECK,
  -- and `left_at is null` is both the only rows this ever changed and the
  -- predicate of the partial index that serves it.
  if cardinality(v_handles) > 0 then
    update public.conversation_members
       set left_at = coalesce(left_at, now())
     where handle = any(v_handles)
       and left_at is null;
  end if;

  -- A poll answer is a fact about a PERSON, not a fact about the thread, and it
  -- is keyed on the handle that gave it. So it leaves with the account rather
  -- than sitting in the table under a retired name: the tally drops by one,
  -- which is the truth, because the person who said it is gone. A retired
  -- handle is never re-issued, so this can only ever match this account.
  if cardinality(v_handles) > 0 then
    delete from public.message_poll_votes
     where lower(voter_handle) = any(v_handles);
  end if;

  -- Message attachments: the columns that pointed at them. The message keeps
  -- its words. When it had none, one line says the attachment is gone, because
  -- a blank bubble in somebody else's thread explains nothing and the content
  -- CHECK would refuse it anyway.
  --
  -- BOTH IDENTITIES, as two statements so each reads its own index rather than
  -- an OR that reads neither. The profile one is why a renamed account's older
  -- attachments leave with it (F-4); the handle one is kept for a row the 0151
  -- backfill could not resolve, and now asks every handle the account held.
  if v_profile_id is not null then
    update public.messages m
       set body = case when char_length(m.body) >= 1 then m.body else 'Attachment removed.' end,
           attachment_kind = null,
           attachment_object_key = null,
           attachment_width = null,
           attachment_height = null,
           attachment_venue_id = null,
           attachment_contact_handle = null,
           attachment_plan_id = null,
           attachment_poll_question = null,
           attachment_poll_options = null
     where m.attachment_kind is not null
       and m.sender_profile_id = v_profile_id;
  end if;

  if cardinality(v_handles) > 0 then
    update public.messages m
       set body = case when char_length(m.body) >= 1 then m.body else 'Attachment removed.' end,
           attachment_kind = null,
           attachment_object_key = null,
           attachment_width = null,
           attachment_height = null,
           attachment_venue_id = null,
           attachment_contact_handle = null,
           attachment_plan_id = null,
           attachment_poll_question = null,
           attachment_poll_options = null
     where m.attachment_kind is not null
       and lower(m.sender_handle) = any(v_handles);
  end if;

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

-- ── DB-4: the indexes the deletion reads ────────────────────────────────────
-- The handle half of the message update: only rows with an attachment are ever
-- touched, so the index covers only those.
create index if not exists messages_sender_handle_lower_attachment_idx
  on public.messages (lower(sender_handle))
  where attachment_kind is not null;

-- The voter delete. The primary key (message_id, voter_handle) cannot serve a
-- lookup by voter alone.
create index if not exists message_poll_votes_voter_handle_lower_idx
  on public.message_poll_votes (lower(voter_handle));

-- Foreign keys to auth.users with no covering index; the cascade from the auth
-- delete walks each of them.
create index if not exists night_stories_host_editor_idx
  on public.night_stories (host_editor_id);
create index if not exists night_story_publish_proposals_requested_by_idx
  on public.night_story_publish_proposals (requested_by);
create index if not exists venue_occupancy_reports_reporter_user_idx
  on public.venue_occupancy_reports (reporter_user_id);
create index if not exists social_oauth_states_owner_idx
  on public.social_oauth_states (owner_id);

commit;
