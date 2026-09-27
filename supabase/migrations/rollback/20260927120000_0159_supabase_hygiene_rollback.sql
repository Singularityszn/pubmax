-- Rollback 0159.
--
-- COST: restores the duplicate round_spends unique index (double write cost on
-- the same key); puts pub_presence back to two overlapping permissive SELECT
-- policies; drops the FK and presence read indexes added for linter 0001. No
-- row data moves.

begin;

drop index if exists public.pub_presence_expires_created_idx;
drop index if exists public.social_crew_members_plan_member_idx;
drop index if exists public.plan_vibe_votes_member_idx;
drop index if exists public.plan_member_group_pref_requests_member_idx;
drop index if exists public.plan_member_group_prefs_member_idx;

drop policy if exists pub_presence_public_read on public.pub_presence;
drop policy if exists pub_presence_client_insert_deny on public.pub_presence;
drop policy if exists pub_presence_client_update_deny on public.pub_presence;
drop policy if exists pub_presence_client_delete_deny on public.pub_presence;
drop policy if exists pub_presence_client_deny on public.pub_presence;

create policy pub_presence_public_read
  on public.pub_presence
  for select
  using (expires_at > now());

create policy pub_presence_client_deny
  on public.pub_presence
  for all
  to anon, authenticated
  using (false)
  with check (false);

create unique index if not exists round_spends_round_client_ref_idx
  on public.round_spends (round_id, client_ref);

commit;
