-- V1 release boundary for Night Memory publication and Pub Pal voice quota.
-- Browser-authenticated writes stay behind service-role API ownership checks.

begin;

-- Browser roles retain their existing SELECT grants. All mutation paths move
-- back behind the service-role APIs that already enforce account ownership,
-- consent, publication, and voice allowance rules.
revoke insert, update, delete on table public.night_memories from authenticated;
revoke insert, update, delete on table public.night_moments from authenticated;
revoke insert, update, delete on table public.night_moment_consents from authenticated;
revoke insert, update, delete on table public.night_stories from authenticated;
revoke insert, update, delete on table public.night_story_contributors from authenticated;
revoke insert, update, delete on table public.night_story_moments from authenticated;
revoke insert, update, delete on table public.night_story_publish_proposals from authenticated;
revoke insert, update, delete on table public.pub_pal_voice_usage from authenticated;

grant select, insert, update, delete on table public.night_memories to service_role;
grant select, insert, update, delete on table public.night_moments to service_role;
grant select, insert, update, delete on table public.night_moment_consents to service_role;
grant select, insert, update, delete on table public.night_stories to service_role;
grant select, insert, update, delete on table public.night_story_contributors to service_role;
grant select, insert, update, delete on table public.night_story_moments to service_role;
grant select, insert, update, delete on table public.night_story_publish_proposals to service_role;
grant select, insert, update, delete on table public.pub_pal_voice_usage to service_role;

-- Split read predicates away from the former FOR ALL policies. Existing
-- select-only Story policies remain unchanged.
drop policy if exists night_memories_owner_all on public.night_memories;
drop policy if exists night_memories_owner_select on public.night_memories;
create policy night_memories_owner_select
  on public.night_memories for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists night_moments_owner_all on public.night_moments;
drop policy if exists night_moments_owner_select on public.night_moments;
create policy night_moments_owner_select
  on public.night_moments for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists night_moment_consents_owner_all on public.night_moment_consents;
drop policy if exists night_moment_consents_owner_select on public.night_moment_consents;
create policy night_moment_consents_owner_select
  on public.night_moment_consents for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists night_stories_host_write on public.night_stories;
drop policy if exists night_story_contributors_host_write on public.night_story_contributors;
drop policy if exists night_story_moments_host_write on public.night_story_moments;

drop policy if exists night_story_publish_proposals_party_all
  on public.night_story_publish_proposals;
drop policy if exists night_story_publish_proposals_party_select
  on public.night_story_publish_proposals;
create policy night_story_publish_proposals_party_select
  on public.night_story_publish_proposals for select to authenticated
  using (
    requested_by = (select auth.uid())
    or exists (
      select 1 from public.night_stories s
      where s.id = story_id and s.host_editor_id = (select auth.uid())
    )
  );

drop policy if exists pub_pal_voice_usage_owner_all on public.pub_pal_voice_usage;
drop policy if exists pub_pal_voice_usage_owner_select on public.pub_pal_voice_usage;
create policy pub_pal_voice_usage_owner_select
  on public.pub_pal_voice_usage for select to authenticated
  using (owner_id = (select auth.uid()));

-- Reserve first, then compensate exactly one reservation if ElevenLabs cannot
-- allocate a session. This RPC is service-role only, like the consume RPC.
create or replace function public.release_pub_pal_voice_trial(
  p_owner_id uuid,
  p_month date
) returns boolean
language sql
security definer
set search_path = public
as $$
  with released as (
    update public.pub_pal_voice_usage
    set session_count = session_count - 1
    where owner_id = p_owner_id
      and usage_month = p_month
      and session_count > 0
    returning 1
  )
  select exists (select 1 from released);
$$;

revoke all on function public.release_pub_pal_voice_trial(uuid, date)
  from public, anon, authenticated;
grant execute on function public.release_pub_pal_voice_trial(uuid, date)
  to service_role;

commit;
