-- Rollback 0212 Drink Wall dog category.
-- COST: every 'dog' row is MOVED to 'pub' before the CHECK narrows back to
-- 0158's three words, because a dog photo is always taken at a pub and the
-- narrower CHECK cannot hold a 'dog' row. The photos, their objects and their
-- moderation state are kept; only the category word changes, so they leave
-- the Dog of the week page and show on the wall as pub photos. Nothing records
-- which rows were dogs, so re-applying 0212 does not move them back.
-- Run this only after the app that knows the 'dog' word is rolled back, or a
-- new dog upload fails the CHECK.

begin;

update public.venue_photos set wall_category = 'pub' where wall_category = 'dog';

alter table public.venue_photos drop constraint if exists venue_photos_wall_category_check;
alter table public.venue_photos
  add constraint venue_photos_wall_category_check
  check (wall_category in ('pint', 'london', 'pub'));

commit;
