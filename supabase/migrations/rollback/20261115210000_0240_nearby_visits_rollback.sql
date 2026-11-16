-- Removes nearby visit proof. Its points and completion bonuses stop counting.
-- Pint Drops and saved Been lists remain. No coordinates are stored or exposed.
drop table if exists public.nearby_visits;
