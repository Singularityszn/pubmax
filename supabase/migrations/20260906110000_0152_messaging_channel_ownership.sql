-- Handle ownership answers a SECOND authority, so a profile row nothing stamped
-- can still name its owner (verify-preview-5 sections 15.3 and 17.1).
--
-- Apply AFTER 0151. Captain applies; agents ship SQL only.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT WAS MEASURED. 0148 admits an account to `live:inbox:<handle>` and to
-- `live:messages:<conversation>` through ONE question, `rls_owns_handle`, and
-- that question rests on ONE column: `public.profiles.user_id`. On production
-- 22 of 30 live profiles carry a NULL there, so for every one of them the
-- policy refuses both channels and the messaging surfaces fall to their poll
-- with nothing on screen saying so.
--
-- WHY THE COLUMN IS NULL, WHICH IS NOT WHAT IT LOOKED LIKE. A profile row is
-- minted two ways. `claim_pubmaxx_handle` (0097) INSERTS the row with
-- `user_id` already set, so a claimed handle is stamped from its first
-- instant. `profileStore.ensure()` inserts a handle ALONE, and it is called by
-- the pint drop, one-tap price, follow and check-in paths and by
-- `GET /api/profiles/[handle]`, so a handle that has only ever been written
-- ABOUT gets a row with no owner. Those rows can never be claimed afterwards:
-- the RPC answers `taken` for an existing handle and `lib/profileOwnership.ts`
-- refuses to let an account inherit an unowned row, which is a deliberate
-- stance and is NOT weakened here. So the 22 are unowned handles rather than
-- refused owners, and the count is not, on this database, a population of real
-- accounts locked out.
--
-- WHAT THIS FIXES ANYWAY, AND WHY IT IS WORTH A MIGRATION. Ownership resting on
-- one column is fragile in a way the data cannot show until it bites:
-- `profiles_user_fk` is ON DELETE SET NULL, so the column is CLEARED by a
-- deletion, and any future path that writes a profile before it knows the
-- account leaves it empty. `public.private_social_accounts` (0071) is the other
-- place this product writes down who owns a profile - one row binding
-- `supabase_user_id` to `profile_id`, both UNIQUE - and it is the identity the
-- app's own Social gate already trusts. Reading it as a SECOND authority means
-- a stamp that is missing is no longer the same thing as an owner who does not
-- exist.
--
-- IT CANNOT ADMIT A NON-OWNER. The second branch fires only when all four hold:
-- the row carries NO `user_id` of its own, `private_social_accounts` binds THIS
-- caller's `auth.uid()` to THAT profile, the caller owns no other profile
-- (so an inconsistent pair can never speak), and the profile is not tombstoned.
-- Nothing here reads handle TEXT as evidence: a handle is public and
-- enumerable, which is exactly what F-1 was about, and the topic string still
-- proves nothing on its own.
--
-- `rls_is_conversation_participant` IS NOT REDEFINED, ON PURPOSE. It already
-- delegates both of its handle branches to `rls_owns_handle`, so it inherits
-- this answer whole. One place decides what owning a handle means; a second
-- copy of that rule inside the participant helper is the drift 0144 was.
--
-- THE BACKFILL. Where the second authority resolves an owner, the stamp is
-- written so the ordinary branch answers next time. On production this touches
-- ZERO rows and that is expected rather than a failure: 0092's
-- `provision_social_product_account` REQUIRES `profiles.user_id` before it will
-- create a social account at all, so today every `private_social_accounts` row
-- already points at a stamped profile. The statement is here for the rows a
-- future path, a restore, or another environment can produce.
--
-- Reverse: supabase/migrations/rollback/20260906110000_0152_messaging_channel_ownership_rollback.sql

begin;

-- ── the backfill ─────────────────────────────────────────────────────────────
-- Only a live row, only where the identity store names exactly one owner, and
-- only where that account is not already the owner of some other profile. The
-- unique index on `profiles.user_id` would refuse a second stamp anyway; this
-- says so in the predicate rather than discovering it as an error.
update public.profiles p
   set user_id = a.supabase_user_id,
       updated_at = now()
  from public.private_social_accounts a
 where a.profile_id = p.id
   and a.supabase_user_id is not null
   and p.user_id is null
   and p.tombstoned_at is null
   and not exists (
     select 1 from public.profiles q
      where q.user_id = a.supabase_user_id
   );

-- ── the predicate ────────────────────────────────────────────────────────────
-- Redefined in pubmax_private, where 0070 moved it and where the policies read
-- it. Redefining the helper under `public` instead would write a copy nothing
-- reads, which is the 0144 hole; __tests__/rlsHelperSchema.test.ts is the fence
-- and it reads this file as TEXT, so the offending shape is not spelled here.
--
-- `p.tombstoned_at is null` is new on BOTH branches and is a no-op on the
-- first: the tombstone trigger is BEFORE DELETE on `auth.users` and
-- `profiles_user_fk` is ON DELETE SET NULL, so a tombstoned row always ends
-- with a NULL `user_id` and could never have matched. It is stated because the
-- second branch needs it: a departed account whose social row still named it
-- must not own a live channel.
create or replace function pubmax_private.rls_owns_handle(p_handle text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_handle is not null
    and length(btrim(p_handle)) > 0
    and (select auth.uid()) is not null
    and exists (
      select 1
      from public.profiles p
      where p.tombstoned_at is null
        and (
          -- (1) the stamped link: unchanged, and still the ordinary answer.
          p.user_id = (select auth.uid())
          -- (2) the identity store's own link, for a row nothing stamped.
          or (
            p.user_id is null
            and exists (
              select 1
              from public.private_social_accounts a
              where a.profile_id = p.id
                and a.supabase_user_id = (select auth.uid())
            )
            and not exists (
              select 1
              from public.profiles q
              where q.user_id = (select auth.uid())
            )
          )
        )
        and (
          lower(p.handle) = lower(btrim(p_handle))
          or exists (
            select 1
            from public.profile_handle_aliases al
            where al.profile_id = p.id
              and lower(al.handle) = lower(btrim(p_handle))
          )
        )
    );
$$;

revoke execute on function pubmax_private.rls_owns_handle(text)
  from public, anon;
grant execute on function pubmax_private.rls_owns_handle(text)
  to authenticated, service_role;

-- ── the claim path repairs its own missing stamp ─────────────────────────────
-- 0097's body finds the caller's profile by `user_id` alone. An account whose
-- stamp is missing therefore misses that lookup, falls through to the
-- handle lookup, finds its OWN row and is told the handle is `taken` - it
-- cannot re-claim the handle it already has. The one new branch asks the same
-- second authority: where `private_social_accounts` binds this caller to the
-- row that holds the handle, the stamp is repaired and the claim is the
-- idempotent re-claim it always should have been. Everything else in this
-- function is byte-for-byte 0097.
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
    'pubmaxxer', 'pubmaxxing', 'root', 'safety', 'staff', 'support', 'system'
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

commit;
