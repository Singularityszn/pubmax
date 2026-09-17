-- Rollback of 0154. THIS DROPS THE COLUMN, AND WITH IT EVERY PRIVATE ACCOUNT'S
-- CHOICE.
--
-- Read that cost before running this. `parseAccountVisibility` reads an absent
-- value as public, which is correct for a row that was written before the column
-- existed and is exactly wrong for a row whose owner chose private: the moment
-- this runs, every private account's bio, city, favourite drink, interests,
-- workplace and linked socials are published again to every stranger, and
-- nothing in the database remembers that anybody asked otherwise.
--
-- So the order matters. Take the application back to a build that does not offer
-- the choice FIRST, or accept that the accounts which made it are republished.
-- Undoing this migration alone is not a neutral act; it is a disclosure.
--
-- Nothing else is touched. No grant, policy or index moved on the way in, so
-- none moves on the way out, and every other column of `public.profiles`
-- survives exactly as it was written.

alter table public.profiles
  drop constraint if exists profiles_visibility_check;

alter table public.profiles
  drop column if exists visibility;
