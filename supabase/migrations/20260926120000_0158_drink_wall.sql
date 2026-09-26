-- Drink Wall (0158): extend venue_photos with wall categories and optional pub link.
-- Captain / firstmate applies. Agents ship SQL only.
-- venue_photos stays service-role only (0098): no client grants or policies here.
-- The tombstone trigger is not restated: 0156 already deletes every venue_photos
-- row by author, city rows included, and the objects go through the Storage API
-- (lib/accountDeletion.server.ts reads object_key, drink-wall/ keys included).

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

commit;
