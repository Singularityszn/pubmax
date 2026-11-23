-- Rollback for 0263. Drops the eight late-writer triggers and the handle helper.
--
-- Cost: a venue photo, cover photo, poll vote, message, group seat, Pint Drop, visit
-- report or weather pick written in flight can again land after its author's deletion
-- and keep the state the deletion had ended (a photo or vote kept, an attachment kept,
-- a live seat, a handle still shown). No data changes. 0262 is left in place.
begin;

drop trigger if exists venue_photos_refuse_deleted_author on public.venue_photos;
drop trigger if exists profile_cover_photos_refuse_deleted_author on public.profile_cover_photos;
drop trigger if exists pint_drops_refuse_deleted_author on public.pint_drops;
drop trigger if exists structured_visit_reports_refuse_deleted_author on public.structured_visit_reports;
drop trigger if exists weather_recommendations_refuse_deleted_author on public.weather_recommendations;
drop trigger if exists message_poll_votes_refuse_deleted_author on public.message_poll_votes;
drop trigger if exists messages_refuse_deleted_author on public.messages;
drop trigger if exists conversation_members_refuse_deleted_author on public.conversation_members;

drop function if exists public._refuse_deleted_handle_write();

commit;
