-- Rollback of 0238 discards all stored stars. Pint Drops and prices remain.
alter table public.pint_drops drop constraint if exists pint_drops_rating_range;
alter table public.pint_drops drop column if exists rating;
