-- Rollback for the V1 release Night Memory and Pub Pal voice boundary.
-- Restores the exact grants and authenticated policies present after 0069.

begin;

drop policy if exists night_memories_owner_select on public.night_memories;
create policy night_memories_owner_all
  on public.night_memories for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists night_moments_owner_select on public.night_moments;
create policy night_moments_owner_all
  on public.night_moments for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists night_moment_consents_owner_select on public.night_moment_consents;
create policy night_moment_consents_owner_all
  on public.night_moment_consents for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy night_stories_host_write
  on public.night_stories for all to authenticated
  using (host_editor_id = (select auth.uid()))
  with check (host_editor_id = (select auth.uid()));

create policy night_story_contributors_host_write
  on public.night_story_contributors for all to authenticated
  using (
    exists (
      select 1 from public.night_stories s
      where s.id = story_id and s.host_editor_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.night_stories s
      where s.id = story_id and s.host_editor_id = (select auth.uid())
    )
  );

create policy night_story_moments_host_write
  on public.night_story_moments for all to authenticated
  using (
    exists (
      select 1 from public.night_stories s
      where s.id = story_id and s.host_editor_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.night_stories s
      where s.id = story_id and s.host_editor_id = (select auth.uid())
    )
  );

drop policy if exists night_story_publish_proposals_party_select
  on public.night_story_publish_proposals;
create policy night_story_publish_proposals_party_all
  on public.night_story_publish_proposals for all to authenticated
  using (
    requested_by = (select auth.uid())
    or exists (
      select 1 from public.night_stories s
      where s.id = story_id and s.host_editor_id = (select auth.uid())
    )
  )
  with check (
    requested_by = (select auth.uid())
    or exists (
      select 1 from public.night_stories s
      where s.id = story_id and s.host_editor_id = (select auth.uid())
    )
  );

drop policy if exists pub_pal_voice_usage_owner_select on public.pub_pal_voice_usage;
create policy pub_pal_voice_usage_owner_all
  on public.pub_pal_voice_usage for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

grant insert, update, delete on table public.night_memories to authenticated;
grant insert, update, delete on table public.night_moments to authenticated;
grant insert, update, delete on table public.night_moment_consents to authenticated;
grant insert, update, delete on table public.night_stories to authenticated;
grant insert, update, delete on table public.night_story_contributors to authenticated;
grant insert, update, delete on table public.night_story_moments to authenticated;
grant insert, update, delete on table public.night_story_publish_proposals to authenticated;
grant insert, update on table public.pub_pal_voice_usage to authenticated;

drop function if exists public.release_pub_pal_voice_trial(uuid, date);

commit;
