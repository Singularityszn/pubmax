-- This rollback permanently removes hosted attendance, reports and feedback.
-- Existing Plans, Social Crews, messages, blocks and connections stay unchanged.
begin;
drop function if exists public.change_hosted_outing(uuid,uuid,text,jsonb,integer,boolean);
drop function if exists public.read_hosted_outings(uuid,uuid);
drop function if exists public.create_hosted_outing(uuid,text,text,text,timestamptz,integer,uuid);
drop function if exists public.hosted_outing_operator_eligible(uuid);
drop function if exists public.hosted_outing_moderator_eligible(uuid);
drop table if exists public.hosted_outing_feedback;
drop table if exists public.hosted_outing_reports;
drop table if exists public.hosted_outing_attendees;
drop table if exists public.hosted_outings;
commit;
