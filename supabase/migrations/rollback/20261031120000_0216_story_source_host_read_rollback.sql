-- Rollback cost: every authenticated account can again read raw published Story text.
-- That text can include retained names of guests who deleted their accounts.
-- The service projection cannot redact a direct table read.
-- This rollback preserves stored text and does not undo guest-departure records.
begin;

alter policy night_stories_host_or_public_select
  on public.night_stories
  using (
    host_editor_id = (select auth.uid())
    or (status = 'published' and visibility = 'public')
  );

commit;
