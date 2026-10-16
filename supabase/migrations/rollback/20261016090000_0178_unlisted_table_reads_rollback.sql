-- Rollback 0178: puts back the 0068 and 0067 read doors.
--
-- Cost: this is a disclosure. The anon key can again list every unlisted
-- crawl with its slug (the share key) and author handle, and any signed-in
-- account can again list every unlisted recap with its id, host_editor_id
-- and memory_id. No row is touched.

begin;

drop policy if exists crawl_stories_public_read on public.crawl_stories;
create policy crawl_stories_public_read
  on public.crawl_stories
  for select
  to anon, authenticated
  using (visibility in ('public', 'unlisted'));

grant select on table public.crawl_stories to anon, authenticated;

drop policy if exists night_stories_host_or_public_select on public.night_stories;
create policy night_stories_host_or_public_select
  on public.night_stories for select to authenticated
  using (
    host_editor_id = (select auth.uid())
    or (
      status = 'published'
      and visibility in ('public', 'unlisted')
    )
  );

drop policy if exists night_story_moments_host_or_published_select
  on public.night_story_moments;
create policy night_story_moments_host_or_published_select
  on public.night_story_moments for select to authenticated
  using (
    exists (
      select 1 from public.night_stories s
      where s.id = story_id and s.host_editor_id = (select auth.uid())
    )
    or exists (
      select 1 from public.night_stories s
      where s.id = story_id
        and s.status = 'published'
        and s.visibility in ('public', 'unlisted')
    )
  );

commit;
