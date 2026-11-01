-- This removes every "with" tag on a Pint Drop, approved or not. The drops,
-- their prices and their free-text "with" names are unaffected.
begin;
drop table if exists public.pint_drop_with_tags;
commit;
