-- Rollback 0145: put the tombstone trigger back to migration 0102's shape and
-- the Social account binding back to `on delete restrict`.
--
-- Say what this restores: a trigger that deletes from `storage.objects`
-- directly, which Supabase's statement-level `protect_objects_delete` guard
-- refuses with SQLSTATE 42501 on every project that carries it (measured
-- 5 September 2026). Under that guard the restored trigger makes EVERY
-- account deletion fail again. This file exists so the schema decision can be
-- reversed; it is not a working account-removal path on a guarded project.
--
-- A Social account the forward migration suspended and unbound stays
-- suspended with a null `supabase_user_id`: the restrict FK admits a null, and
-- the auth row it named is gone. Nothing here rebinds or deletes it.

begin;

alter table public.private_social_accounts
  drop constraint if exists private_social_accounts_supabase_user_id_fkey;

alter table public.private_social_accounts
  add constraint private_social_accounts_supabase_user_id_fkey
  foreign key (supabase_user_id) references auth.users(id) on delete restrict;

-- 0102's trigger body, restored verbatim.
create or replace function public.stamp_profile_tombstone_on_auth_user_delete()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  delete from storage.objects o
   using public.profiles p
   where p.user_id = old.id
     and o.bucket_id = 'pint-drops'
     and (
       o.name like ('avatars/' || p.id::text || '/%')
       or o.name like ('covers/' || p.id::text || '/%')
     );

  -- Wall photos are keyed by VENUE, not by profile, so the objects are found
  -- through the rows rather than through a key prefix.
  delete from storage.objects o
   using public.venue_photos vp
   join public.profiles p on p.id = vp.author_profile_id
   where p.user_id = old.id
     and o.bucket_id = 'pint-drops'
     and (o.name = vp.object_key or o.name = replace(vp.object_key, '.jpg', '.staging.jpg'));

  delete from public.venue_photos vp
   using public.profiles p
   where p.id = vp.author_profile_id
     and p.user_id = old.id;

  -- The rotation's rows. The cascade on profiles would not fire (the profile
  -- row stays as a tombstone), so they are deleted explicitly, exactly like the
  -- wall photos above.
  delete from public.profile_cover_photos c
   using public.profiles p
   where p.id = c.profile_id
     and p.user_id = old.id;

  -- Message photos: the bytes, then the columns that pointed at them.
  delete from storage.objects o
   using public.messages m
   join public.profiles p on p.handle = m.sender_handle
   where p.user_id = old.id
     and m.attachment_object_key is not null
     and o.bucket_id = 'pint-drops'
     and (
       o.name = m.attachment_object_key
       or o.name = replace(m.attachment_object_key, '.jpg', '.staging.jpg')
     );

  -- The message keeps its words. When it had none, one line says the photo is
  -- gone, because a blank bubble in somebody else's thread explains nothing and
  -- the content CHECK above would refuse it anyway.
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
