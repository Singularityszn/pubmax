-- Rollback 0158 Drink Wall.
-- COST: drops wall columns; deletes city-only rows (their drink-wall/ objects are NOT
-- deleted here; remove them through the Storage API). Client access stays revoked.

begin;

revoke all on table public.venue_photos from anon, authenticated;

delete from public.venue_photos where venue_id is null;

alter table public.venue_photos drop constraint if exists venue_photos_place_label_check;
alter table public.venue_photos drop constraint if exists venue_photos_wall_category_check;
alter table public.venue_photos drop constraint if exists venue_photos_object_key_check;

alter table public.venue_photos drop column if exists place_label;
alter table public.venue_photos drop column if exists wall_category;

alter table public.venue_photos alter column venue_id set not null;

alter table public.venue_photos
  add constraint venue_photos_object_key_check
  check (object_key = ('venue-photos/' || venue_id || '/' || id::text || '.jpg'));

drop index if exists venue_photos_drink_wall_author_idx;
drop index if exists venue_photos_drink_wall_idx;

commit;
