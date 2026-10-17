-- 0178: an unlisted crawl or recap is not readable through the table.
-- Captain applies. Agents ship SQL only.
--
-- Before. 0068 kept crawl_stories_public_read admitting
-- visibility in ('public', 'unlisted') to anon and authenticated, and 0172
-- kept the table SELECT it reads through. The anon key ships in every
-- browser, so
--   GET /rest/v1/crawl_stories?visibility=eq.unlisted
-- listed every unlisted crawl with its slug, which is the share key, and the
-- author_handle of withdrawn and deleted authors that the API hides.
-- 0067 did the same for signed-in accounts on night_stories and
-- night_story_moments: any account could list every unlisted recap with its
-- id (the /recap share key), host_editor_id and memory_id.
--
-- After.
--   • crawl_stories: anon and authenticated lose SELECT. Every read in
--     lib/crawlStoryStore.ts goes through the service role, and no browser
--     path calls .from() on public (0172). The policy is narrowed to
--     'public' as well, so a grant written back later cannot reopen the
--     unlisted rows.
--   • night_stories, night_story_moments: the stranger branch of each
--     SELECT policy admits 'public' only. The host branch is unchanged. The
--     SELECT grant stays, because night_story_contributors and
--     night_story_publish_proposals read night_stories inside their own
--     policies, and a revoke would turn those owner reads into permission
--     errors. Moving those subqueries into pubmax_private helpers is what a
--     full revoke needs; it is not this file.
--
-- Reverse: supabase/migrations/rollback/20261016090000_0178_unlisted_table_reads_rollback.sql

begin;

revoke select on table public.crawl_stories from anon, authenticated;

drop policy if exists crawl_stories_public_read on public.crawl_stories;
create policy crawl_stories_public_read
  on public.crawl_stories
  for select
  to anon, authenticated
  using (visibility = 'public');

drop policy if exists night_stories_host_or_public_select on public.night_stories;
create policy night_stories_host_or_public_select
  on public.night_stories for select to authenticated
  using (
    host_editor_id = (select auth.uid())
    or (
      status = 'published'
      and visibility = 'public'
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
        and s.visibility = 'public'
    )
  );

commit;
