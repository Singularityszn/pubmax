-- Keep retained Story source private to its host.
-- Public application reads still use the redacted service-role projection.
-- Retain grants because contributor and proposal policies also read this table.
begin;

alter policy night_stories_host_or_public_select
  on public.night_stories
  using (host_editor_id = (select auth.uid()));

commit;
