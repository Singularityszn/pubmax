begin;

alter policy night_stories_host_or_public_select
  on public.night_stories
  using (host_editor_id = (select auth.uid()));

commit;
