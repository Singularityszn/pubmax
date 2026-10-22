-- This removes saved import drafts and their attribution. Export them first if needed.
-- Existing plans, prices and venues are unaffected.
begin;
drop table if exists public.pub_list_night_drafts;
commit;
