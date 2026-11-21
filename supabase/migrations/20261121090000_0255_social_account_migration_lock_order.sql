-- 0255: migrate_social_product_account takes the auth row before the profile, the
-- order that account deletion, provisioning and suspension share (0245, item 4).
--
-- 1. Lock order: the Clerk and Supabase identity locks in key order, the auth row
--    (KEY SHARE), the profile row, then every involved account row in ID order. An
--    auth.users DELETE holds the auth row before its triggers lock the account and
--    write the account and then the profile. The 0071 body took the profile first, so
--    a migration and a deletion of the same person could each wait for the other.
-- 2. A deletion in flight makes a migration wait, then answer legacy_profile_not_found
--    with no write and no audit row. A deletion that starts later waits for the
--    migration, then unbinds and suspends the account it bound.
-- 3. No account lock: the migration never changes ownership_state.
-- 4. Every other answer, the audit row and service-only EXECUTE are unchanged.
--
-- Rollback restores the 0071 body and its deadlock with deletion. No data changes.
begin;

-- A row lock on auth.users needs UPDATE on it. Without that this migration stops here.
do $$
begin
  if not pg_catalog.has_any_column_privilege('auth.users','UPDATE') then
    raise exception '0255 needs UPDATE on auth.users to lock the person''s auth row';
  end if;
end;
$$;

create or replace function public.migrate_social_product_account(
  p_clerk_user_id text,
  p_supabase_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clerk_user_id text := trim(p_clerk_user_id);
  v_profile public.profiles%rowtype;
  v_clerk_account public.private_social_accounts%rowtype;
  v_supabase_account public.private_social_accounts%rowtype;
  v_locked_account public.private_social_accounts%rowtype;
  v_account public.private_social_accounts%rowtype;
  v_lock_key bigint;
begin
  if v_clerk_user_id = '' or p_supabase_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'ownership_conflict');
  end if;

  for v_lock_key in
    select lock_key
      from (values
        (pg_catalog.hashtextextended('clerk:' || v_clerk_user_id, 0)),
        (pg_catalog.hashtextextended('supabase:' || p_supabase_user_id::text, 0))
      ) as identity_locks(lock_key)
     order by lock_key
  loop
    perform pg_catalog.pg_advisory_xact_lock(v_lock_key);
  end loop;

  perform 1 from auth.users where id = p_supabase_user_id for key share;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'legacy_profile_not_found');
  end if;

  select * into v_profile
    from public.profiles
   where user_id = p_supabase_user_id
   limit 1
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'legacy_profile_not_found');
  end if;

  for v_locked_account in
    select *
      from public.private_social_accounts
     where clerk_user_id = v_clerk_user_id
        or supabase_user_id = p_supabase_user_id
     order by id
     for update
  loop
    if v_locked_account.clerk_user_id = v_clerk_user_id then
      v_clerk_account := v_locked_account;
    end if;
    if v_locked_account.supabase_user_id = p_supabase_user_id then
      v_supabase_account := v_locked_account;
    end if;
  end loop;

  if v_clerk_account.id is not null then
    if v_supabase_account.id is not null
       and v_supabase_account.id <> v_clerk_account.id then
      return jsonb_build_object('ok', false, 'code', 'ownership_conflict');
    end if;
    if v_clerk_account.profile_id <> v_profile.id
       or (
         v_clerk_account.supabase_user_id is not null
         and v_clerk_account.supabase_user_id <> p_supabase_user_id
       ) then
      return jsonb_build_object('ok', false, 'code', 'ownership_conflict');
    end if;
    if v_clerk_account.supabase_user_id = p_supabase_user_id then
      return jsonb_build_object(
        'ok', true,
        'product_account_id', v_clerk_account.id,
        'migrated', false
      );
    end if;

    update public.private_social_accounts
       set supabase_user_id = p_supabase_user_id,
           updated_at = now(),
           ownership_changed_at = now()
     where id = v_clerk_account.id
     returning * into v_account;
  elsif v_supabase_account.id is not null then
    return jsonb_build_object('ok', false, 'code', 'ownership_conflict');
  else
    insert into public.private_social_accounts (
      clerk_user_id,
      supabase_user_id,
      profile_id
    ) values (
      v_clerk_user_id,
      p_supabase_user_id,
      v_profile.id
    ) returning * into v_account;
  end if;

  insert into public.private_social_account_audit (
    product_account_id,
    action,
    previous_supabase_user_id,
    current_supabase_user_id
  ) values (
    v_account.id,
    'migration_bound',
    null,
    p_supabase_user_id
  );

  return jsonb_build_object(
    'ok', true,
    'product_account_id', v_account.id,
    'migrated', true
  );
exception when unique_violation then
  return jsonb_build_object('ok', false, 'code', 'ownership_conflict');
end;
$$;

revoke all on function public.migrate_social_product_account(text, uuid)
  from public, anon, authenticated;
grant execute on function public.migrate_social_product_account(text, uuid)
  to service_role;

commit;
