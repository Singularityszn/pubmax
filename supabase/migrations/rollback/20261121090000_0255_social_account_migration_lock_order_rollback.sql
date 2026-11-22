-- Restores the exact 0071 migrate_social_product_account body. This restores its
-- profile-first order and its deadlock with account deletion. No data changes.

begin;

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

  -- Every migration orders both identity locks by their numeric key. Crossed
  -- requests therefore cannot acquire one identity each and wait on the other.
  for v_lock_key in
    select lock_key
      from (values
        (hashtextextended('clerk:' || v_clerk_user_id, 0)),
        (hashtextextended('supabase:' || p_supabase_user_id::text, 0))
      ) as identity_locks(lock_key)
     order by lock_key
  loop
    perform pg_advisory_xact_lock(v_lock_key);
  end loop;

  select * into v_profile
    from public.profiles
   where user_id = p_supabase_user_id
   limit 1
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'legacy_profile_not_found');
  end if;

  -- Lock every existing product account involved in one id order, then assign
  -- its role. Separate Clerk-first and Supabase-first selects can deadlock when
  -- two already-bound accounts are crossed concurrently.
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
