-- Rollback for 0152 (messaging channel ownership).
--
-- WHAT IT COSTS, WHICH IS WHAT A ROLLBACK IS FOR.
--
-- 1. THE BACKFILL IS NOT REVERSED. Every `profiles.user_id` this migration
--    stamped was stamped because `public.private_social_accounts` already named
--    that account as the row's owner, so the value is CORRECT whatever version
--    of the helper reads it. Un-stamping it would take a real owner's channels,
--    their Social gate and their contribution identity away to undo a statement
--    that was true. The rows stay stamped and the ordinary branch keeps
--    admitting them.
--
-- 2. THE SECOND AUTHORITY GOES. `pubmax_private.rls_owns_handle` returns to
--    0065's body, which asks `profiles.user_id` and nothing else. Any profile
--    the identity store binds to an account but which point 1 could NOT stamp -
--    a row whose account already owns another profile, or a tombstoned row - is
--    refused `live:inbox:<handle>` and `live:messages:<conversation>` again, and
--    the surfaces fall back to their poll. That is the pre-0152 behaviour and it
--    fails CLOSED; nothing leaks.
--
--    The 0065 body carries no `tombstoned_at` guard, which is safe for the same
--    reason 0152 says it is a no-op: `profiles_user_fk` is ON DELETE SET NULL
--    and the tombstone trigger is BEFORE DELETE on `auth.users`, so a tombstoned
--    row holds no `user_id` to match.
--
-- 3. THE CLAIM PATH STOPS REPAIRING ITS OWN STAMP. `public.claim_pubmaxx_handle`
--    returns to 0097's body. An account whose profile carries no `user_id` is
--    told its own handle is `taken` again and cannot re-claim it. No handle is
--    lost and no row is deleted; the repair simply stops being offered.
--
-- `rls_is_conversation_participant` is untouched here because it was untouched
-- there: it delegates to `rls_owns_handle` and inherits whichever body is live.

begin;

create or replace function pubmax_private.rls_owns_handle(p_handle text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_handle is not null
    and length(btrim(p_handle)) > 0
    and exists (
      select 1
      from public.profiles p
      where p.user_id = (select auth.uid())
        and (
          lower(p.handle) = lower(btrim(p_handle))
          or exists (
            select 1
            from public.profile_handle_aliases a
            where a.profile_id = p.id
              and lower(a.handle) = lower(btrim(p_handle))
          )
        )
    );
$$;

revoke execute on function pubmax_private.rls_owns_handle(text)
  from public, anon;
grant execute on function pubmax_private.rls_owns_handle(text)
  to authenticated, service_role;

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
begin
  if p_user_id is null or v_handle !~ '^[a-z0-9_]{3,30}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid',
      'error', 'Choose a valid PUBMAXX handle.');
  end if;
  if v_handle in (
    'admin', 'api', 'help', 'moderation', 'official', 'pubmaxx',
    'pubmaxxer', 'pubmaxxing', 'root', 'safety', 'staff', 'support', 'system'
  ) or v_handle ~ '^pubmaxx(ing|er)?_?(admin|help|official|safety|staff|support)$'
  then
    return jsonb_build_object('ok', false, 'code', 'reserved',
      'error', 'That handle is reserved.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_handle, 0));

  select * into v_profile from public.profiles
   where user_id = p_user_id limit 1;
  if found then
    insert into public.profile_handle_aliases(profile_id, handle, is_current)
    values (v_profile.id, lower(v_profile.handle), true)
    on conflict do nothing;
    if lower(v_profile.handle) = v_handle then
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

commit;
