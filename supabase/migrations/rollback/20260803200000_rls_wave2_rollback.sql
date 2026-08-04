-- Rollback for RLS wave 2 (0065–0069).
--
-- Apply ONLY when undoing an unapplied or recently applied wave 2. Does not
-- run automatically. Captain applies migrations; this is the clean down path.
--
-- Restores:
--   • prior rounds_*_public_read policies (using (true)) dropped by 0068
--   • prior visit_reports_public_read (status = 'visible') from 0001
--   • drops wave-2 helpers, policies, and authenticated grants this wave added
--
-- Does NOT drop tables or data. Does NOT re-open private_account_identities
-- writes (pre-wave-2 had no client grants either).

begin;

-- ── Drop wave-2 policies by known names (ignore missing) ────────────────────
do $$
declare
  pol record;
begin
  for pol in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and (
        policyname like '%_anon_deny'
        or policyname like '%_client_deny'
        or policyname in (
          'plans_participant_select',
          'plan_stops_participant_select',
          'plan_crew_members_participant_select',
          'conversations_participant_select',
          'messages_participant_select',
          'saved_pubs_owner_select',
          'saved_pubs_owner_insert',
          'saved_pubs_owner_update',
          'saved_pubs_owner_delete',
          'community_prices_visible_select',
          'visit_reports_public_surface_select',
          'visit_reports_visible_or_owner_select',
          'private_account_identities_owner_select',
          'private_account_identities_owner_insert',
          'private_account_identities_owner_update',
          'private_account_identities_owner_delete',
          'notifications_recipient_select',
          'notifications_recipient_update',
          'saved_lists_owner_all',
          'saved_list_follows_owner_all',
          'follows_party_select',
          'follows_owner_insert',
          'follows_owner_delete',
          'check_ins_author_select',
          'check_ins_author_insert',
          'check_ins_author_delete',
          'pub_pals_owner_all',
          'pub_pal_memories_owner_all',
          'pub_pal_mastery_events_owner_all',
          'pub_pal_voice_usage_owner_all',
          'night_memories_owner_all',
          'night_moments_owner_all',
          'night_moment_consents_owner_all',
          'night_stories_owner_all',
          'night_story_contributors_host_all',
          'night_story_moments_host_all',
          'night_story_publish_proposals_host_all',
          'structured_visit_reports_visible_select',
          'structured_visit_reports_visible_or_owner_select',
          'external_social_accounts_owner_all',
          'profile_handle_aliases_owner_select',
          'profiles_owner_select',
          'drinks_public_read',
          'pub_heritage public read',
          'crawl_stories_public_read',
          'Public reads current approved night signal claims'
        )
      )
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- ── Drop wave-2 helpers ─────────────────────────────────────────────────────
drop function if exists public.rls_can_read_visit_report(text, text, text);
drop function if exists public.rls_follows_handle(text);
drop function if exists public.rls_current_price_actor();
drop function if exists public.rls_is_conversation_participant(uuid);
drop function if exists public.rls_is_plan_participant(uuid);
drop function if exists public.rls_owns_handle(text);
drop function if exists public.rls_owns_profile(uuid);
drop function if exists public.rls_current_profile_id();

-- ── Revoke wave-2 authenticated grants (best-effort) ────────────────────────
do $$
declare
  t text;
  tables text[] := array[
    'plans', 'plan_stops', 'plan_crew_members',
    'conversations', 'messages', 'saved_pubs',
    'community_prices', 'visit_reports',
    'private_account_identities', 'notifications',
    'saved_lists', 'saved_list_follows', 'follows', 'check_ins',
    'structured_visit_reports', 'external_social_accounts',
    'profile_handle_aliases', 'profiles'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on table public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- ── Restore pre-wave-2 Round public reads (0011 / 0057) ─────────────────────
do $$
begin
  if to_regclass('public.rounds') is not null then
    drop policy if exists rounds_public_read on public.rounds;
    create policy rounds_public_read on public.rounds for select using (true);
  end if;
  if to_regclass('public.round_members') is not null then
    drop policy if exists round_members_public_read on public.round_members;
    create policy round_members_public_read on public.round_members for select using (true);
  end if;
  if to_regclass('public.round_stops') is not null then
    drop policy if exists round_stops_public_read on public.round_stops;
    create policy round_stops_public_read on public.round_stops for select using (true);
  end if;
  if to_regclass('public.round_spends') is not null then
    drop policy if exists round_spends_public_read on public.round_spends;
    create policy round_spends_public_read on public.round_spends for select using (true);
  end if;
end $$;

-- ── Restore pre-wave-2 visit_reports public read (0001) ─────────────────────
do $$
begin
  if to_regclass('public.visit_reports') is not null then
    drop policy if exists visit_reports_public_read on public.visit_reports;
    create policy visit_reports_public_read
      on public.visit_reports
      for select
      using (status = 'visible');
  end if;
end $$;

-- ── Restore public catalogue / night signal reads if tables exist ───────────
do $$
begin
  if to_regclass('public.drinks') is not null then
    drop policy if exists drinks_public_read on public.drinks;
    create policy drinks_public_read on public.drinks for select using (true);
    grant select on table public.drinks to anon, authenticated;
  end if;
  if to_regclass('public.pub_heritage') is not null then
    drop policy if exists "pub_heritage public read" on public.pub_heritage;
    create policy "pub_heritage public read" on public.pub_heritage for select using (true);
    grant select on table public.pub_heritage to anon, authenticated;
  end if;
end $$;

commit;
