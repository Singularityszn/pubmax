-- 0223: two in-app notification kinds for the open-crawl host loop
-- (launch plan P0 item 3).
--
--   crew_join_request   somebody asked to join the recipient's crew
--   crew_join_accepted  the host let the recipient into their crew
--
-- Only the kind check widens. No column, policy or grant changes.
-- The server writes every row. Recipient read policies remain unchanged (0067).
-- Re-runnable: the constraint is dropped and added in one statement.

alter table public.notifications
  drop constraint if exists notifications_kind_chk,
  add constraint notifications_kind_chk
    check (kind in (
      'follow', 'reaction', 'comment', 'crawl_save',
      'crew_join_request', 'crew_join_accepted'
    ));
