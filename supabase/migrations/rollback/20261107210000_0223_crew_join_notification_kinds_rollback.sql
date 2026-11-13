-- Rollback of 0223.
--
-- COST: this deletes every crew join-request and crew join-accepted
-- notification, read or unread, because the restored check refuses them.
-- Hosts and guests lose those inbox rows. Nothing else is touched.

delete from public.notifications
 where kind in ('crew_join_request', 'crew_join_accepted');

alter table public.notifications
  drop constraint if exists notifications_kind_chk,
  add constraint notifications_kind_chk
    check (kind in ('follow', 'reaction', 'comment', 'crawl_save'));
