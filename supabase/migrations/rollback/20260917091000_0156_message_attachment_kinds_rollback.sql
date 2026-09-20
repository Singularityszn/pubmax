-- Rollback for 0156 (contact, event and poll attachments).
--
-- WHAT THIS COSTS. Every contact card, plan card and poll anybody sent, and
-- every answer anybody gave to a poll. The columns go, so the rows that carried
-- one keep their WORDS and lose what rode with them; a message that was ONLY an
-- attachment would fail 0102's content CHECK with nothing left, so it is given
-- the same one line the tombstone gives a stripped attachment rather than being
-- deleted. Photos and pub cards are untouched.
--
-- WHAT IT RESTORES. 0102's two-kind closed set, its shape CHECK, and 0151's
-- tombstone function exactly as it stood before 0156 widened the message
-- update.

begin;

-- Say what the row was, before the columns that said it are dropped.
--
-- THE COLUMNS GO NULL IN THE SAME STATEMENT AS THE KIND, because 0156's shape
-- CHECK is still on the table at this point and its first arm says a row with
-- no kind carries no attachment column either. Clearing the kind alone leaves a
-- contact handle, a plan id or a ballot beside a null kind and the CHECK
-- refuses the update, which would take the whole rollback with it.
update public.messages
   set body = case when char_length(body) >= 1 then body else 'Attachment removed.' end,
       attachment_kind = null,
       attachment_contact_handle = null,
       attachment_plan_id = null,
       attachment_poll_question = null,
       attachment_poll_options = null
 where attachment_kind in ('contact', 'event', 'poll');

drop policy if exists message_poll_votes_participant_select on public.message_poll_votes;
drop policy if exists message_poll_votes_anon_deny on public.message_poll_votes;
drop table if exists public.message_poll_votes;

alter table public.messages drop constraint if exists messages_attachment_shape_chk;
alter table public.messages drop constraint if exists messages_attachment_kind_chk;
alter table public.messages drop constraint if exists messages_attachment_contact_handle_chk;
alter table public.messages drop constraint if exists messages_attachment_poll_chk;

alter table public.messages
  drop column if exists attachment_contact_handle,
  drop column if exists attachment_plan_id,
  drop column if exists attachment_poll_question,
  drop column if exists attachment_poll_options;

alter table public.messages
  add constraint messages_attachment_kind_chk
  check (attachment_kind is null or attachment_kind in ('photo', 'venue'));

alter table public.messages
  add constraint messages_attachment_shape_chk
  check (
    (
      attachment_kind is null
      and attachment_object_key is null
      and attachment_width is null
      and attachment_height is null
      and attachment_venue_id is null
    )
    or (
      attachment_kind = 'photo'
      and attachment_object_key is not null
      and attachment_width is not null
      and attachment_height is not null
      and attachment_venue_id is null
    )
    or (
      attachment_kind = 'venue'
      and attachment_venue_id is not null
      and attachment_object_key is null
      and attachment_width is null
      and attachment_height is null
    )
  );

comment on column public.messages.attachment_kind is
  'photo | venue | null. The closed set in lib/messageAttachments.ts.';

-- 0151's function, verbatim: the message update names the five columns that
-- exist again, and the conversation_members line 0156 added goes with the
-- columns it was written beside. 0155's rollback is what removes that table.
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

  delete from public.venue_photos vp
   using public.profiles p
   where p.id = vp.author_profile_id
     and p.user_id = old.id;

  delete from public.profile_cover_photos c
   using public.profiles p
   where p.id = c.profile_id
     and p.user_id = old.id;

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
