-- Removes mystery preferences. Saved Plans, stops, and arrivals are preserved.
begin;
drop function if exists public.plan_presentation(uuid,text,boolean,integer);
drop table if exists public.plan_presentation_settings;
commit;
