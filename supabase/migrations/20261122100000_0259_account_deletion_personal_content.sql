-- 0259: An account's deletion removes its personal content (captain call K17).
-- Captain applies. Agents ship SQL only.
--
-- Deletion tombstones the profile row and never deletes it, so the cascades
-- from public.profiles never fire. Before this migration the trigger left the
-- account's Social posts, comments and quotes visible under its handle, kept
-- its saved pubs (shown on the public list page), its check-ins and its Pubs to
-- try list, and left the display name and the bio on the tombstone.
--
-- This restates the 0198 trigger and the shared interaction moderation functions.
-- Prices stay, with the handle taken off, as before. The service-only retention
-- ledger keeps its 0198 snapshot of the display name for Story departure redaction.
--
-- Additive for the app: no column, grant or policy changes. A deploy may run
-- before or after the apply.
--
-- Reverse: supabase/migrations/rollback/20261122100000_0259_account_deletion_personal_content_rollback.sql

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
  v_display_name text;
  v_handles text[];
begin
  select p.id, p.handle, p.display_name
    into v_profile_id, v_handle, v_display_name
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
    retired_display_name,
    retired_handles,
    night_story_ids,
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
    v_display_name,
    v_handles,
    coalesce((select array_agg(distinct linked.story_id order by linked.story_id)
      from (
        select c.story_id from public.night_story_contributors c
        where c.profile_id = old.id
        union
        select c.story_id from public.night_moment_consents c
        where c.owner_id = old.id
      ) linked), '{}'),
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
        retired_display_name = excluded.retired_display_name,
        retired_handles = excluded.retired_handles,
        night_story_ids = excluded.night_story_ids,
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

  -- Delete wall photo rows. The account route collects their object keys before
  -- deleting the auth user, then removes the bytes through Storage after success.
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

  -- K17: what the person wrote and kept leaves with the account. The profile
  -- row stays as a tombstone, so no cascade from it fires; each lane is ended
  -- here. Posts, comments and quotes read as removed, exactly as the author's
  -- own remove leaves them, so every reader and moderation lane that already
  -- refuses a removed row refuses these. The account route removes the photo
  -- bytes through Storage. Prices are not touched: they stay, with the handle
  -- taken off above.
  if v_profile_id is not null then
    update public.social_posts
       set status = 'removed',
           photo_media_id = null,
           photo_alt_text = null,
           mutation_version = mutation_version + 1,
           updated_at = now()
     where author_profile_id = v_profile_id
       and status <> 'removed';

    update public.social_comments
       set status = 'removed',
           updated_at = now()
     where author_profile_id = v_profile_id
       and status <> 'removed';

    update public.social_quotes
       set status = 'removed',
           updated_at = now()
     where author_profile_id = v_profile_id
       and status <> 'removed';

    delete from public.social_interaction_moderation_jobs
     where (content_kind = 'comment' and content_id in (
       select id from public.social_comments where author_profile_id = v_profile_id
     )) or (content_kind = 'quote' and content_id in (
       select id from public.social_quotes where author_profile_id = v_profile_id
     ));

    delete from public.saved_pubs where profile_id = v_profile_id;
    delete from public.saved_lists where profile_id = v_profile_id;
    delete from public.saved_list_follows where list_owner_profile_id = v_profile_id;
    delete from public.check_ins where author_id = v_profile_id;
    -- The Pubs to try list, keyed on the stable profile actor string.
    delete from public.wanteds where owner_actor = 'profile:' || v_profile_id::text;
  end if;

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
         display_name = null,
         bio = null,
         updated_at = now()
   where user_id = old.id;

  return old;
end;
$$;

create or replace function public.moderate_social_interaction(p_actor uuid, p_kind text, p_content_id uuid, p_action text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_staff public.private_social_staff_roles;
begin
  select * into v_staff from public.private_social_staff_roles where profile_id = p_actor and active and revoked_at is null and role = 'moderator';
  if v_staff.id is null then raise exception 'staff required'; end if;
  if p_action not in ('hide', 'restore') then raise exception 'invalid moderation action'; end if;
  if not exists (
    select 1 from public.social_content_reports report
    where report.content_kind = p_kind and report.content_id = p_content_id
      and report.state in ('queued', 'reviewing')
  ) then raise exception 'queued report required'; end if;
  if p_kind = 'comment' then
    update public.social_comments set status = case when p_action = 'hide' then 'hidden' else 'visible' end, updated_at = now() where id = p_content_id and status <> 'removed';
  elsif p_kind = 'quote' then
    update public.social_quotes set status = case when p_action = 'hide' then 'hidden' else 'visible' end, updated_at = now() where id = p_content_id and status <> 'removed';
  else raise exception 'invalid moderation kind'; end if;
  if not found then raise exception 'content not found'; end if;
  insert into public.social_moderation_actions(staff_role_id, content_kind, content_id, action)
  values (v_staff.id, p_kind, p_content_id, p_action);
  return true;
end;
$$;

create or replace function public.complete_social_interaction_moderation(p_kind text, p_content_id uuid, p_decision text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_id uuid;
  v_author uuid;
  v_recipient uuid;
begin
  if p_decision not in ('approved', 'needs_review') then raise exception 'invalid moderation decision'; end if;
  if p_kind = 'comment' then
    update public.social_comments
    set moderation_state = 'approved',
        status = case when p_decision = 'needs_review' then 'hidden' else status end,
        updated_at = now()
    where id = p_content_id and moderation_state = 'pending' and status <> 'removed'
    returning post_id, author_profile_id into v_post_id, v_author;
  elsif p_kind = 'quote' then
    update public.social_quotes
    set moderation_state = 'approved',
        status = case when p_decision = 'needs_review' then 'hidden' else status end,
        updated_at = now()
    where id = p_content_id and moderation_state = 'pending' and status <> 'removed'
    returning source_post_id, author_profile_id into v_post_id, v_author;
  else raise exception 'invalid moderation kind'; end if;
  if v_post_id is null then return false; end if;
  delete from public.social_interaction_moderation_jobs where content_kind = p_kind and content_id = p_content_id;
  if p_decision = 'approved' then
    select author_profile_id into v_recipient from public.social_posts where id = v_post_id;
    if v_recipient is not null and v_recipient <> v_author then
      insert into public.social_notifications(recipient_profile_id, actor_profile_id, kind, source_post_id, source_content_id)
      values (v_recipient, v_author, p_kind, v_post_id, p_content_id) on conflict do nothing;
    end if;
  end if;
  return true;
end;
$$;

commit;
