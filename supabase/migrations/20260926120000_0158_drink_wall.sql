-- Drink Wall (0158): extend venue_photos with wall categories and optional pub link.
-- Captain / firstmate applies. Agents ship SQL only.

begin;

alter table public.venue_photos
  add column if not exists wall_category text not null default 'pint';

alter table public.venue_photos
  add column if not exists place_label text not null default '';

alter table public.venue_photos alter column venue_id drop not null;

alter table public.venue_photos drop constraint if exists venue_photos_wall_category_check;
alter table public.venue_photos
  add constraint venue_photos_wall_category_check
  check (wall_category in ('pint', 'london', 'pub'));

alter table public.venue_photos drop constraint if exists venue_photos_place_label_check;
alter table public.venue_photos
  add constraint venue_photos_place_label_check
  check (char_length(place_label) <= 80);

alter table public.venue_photos drop constraint if exists venue_photos_category_venue_check;
alter table public.venue_photos
  add constraint venue_photos_category_venue_check
  check (
    (wall_category in ('pint', 'pub') and venue_id is not null)
    or (wall_category = 'london')
  );

alter table public.venue_photos drop constraint if exists venue_photos_object_key_check;
alter table public.venue_photos
  add constraint venue_photos_object_key_check
  check (
    (venue_id is not null and object_key = ('venue-photos/' || venue_id || '/' || id::text || '.jpg'))
    or (venue_id is null and object_key = ('drink-wall/' || id::text || '.jpg'))
  );

create index if not exists venue_photos_drink_wall_idx
  on public.venue_photos (wall_category, created_at desc, id desc)
  where moderation_state = 'approved';

create index if not exists venue_photos_drink_wall_author_idx
  on public.venue_photos (author_profile_id)
  where moderation_state = 'approved' and venue_id is null;

drop policy if exists venue_photos_public_select on public.venue_photos;
create policy venue_photos_public_select on public.venue_photos
  for select to anon, authenticated
  using (moderation_state = 'approved');

drop policy if exists venue_photos_owner_insert on public.venue_photos;
create policy venue_photos_owner_insert on public.venue_photos
  for insert to authenticated
  with check (
    author_profile_id = (
      select p.id from public.profiles p
      where p.user_id = auth.uid() and p.tombstoned_at is null
      limit 1
    )
    and author_actor = ('profile:' || author_profile_id::text)
  );

drop policy if exists venue_photos_owner_delete on public.venue_photos;
create policy venue_photos_owner_delete on public.venue_photos
  for delete to authenticated
  using (
    author_profile_id = (
      select p.id from public.profiles p
      where p.user_id = auth.uid() and p.tombstoned_at is null
      limit 1
    )
  );

grant select on table public.venue_photos to anon, authenticated;
grant insert, delete on table public.venue_photos to authenticated;

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

  delete from storage.objects o
   using public.venue_photos vp
   join public.profiles p on p.id = vp.author_profile_id
   where p.user_id = old.id
     and o.bucket_id = 'pint-drops'
     and (
       o.name = vp.object_key
       or o.name = replace(vp.object_key, '.jpg', '.staging.jpg')
     );

  delete from public.venue_photos vp
   using public.profiles p
   where p.id = vp.author_profile_id
     and p.user_id = old.id;

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
