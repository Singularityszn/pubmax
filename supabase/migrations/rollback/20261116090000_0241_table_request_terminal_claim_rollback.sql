-- Stop writers before rollback. This removes unsent coordination records and
-- their contacts. It loses terminal negative replay protection for those keys.
-- Pending and emailed requests remain intact.
begin;
drop function if exists public.transition_table_request(uuid, uuid, text, integer, text, timestamptz);
delete from public.table_requests where delivery in ('resolving', 'not_sent');
alter table public.table_requests drop constraint table_requests_delivery_check;
alter table public.table_requests add constraint table_requests_delivery_check
  check (delivery in ('pending', 'emailed'));
alter table public.table_requests drop column if exists revision;
commit;
