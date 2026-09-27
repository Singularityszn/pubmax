-- Supabase hygiene (0159): scout report section 1b / ship task 3.
-- Drop a duplicate round_spends unique index; merge overlapping permissive
-- pub_presence SELECT policies into one explicit read rule; add covering indexes
-- for hot unindexed foreign keys (plans, rounds, social, presence reads).
-- Unused-index linter notices are intentionally ignored. Captain applies;
-- agents ship SQL only.
--
-- Reverse: supabase/migrations/rollback/20260927120000_0159_supabase_hygiene_rollback.sql

begin;

-- ── 1. Duplicate unique index on round_spends ───────────────────────────────
-- `unique (round_id, client_ref)` (0057) already backs the idempotent client_ref
-- write path; `round_spends_round_client_ref_idx` is the same key twice
-- (linter 0009_duplicate_index).
drop index if exists public.round_spends_round_client_ref_idx;

-- ── 2. pub_presence SELECT policies ─────────────────────────────────────────
-- 0007 opened SELECT with `expires_at > now()`. 0068 added `pub_presence_client_deny`
-- FOR ALL, which is also permissive on SELECT and overlaps the read rule. One
-- SELECT policy for browser roles; writes stay explicitly denied.
drop policy if exists pub_presence_public_read on public.pub_presence;
drop policy if exists pub_presence_client_deny on public.pub_presence;

create policy pub_presence_client_insert_deny
  on public.pub_presence
  for insert
  to anon, authenticated
  with check (false);

create policy pub_presence_client_update_deny
  on public.pub_presence
  for update
  to anon, authenticated
  using (false)
  with check (false);

create policy pub_presence_client_delete_deny
  on public.pub_presence
  for delete
  to anon, authenticated
  using (false);

create policy pub_presence_public_read
  on public.pub_presence
  for select
  to anon, authenticated
  using (expires_at > now());

-- ── 3. Covering indexes for unindexed foreign keys ──────────────────────────
do $$
begin
  if to_regclass('public.plan_member_group_prefs') is not null then
    execute 'create index if not exists plan_member_group_prefs_member_idx on public.plan_member_group_prefs (member_id)';
  end if;
  if to_regclass('public.plan_member_group_pref_requests') is not null then
    execute 'create index if not exists plan_member_group_pref_requests_member_idx on public.plan_member_group_pref_requests (member_id)';
  end if;
  if to_regclass('public.plan_vibe_votes') is not null then
    execute 'create index if not exists plan_vibe_votes_member_idx on public.plan_vibe_votes (member_id)';
  end if;
  if to_regclass('public.social_crew_members') is not null then
    execute 'create index if not exists social_crew_members_plan_member_idx on public.social_crew_members (plan_member_id)';
  end if;
  if to_regclass('public.pub_presence') is not null then
    execute 'create index if not exists pub_presence_expires_created_idx on public.pub_presence (expires_at, created_at desc)';
  end if;
end $$;

commit;
