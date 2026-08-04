-- Reduced 0067 policies for the session harness tables only.
-- Mirrors the fixed predicates for private_account_identities and
-- structured_visit_reports; omits night_* / notifications / etc.

begin;

-- private_account_identities: owner SELECT only; no client write
revoke all on table public.private_account_identities from public, anon, authenticated;
grant select on table public.private_account_identities to authenticated;
grant all on table public.private_account_identities to service_role;

drop policy if exists private_account_identities_owner_select on public.private_account_identities;
create policy private_account_identities_owner_select
  on public.private_account_identities for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists private_account_identities_owner_insert on public.private_account_identities;
drop policy if exists private_account_identities_owner_update on public.private_account_identities;
drop policy if exists private_account_identities_owner_delete on public.private_account_identities;

drop policy if exists private_account_identities_anon_deny on public.private_account_identities;
create policy private_account_identities_anon_deny
  on public.private_account_identities for all to anon
  using (false) with check (false);

-- follows: party select + owner insert/delete
revoke all on table public.follows from anon, authenticated;
grant select, insert, delete on table public.follows to authenticated;
grant all on table public.follows to service_role;

drop policy if exists follows_party_select on public.follows;
create policy follows_party_select
  on public.follows for select to authenticated
  using (
    public.rls_owns_profile(follower_id)
    or public.rls_owns_profile(followee_id)
  );

drop policy if exists follows_owner_insert on public.follows;
create policy follows_owner_insert
  on public.follows for insert to authenticated
  with check (public.rls_owns_profile(follower_id));

drop policy if exists follows_owner_delete on public.follows;
create policy follows_owner_delete
  on public.follows for delete to authenticated
  using (public.rls_owns_profile(follower_id));

drop policy if exists follows_anon_deny on public.follows;
create policy follows_anon_deny
  on public.follows for all to anon
  using (false) with check (false);

-- structured_visit_reports: visible only
revoke all on table public.structured_visit_reports from anon, authenticated;
grant select on table public.structured_visit_reports to authenticated;
grant all on table public.structured_visit_reports to service_role;

drop policy if exists structured_visit_reports_visible_or_owner_select
  on public.structured_visit_reports;
drop policy if exists structured_visit_reports_visible_select
  on public.structured_visit_reports;
create policy structured_visit_reports_visible_select
  on public.structured_visit_reports for select to authenticated
  using (status = 'visible');

drop policy if exists structured_visit_reports_anon_deny on public.structured_visit_reports;
create policy structured_visit_reports_anon_deny
  on public.structured_visit_reports for all to anon
  using (false) with check (false);

-- profiles: owner select
grant select on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

drop policy if exists profiles_owner_select on public.profiles;
create policy profiles_owner_select
  on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));

-- profile_handle_aliases: owner select
revoke all on table public.profile_handle_aliases from anon, authenticated;
grant select on table public.profile_handle_aliases to authenticated;
grant all on table public.profile_handle_aliases to service_role;

drop policy if exists profile_handle_aliases_owner_select on public.profile_handle_aliases;
create policy profile_handle_aliases_owner_select
  on public.profile_handle_aliases for select to authenticated
  using (public.rls_owns_profile(profile_id));

drop policy if exists profile_handle_aliases_anon_deny on public.profile_handle_aliases;
create policy profile_handle_aliases_anon_deny
  on public.profile_handle_aliases for all to anon
  using (false) with check (false);

commit;
