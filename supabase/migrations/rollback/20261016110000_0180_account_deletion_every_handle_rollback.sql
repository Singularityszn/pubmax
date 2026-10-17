-- Rollback for 0180 (account deletion reaches every handle the account held).
--
-- WHAT THIS COSTS. From the moment this runs, an account that renamed and then
-- leaves takes only its CURRENT handle with it again: rows written under an
-- older handle keep that retired name printed on the public sheet with no
-- `author_retired_at` stamp, the retention ledger records only the rows under
-- the current handle, a group seat taken under an older handle stays live, and
-- a poll answer given under one stays in the table. Stamps, ledger rows, seats
-- and votes 0180 already wrote are NOT reverted, because un-stamping a departed
-- account's name to undo a true statement would republish it.
--
-- WHAT IT RESTORES. 0156's tombstone function, byte for byte, and the planner
-- without the six indexes 0180 added (the deletion and the auth cascade read
-- sequentially again). No row data moves.

begin;

drop index if exists public.social_oauth_states_owner_idx;
drop index if exists public.venue_occupancy_reports_reporter_user_idx;
drop index if exists public.night_story_publish_proposals_requested_by_idx;
drop index if exists public.night_stories_host_editor_idx;
drop index if exists public.message_poll_votes_voter_handle_lower_idx;
drop index if exists public.messages_sender_handle_lower_attachment_idx;

-- 0156's body exactly as it stood, `security definer` and `search_path`
-- included.
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

  -- A poll answer is a fact about a PERSON, not a fact about the thread, and it
  -- is keyed on the handle that gave it. So it leaves with the account rather
  -- than sitting in the table under a retired name: the tally drops by one,
  -- which is the truth, because the person who said it is gone. A retired
  -- handle is never re-issued, so this can only ever match this account.
  if v_handle is not null then
    delete from public.message_poll_votes
     where lower(voter_handle) = lower(v_handle);
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
