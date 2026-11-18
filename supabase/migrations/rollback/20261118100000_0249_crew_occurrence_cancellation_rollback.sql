-- Stops new moderator cancellations. Cancelled Plans, expired requests and
-- invitations, cleared positions, and the private cancellation audit stay intact.
-- Reapply 0249 to restore the operation. This rollback deletes no history.
begin;
drop function public.cancel_social_crew_occurrence_admin(uuid,uuid,bigint,text,text);
commit;
