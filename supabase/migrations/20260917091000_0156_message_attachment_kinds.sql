-- Message attachment kinds: contact, event, poll (0156). Apply AFTER 0155.
-- Captain applies; agents ship SQL only.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT A ROW GAINS. 0102 closed the attachment set at two, `photo` and `venue`,
-- and this widens it to five. The consistency CHECK below is the database
-- saying the same sentence `lib/messageAttachments.ts` says: each kind owns its
-- own columns and nothing else's, and a plain message carries none of them.
--
-- WHAT EACH NEW KIND STORES, AND WHAT IT DELIBERATELY DOES NOT.
--
--   • contact — ONE HANDLE. Not a name, not a face, not a city. The card is
--     resolved on the read path, so a rename reads correctly in a message from
--     last month and a tombstoned account resolves to nothing rather than to
--     the name it retired. What may then be PRINTED is the public profile and
--     nothing else: passing somebody's handle on in a message may not be a way
--     around the owner-authenticated read.
--
--   • event — ONE PLAN ID. Not a stop, not a venue, not a time. The card is the
--     plan's ANONYMOUS preview (buildPlanPrivacyPreview), because a message is
--     not a capability: the route, the stops and the crew stay behind the
--     reader's OWN capability at /plan/<id>.
--
--   • poll — ITS OWN BALLOT, and nothing about who answered. Counts are DERIVED
--     on every read from public.message_poll_votes, never stored in a column,
--     for the reason the corroboration count is derived on the price read path:
--     a tally written into a row is a number that can disagree with the votes
--     behind it.
--
-- NO COORDINATE IS STORED HERE, by any kind. 0102's rule about a pub card is
-- the rule for all of them, and the viewer-coordinate egress law (lib/geo.ts)
-- is untouched by design.
--
-- WHY THE TOMBSTONE FUNCTION IS RESTATED. 0102's trigger clears the attachment
-- columns it knew about when an account leaves. With three more columns, a
-- departing account would leave a row whose `kind` is null and whose contact
-- handle is not, which the shape CHECK refuses — so the same statement clears
-- all of them. `create or replace function` also drops any SET clause it does
-- not carry, so the `search_path` line below is load-bearing.
--
-- RLS. Unchanged and deliberately stricter than the social tables:
-- public.messages keeps RLS-on with the two participant policies 0066 added.
-- The votes table is stricter STILL, because it is the one row in messaging
-- that names a person against an answer: a signed-in caller may SELECT only
-- THEIR OWN vote, anon may do nothing, and every write goes through the service
-- role. The counts are folded service-side and cross the wire without a name.
--
-- Reverse: supabase/migrations/rollback/20260917091000_0156_message_attachment_kinds_rollback.sql

begin;

alter table public.messages
  add column if not exists attachment_contact_handle text,
  add column if not exists attachment_plan_id        uuid,
  add column if not exists attachment_poll_question  text,
  add column if not exists attachment_poll_options   jsonb;

comment on column public.messages.attachment_kind is
  'photo | venue | contact | event | poll | null. The closed set in lib/messageAttachments.ts.';
comment on column public.messages.attachment_contact_handle is
  'Handle of a shared contact. No name, face or private field is stored; the public card is resolved on the read path.';
comment on column public.messages.attachment_plan_id is
  'Plan id of a shared night. No stop, venue or time is stored; the card is the plan''s anonymous preview.';
comment on column public.messages.attachment_poll_options is
  'The ballot, as a JSON array of 2 to 6 strings. Counts are never stored here; they are folded from public.message_poll_votes on read.';

alter table public.messages drop constraint if exists messages_attachment_kind_chk;
alter table public.messages
  add constraint messages_attachment_kind_chk
  check (
    attachment_kind is null
    or attachment_kind in ('photo', 'venue', 'contact', 'event', 'poll')
  );

-- Each kind owns its own columns, and nothing else's. Restated whole rather
-- than extended, because the photo and venue arms have to say the new columns
-- are null too or a photo row could smuggle a plan id.
--
-- EVERY ARM ASKS `is not distinct from`, AND THAT IS THE LOAD-BEARING PART. An
-- arm written `attachment_kind = 'photo'` answers NULL on a row whose kind is
-- null, and `false or null` is NULL, and a CHECK that evaluates to NULL PASSES.
-- So the first arm — the one that says a plain message carries no attachment
-- column at all — never fired: a row could keep a contact handle, a plan id or
-- a ballot beside a null kind, invisible to every reader and untouched by the
-- tombstone below (which only looks at rows whose kind is not null). `is not
-- distinct from` answers false rather than NULL, so the first arm decides.
alter table public.messages drop constraint if exists messages_attachment_shape_chk;
alter table public.messages
  add constraint messages_attachment_shape_chk
  check (
    (
      attachment_kind is null
      and attachment_object_key is null
      and attachment_width is null
      and attachment_height is null
      and attachment_venue_id is null
      and attachment_contact_handle is null
      and attachment_plan_id is null
      and attachment_poll_question is null
      and attachment_poll_options is null
    )
    or (
      attachment_kind is not distinct from 'photo'
      and attachment_object_key is not null
      and attachment_width is not null
      and attachment_height is not null
      and attachment_venue_id is null
      and attachment_contact_handle is null
      and attachment_plan_id is null
      and attachment_poll_question is null
      and attachment_poll_options is null
    )
    or (
      attachment_kind is not distinct from 'venue'
      and attachment_venue_id is not null
      and attachment_object_key is null
      and attachment_width is null
      and attachment_height is null
      and attachment_contact_handle is null
      and attachment_plan_id is null
      and attachment_poll_question is null
      and attachment_poll_options is null
    )
    or (
      attachment_kind is not distinct from 'contact'
      and attachment_contact_handle is not null
      and attachment_object_key is null
      and attachment_width is null
      and attachment_height is null
      and attachment_venue_id is null
      and attachment_plan_id is null
      and attachment_poll_question is null
      and attachment_poll_options is null
    )
    or (
      attachment_kind is not distinct from 'event'
      and attachment_plan_id is not null
      and attachment_object_key is null
      and attachment_width is null
      and attachment_height is null
      and attachment_venue_id is null
      and attachment_contact_handle is null
      and attachment_poll_question is null
      and attachment_poll_options is null
    )
    or (
      attachment_kind is not distinct from 'poll'
      and attachment_poll_question is not null
      and attachment_poll_options is not null
      and attachment_object_key is null
      and attachment_width is null
      and attachment_height is null
      and attachment_venue_id is null
      and attachment_contact_handle is null
      and attachment_plan_id is null
    )
  );

-- Mirrors the handle alphabet (migration 0029) and the caps in
-- lib/messagePoll.ts. Keep each in lockstep with its TypeScript half.
alter table public.messages drop constraint if exists messages_attachment_contact_handle_chk;
alter table public.messages
  add constraint messages_attachment_contact_handle_chk
  check (
    attachment_contact_handle is null
    or (
      attachment_contact_handle ~ '^[a-z0-9_]{1,30}$'
    )
  );

alter table public.messages drop constraint if exists messages_attachment_poll_chk;
alter table public.messages
  add constraint messages_attachment_poll_chk
  check (
    attachment_poll_question is null
    or (
      char_length(attachment_poll_question) between 1 and 120
      and jsonb_typeof(attachment_poll_options) = 'array'
      and jsonb_array_length(attachment_poll_options) between 2 and 6
    )
  );

-- ── message_poll_votes ───────────────────────────────────────────────────────
-- ONE PERSON IS ONE VOTE, and the primary key is what says so: re-answering
-- replaces rather than adds, so a result can never carry more votes than the
-- thread has people. The row names a voter because it has to be keyed on one;
-- nothing ever reads that name back out to anybody, including the poll's own
-- author (lib/messagePoll.ts rule 2).
create table if not exists public.message_poll_votes (
  message_id   uuid not null references public.messages (id) on delete cascade,
  voter_handle text not null,
  option_index integer not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (message_id, voter_handle)
);

comment on table public.message_poll_votes is
  'One vote per person per poll. Counts are folded from here on every read; no voter is ever named back to a reader.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'message_poll_votes_option_chk'
  ) then
    alter table public.message_poll_votes
      add constraint message_poll_votes_option_chk
      check (option_index between 0 and 5);
  end if;
end $$;

-- The hot read: every vote on the polls in one thread.
create index if not exists message_poll_votes_message_idx
  on public.message_poll_votes (message_id);

alter table public.message_poll_votes enable row level security;

grant select on table public.message_poll_votes to authenticated;
grant select, insert, update, delete on table public.message_poll_votes to service_role;

-- A VOTE IS READABLE TO THE PERSON WHO CAST IT, AND TO NOBODY ELSE.
--
-- The thread predicate alone is NOT enough here, and it is the one place in
-- this wave where it is not. Every other messaging row says something the whole
-- thread is entitled to; this row names a voter, and rule 2 in
-- `lib/messagePoll.ts` says no voter is ever named to anybody — including the
-- poll's own author. A policy that admitted every participant would hand a
-- browser holding an ordinary `authenticated` key one request
-- (`/rest/v1/message_poll_votes?message_id=eq.<id>`) that reads the ballot back
-- by name, and the TypeScript that folds the counts would be the only thing
-- standing in front of it. So the predicate asks BOTH: the thread must be the
-- caller's, AND the row must be the caller's own vote, through the same
-- `rls_owns_handle` every handle question in this schema goes through.
--
-- The COUNTS are unaffected: they are folded by the service role in
-- `lib/messagesStore.ts`, which does not read through a policy at all.
drop policy if exists message_poll_votes_participant_select on public.message_poll_votes;
create policy message_poll_votes_participant_select
  on public.message_poll_votes
  for select
  to authenticated
  using (
    pubmax_private.rls_owns_handle(voter_handle)
    and exists (
      select 1
      from public.messages m
      where m.id = public.message_poll_votes.message_id
        and pubmax_private.rls_is_conversation_participant(m.conversation_id)
    )
  );

drop policy if exists message_poll_votes_anon_deny on public.message_poll_votes;
create policy message_poll_votes_anon_deny
  on public.message_poll_votes
  for all
  to anon
  using (false)
  with check (false);

-- ── Tombstone: EVERY attachment column, not the two 0102 knew about ──────────
-- Restated WHOLE because `create or replace function` replaces the whole body
-- and drops any SET clause it does not carry: the `search_path` line is
-- load-bearing, not decoration. Everything but the message update below is
-- 0151's own text, unchanged — including 0145's rule that no storage delete
-- lives in this trigger and 0150's retention ledger.
--
-- The message update is what has to move: a departing account's contact, event
-- or poll attachment would be left with a null `kind` and a non-null column
-- beside it, which the shape CHECK above refuses, so the account deletion
-- itself would fail.
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

  -- A group seat is a LIVE membership, so it ends with the account: a departed
  -- handle stops being read a new message. The words they wrote stay in the
  -- thread, exactly as their side of a DM does.
  if v_handle is not null then
    update public.conversation_members
       set left_at = coalesce(left_at, now())
     where lower(handle) = lower(v_handle);
  end if;

  -- Message attachments: the columns that pointed at them. The message keeps
  -- its words. When it had none, one line says the attachment is gone, because
  -- a blank bubble in somebody else's thread explains nothing and the content
  -- CHECK would refuse it anyway.
  --
  -- BOTH IDENTITIES, and the profile one is why a renamed account's older
  -- attachments leave with it (F-4). The handle half is kept for a row the 0151
  -- backfill could not resolve; it can only ever match this account, because a
  -- retired handle is never re-issued.
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
