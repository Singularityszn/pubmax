-- 0177 reserves the handle `you` (QA F01, 6 Oct 2026).
-- `/u/you` is the viewer's own sentinel route and `handle=you` is the self
-- alias, so a real account called `you` made its owner's profile load forever
-- and made a signed-out `GET /api/profiles/you` return a stranger. The
-- TypeScript policy (`lib/pubmaxxIdentity.ts`) now refuses it; this migration
-- gives the two RPCs that mint a handle the same refusal. Claim and rename
-- are both redefined, because rename is the second door to the same name.
-- Each body is byte-for-byte its latest definition (claim: 0152, rename: 0029)
-- plus `'you'` in the reserved list. Existing rows are NOT touched.
-- Captain applies this migration. Rollback restores both bodies.

begin;

create or replace function public.claim_pubmaxx_handle(
  p_user_id uuid,
  p_handle text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handle text := lower(trim(p_handle));
  v_profile public.profiles%rowtype;
  v_founding integer;
  v_has_profile boolean := false;
begin
  if p_user_id is null or v_handle !~ '^[a-z0-9_]{3,30}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid',
      'error', 'Choose a valid PUBMAXX handle.');
  end if;
  if v_handle in (
    'admin', 'api', 'help', 'moderation', 'official', 'pubmaxx',
    'pubmaxxer', 'pubmaxxing', 'root', 'safety', 'staff', 'support', 'system',
    'you'
  ) or v_handle ~ '^pubmaxx(ing|er)?_?(admin|help|official|safety|staff|support)$'
  then
    return jsonb_build_object('ok', false, 'code', 'reserved',
      'error', 'That handle is reserved.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_handle, 0));

  select * into v_profile from public.profiles
   where user_id = p_user_id limit 1;
  v_has_profile := found;

  -- The stamp is missing but the identity store still names this account as the
  -- owner of a live row. Repair it and carry on as the ordinary owner path.
  -- `profiles_user_id_unique` is the second line under the guard: this account
  -- holds no profile, so the stamp cannot collide.
  if not v_has_profile then
    select p.* into v_profile
      from public.profiles p
      join public.private_social_accounts a on a.profile_id = p.id
     where a.supabase_user_id = p_user_id
       and p.user_id is null
       and p.tombstoned_at is null
     limit 1
       for update of p;
    v_has_profile := found;
    if v_has_profile then
      update public.profiles
         set user_id = p_user_id, updated_at = now()
       where id = v_profile.id;
      v_profile.user_id := p_user_id;
    end if;
  end if;

  if v_has_profile then
    insert into public.profile_handle_aliases(profile_id, handle, is_current)
    values (v_profile.id, lower(v_profile.handle), true)
    on conflict do nothing;
    if lower(v_profile.handle) = v_handle then
      -- Idempotent re-claim: an account claimed before this migration shipped
      -- and still inside the cohort gets its number here rather than never.
      v_founding := pubmax_private.grant_founding_member_number(v_profile.id);
      return jsonb_build_object('ok', true, 'profile_id', v_profile.id,
        'handle', v_handle, 'founding_member_number', v_founding);
    end if;
    return jsonb_build_object('ok', false, 'code', 'already_has_handle',
      'error', 'Rename your existing PUBMAXX handle instead.');
  end if;

  select * into v_profile from public.profiles
   where lower(handle) = v_handle limit 1 for update;
  if found then
    return jsonb_build_object('ok', false, 'code', 'taken',
      'error', 'That handle is already taken.');
  end if;
  if exists (
    select 1 from public.profile_handle_aliases where lower(handle) = v_handle
  ) then
    return jsonb_build_object('ok', false, 'code', 'taken',
      'error', 'That handle is already taken.');
  end if;

  insert into public.profiles(user_id, handle)
  values (p_user_id, v_handle)
  returning * into v_profile;
  insert into public.profile_handle_aliases(profile_id, handle, is_current)
  values (v_profile.id, v_handle, true);
  v_founding := pubmax_private.grant_founding_member_number(v_profile.id);
  return jsonb_build_object('ok', true, 'profile_id', v_profile.id,
    'handle', v_handle, 'founding_member_number', v_founding);
exception when unique_violation then
  select * into v_profile from public.profiles
   where user_id = p_user_id limit 1;
  if found then
    return jsonb_build_object('ok', false, 'code', 'already_has_handle',
      'error', 'Rename your existing PUBMAXX handle instead.');
  end if;
  return jsonb_build_object('ok', false, 'code', 'taken',
    'error', 'That handle is already taken.');
end;
$$;
revoke all on function public.claim_pubmaxx_handle(uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_pubmaxx_handle(uuid, text)
  to service_role;

revoke all on function public.claim_pubmaxx_handle(uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_pubmaxx_handle(uuid, text)
  to service_role;

create or replace function public.rename_pubmaxx_handle(p_user_id uuid, p_handle text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handle text := lower(trim(p_handle));
  v_profile public.profiles%rowtype;
  v_previous text;
  v_retry_at timestamptz;
begin
  if p_user_id is null or v_handle !~ '^[a-z0-9_]{3,30}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'error', 'Choose a valid PUBMAXX handle.');
  end if;
  if v_handle in ('admin','api','help','moderation','official','pubmaxx','pubmaxxer','pubmaxxing','root','safety','staff','support','system','you')
     or v_handle ~ '^pubmaxx(ing|er)?_?(admin|help|official|safety|staff|support)$' then
    return jsonb_build_object('ok', false, 'code', 'reserved', 'error', 'That handle is reserved.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_handle, 0));
  select * into v_profile from public.profiles where user_id = p_user_id limit 1 for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'error', 'Claim a PUBMAXX handle first.');
  end if;
  v_previous := lower(v_profile.handle);
  if v_previous = v_handle then
    return jsonb_build_object('ok', true, 'profile_id', v_profile.id, 'previous_handle', v_previous, 'handle', v_handle);
  end if;
  v_retry_at := v_profile.handle_changed_at + interval '30 days';
  if v_profile.handle_changed_at is not null and now() < v_retry_at then
    return jsonb_build_object('ok', false, 'code', 'cooldown', 'error', 'You can rename your handle once every 30 days.', 'retry_at', v_retry_at);
  end if;
  if exists (select 1 from public.profile_handle_aliases where lower(handle) = v_handle)
     or exists (select 1 from public.profiles where lower(handle) = v_handle) then
    return jsonb_build_object('ok', false, 'code', 'taken', 'error', 'That handle is already taken.');
  end if;
  update public.profile_handle_aliases set is_current = false, retired_at = now()
    where profile_id = v_profile.id and is_current;
  insert into public.profile_handle_aliases(profile_id, handle, is_current)
    values (v_profile.id, v_handle, true);
  update public.profiles set handle = v_handle, handle_changed_at = now(), updated_at = now()
    where id = v_profile.id;
  return jsonb_build_object('ok', true, 'profile_id', v_profile.id, 'previous_handle', v_previous, 'handle', v_handle);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'code', 'taken', 'error', 'That handle is already taken.');
end;
$$;

revoke all on function public.rename_pubmaxx_handle(uuid, text)
  from public, anon, authenticated;
grant execute on function public.rename_pubmaxx_handle(uuid, text)
  to service_role;

commit;
