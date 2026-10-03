-- Close the leftover public-table grants (0172).
-- Captain applies. Agents ship SQL only.
--
-- Inventory. A full replay of supabase/migrations on the session fixture
-- (scripts/rls/session-fixture.sql grants anon and authenticated SELECT,
-- INSERT, UPDATE, DELETE on new public tables) is the catalog this file
-- follows. REVOKE ALL also clears TRUNCATE, REFERENCES and TRIGGER. The
-- hosted platform grants those three by default; the fixture does not, and
-- a partial revoke such as 0070's INSERT/UPDATE/DELETE leaves them in place.
-- The sweep covers public sequences too, which the platform grants to both
-- browser roles by default and no client path uses.
--
-- What the app uses. Stores write and read through the service role. The
-- browser client does not call .from() or .rpc() on anything in public. The
-- one browser table path is lib/crewRealtime.ts, a postgres_changes
-- subscription on plan_crew_members, which needs the column SELECT 0066
-- granted and must not gain token_hash or social_account_id.
--
-- SELECT that stays. Every permissive SELECT policy in public that admits
-- anon or authenticated keeps the grant it reads through. These are the
-- PostgREST read doors later migrations opened on purpose, and the
-- permission matrix still asserts several of them. Revoking them would turn
-- an owner read into a permission error.
--   • authenticated table SELECT: adult_self_assertions, check_ins,
--     conversation_members, conversations, drinks, follows,
--     message_poll_votes, messages, night_memories, night_moment_consents,
--     night_moments, night_profiles, night_stories,
--     night_story_contributors, night_story_moments,
--     night_story_publish_proposals, notifications, plan_stops,
--     private_account_identities, profile_handle_aliases, profiles,
--     pub_heritage, pub_pal_mastery_events, pub_pal_memories,
--     pub_pal_voice_usage, pub_pals, saved_list_follows, saved_lists,
--     saved_pubs, step_out_nudge_prefs, wanteds.
--   • anon and authenticated table SELECT: crawl_stories, drinks,
--     pub_heritage (0068's public catalogue).
--   • authenticated column SELECT, not the whole table: community_prices
--     without contributor_handle (0171), plan_crew_members without
--     token_hash (0066) and without social_account_id (0075), plans
--     without social_owner_account_id (0075).
--   • anon and authenticated column SELECT: night_signal_claims (0068).
-- Three tables have such a policy and no grant, and this file grants none.
-- 0171 closed pint_drops and structured_visit_reports on purpose, along
-- with the visit_reports view. 0068 revoked every pub_presence grant, and
-- 0159 rewrote pub_presence_public_read without granting one back. That
-- read has been a permission error since 0068. lib/presenceStore.ts reads
-- the table through the service role, and the row carries actor_hash.
-- anon SELECT on conversation_members and message_poll_votes goes: no
-- policy admits anon there, so the grant answers zero rows.
--
-- Writes that go. The service role is the write path. Client
-- INSERT/UPDATE/DELETE on the tables above is either an explicit grant
-- closed only by a row policy (0066 saved_pubs, 0067 follows, check_ins,
-- notifications UPDATE, saved lists, pub pals, 0037 night_profiles, 0093
-- wanteds, 0094 step_out_nudge_prefs) or a default the later SELECT grant
-- never revoked (0155 conversation_members and 0156 message_poll_votes
-- for anon and authenticated; 0068 crawl_stories for both). No browser
-- path writes any of them. service_role grants are not touched.
--
-- New objects. The platform's default privileges in schema public grant
-- anon and authenticated every privilege on each new table, sequence and
-- function the migration role creates. That default is how 0170 and 0171
-- found the same hole twice. This file revokes it, so a new public object
-- holds no browser-role grant until its migration writes one.
-- __tests__/browserRoleGrantFence.test.ts holds the replayed catalog to an
-- explicit allow-list. PUBLIC EXECUTE on a new function is a global
-- PostgreSQL default that a per-schema revoke cannot remove, so a function
-- still revokes from public itself.
--
-- report_pint_drop. 0118 left the 0004 function SECURITY INVOKER, and
-- PUBLIC can still execute it. 0171 revoked authenticated SELECT on
-- pint_drops, so a signed-in call fails inside the UPDATE. The live report
-- path is already the API: POST /api/pint-drops action=report calls
-- report_pint_drop_v2 or report_pint_drop_anonymous through the service
-- role. This migration keeps the legacy function SECURITY INVOKER and
-- grants execute to service_role only. service_role keeps its pint_drops
-- grants, so its call runs, and a signed-in JWT is refused at EXECUTE.
--
-- Reverse: supabase/migrations/rollback/20261003070000_0172_public_grant_sweep_rollback.sql

begin;

do $$
declare
  rel record;
begin
  for rel in
    select c.relname, c.relkind
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'v', 'p', 'm', 'S')
     order by c.relname
  loop
    execute format(
      'revoke all on %s public.%I from anon, authenticated',
      case when rel.relkind = 'S' then 'sequence' else 'table' end,
      rel.relname
    );
  end loop;
end $$;

alter default privileges in schema public
  revoke all on tables from anon, authenticated;
alter default privileges in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges in schema public
  revoke all on functions from anon, authenticated;

grant select on table
  public.adult_self_assertions,
  public.check_ins,
  public.conversation_members,
  public.conversations,
  public.follows,
  public.message_poll_votes,
  public.messages,
  public.night_memories,
  public.night_moment_consents,
  public.night_moments,
  public.night_profiles,
  public.night_stories,
  public.night_story_contributors,
  public.night_story_moments,
  public.night_story_publish_proposals,
  public.notifications,
  public.plan_stops,
  public.private_account_identities,
  public.profile_handle_aliases,
  public.profiles,
  public.pub_pal_mastery_events,
  public.pub_pal_memories,
  public.pub_pal_voice_usage,
  public.pub_pals,
  public.saved_list_follows,
  public.saved_lists,
  public.saved_pubs,
  public.step_out_nudge_prefs,
  public.wanteds
to authenticated;

grant select on table
  public.crawl_stories,
  public.drinks,
  public.pub_heritage
to anon, authenticated;

grant select (
  id,
  venue_id,
  drink_category,
  price_pennies,
  submitted_at,
  corroborated_at,
  contradicted_at
) on table public.community_prices to authenticated;

grant select (
  id, plan_id, name, status, user_id, joined_at, updated_at
) on table public.plan_crew_members to authenticated;

grant select (
  id, title, start_time, owner_user_id, created_at, status, night_context,
  ending, route_revision, creation_key_hash, creation_request_hash,
  anchor_venue_id, anchor_source, plan_outcome, route_ready_at
) on table public.plans to authenticated;

grant select (
  id, kind, entity_type, entity_id, claim, source_url, publisher, published_at,
  observed_at, expires_at, confidence, review_state, verification, route_effect,
  corroborating_sources, reviewed_at, review_authority, created_at
) on table public.night_signal_claims to anon, authenticated;

revoke all on function public.report_pint_drop(uuid, text, int)
  from public, anon, authenticated;
grant execute on function public.report_pint_drop(uuid, text, int)
  to service_role;

commit;
