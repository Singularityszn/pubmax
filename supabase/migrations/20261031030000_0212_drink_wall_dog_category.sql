-- Drink Wall dog category (0212): the photo wall gets a "dog" category for the
-- Dog of the week page (launch review F7).
-- Captain / firstmate applies. Agents ship SQL only.
-- Widens venue_photos_wall_category_check from 0158 by one word. No backfill:
-- every existing row keeps its category. The app's closed set is
-- DRINK_WALL_CATEGORIES in lib/venuePhotos.ts, and the two must say the same.
-- No grant and no policy moves: venue_photos stays service-role only (0098),
-- and a dog photo takes the same moderation as every wall photo.

begin;

alter table public.venue_photos drop constraint if exists venue_photos_wall_category_check;
alter table public.venue_photos
  add constraint venue_photos_wall_category_check
  check (wall_category in ('pint', 'london', 'pub', 'dog'));

commit;
