-- Rollback 0219: drop the table requests table. THIS DELETES EVERY TABLE
-- REQUEST PUBMAXX EMAILED TO A PUB, so the operator panel lists none. The
-- emails already sent stay in the pubs' own inboxes, and the people who asked
-- keep their own copies, so no conversation between a crew and a pub is lost.
--
-- No pack, pin, price band or order moves, because nothing of that kind reads
-- this table. Once it is gone in production the route cannot keep a request,
-- so it answers "PUBMAXX did not send this" and hands the person the pub's own
-- address instead.

begin;

drop index if exists public.table_requests_requester_created_idx;
drop index if exists public.table_requests_venue_created_idx;

drop table if exists public.table_requests;

commit;
