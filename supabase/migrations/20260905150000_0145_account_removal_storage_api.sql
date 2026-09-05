-- 0145: account removal works again under Supabase's storage delete guard.
--
-- Contribution battle test D01 (5 September 2026): `DELETE /api/account`
-- answered 503 for EVERY account. GoTrue's admin delete runs
-- `delete from auth.users`, which fires the 0078 tombstone trigger, and that
-- trigger (as restated by 0089, 0096, 0098, 0100 and 0102) deleted a leaving
-- account's photos with `delete from storage.objects`. Supabase now refuses
-- that at the STATEMENT level (`protect_objects_delete`, SQLSTATE 42501,
-- "Direct deletion from storage tables is not allowed. Use the Storage API
-- instead."), so the statement raised whether or not it matched a row, the
-- whole delete rolled back, and no account could leave. The guard is right:
-- a row deleted by SQL leaves its bytes orphaned in the bucket, which is what
-- Supabase's own "Delete Objects" guide says direct deletion does.
--
-- Behind that sat a second refusal for every account that finished Social
-- onboarding: `private_social_accounts.supabase_user_id` referenced
-- `auth.users` with `on delete restrict` (0071).
--
-- TWO CHANGES, and a division of labour that has to stay written down:
--
-- (1) THE TRIGGER OWNS ROWS AND COLUMNS, NEVER BYTES. Every
--     `delete from storage.objects` leaves the trigger. The bytes are removed
--     through the Storage API by `deleteOwnAccount`
--     (`lib/accountDeletion.server.ts`) BEFORE the auth row is deleted, so the
--     keys the wall photo rows and the message columns carry are still
--     readable when the objects are collected. A delete that could not remove
--     the objects never reaches this trigger.
--
-- (2) A SOCIAL ACCOUNT IS SUSPENDED AND UNBOUND, NOT DELETED. Social Crew
--     rows reference `private_social_accounts(id)` with `on delete restrict`
--     (0075), so deleting the account row would refuse for anybody who ever
--     joined a Crew. The row stays, `ownership_state` becomes `suspended`,
--     which is the state every Social RPC already refuses, and
--     `supabase_user_id` is cleared. The FK moves to `on delete set null` for
--     the same reason, so a delete that runs outside this trigger cannot be
--     refused by the binding either.
--
-- Rollback: rollback/20260905150000_0145_account_removal_storage_api_rollback.sql
-- Proof: __tests__/accountRemovalMigrationEffective.test.ts (PostgreSQL 16 with
-- the guard trigger installed, before and after this file).

begin;

alter table public.private_social_accounts
  drop constraint if exists private_social_accounts_supabase_user_id_fkey;

alter table public.private_social_accounts
  add constraint private_social_accounts_supabase_user_id_fkey
  foreign key (supabase_user_id) references auth.users(id) on delete set null;

-- Restated whole because `create or replace function` replaces the whole body
-- and drops any SET clause it does not carry: the `search_path` line below is
-- load-bearing, not decoration. `storage` is no longer on it, because nothing
-- here reads or writes that schema any more.
create or replace function public.stamp_profile_tombstone_on_auth_user_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Wall photo ROWS. The objects they name were removed through the Storage
  -- API before this row delete ran; see the header.
  delete from public.venue_photos vp
   using public.profiles p
   where p.id = vp.author_profile_id
     and p.user_id = old.id;

  -- The cover rotation's rows. The cascade on profiles would not fire (the
  -- profile row stays as a tombstone), so they are deleted explicitly.
  delete from public.profile_cover_photos c
   using public.profiles p
   where p.id = c.profile_id
     and p.user_id = old.id;

  -- Message photos: the columns that pointed at them. The message keeps its
  -- words. When it had none, one line says the photo is gone, because a blank
  -- bubble in somebody else's thread explains nothing and the content CHECK
  -- would refuse it anyway.
  update public.messages m
     set body = case when char_length(m.body) >= 1 then m.body else 'Photo removed.' end,
         attachment_kind = null,
         attachment_object_key = null,
         attachment_width = null,
         attachment_height = null,
         attachment_venue_id = null
    from public.profiles p
   where p.handle = m.sender_handle
     and p.user_id = old.id
     and m.attachment_kind is not null;

  -- The Social product account: suspended and unbound, kept for the Crew rows
  -- that reference it. `suspended` is the state every Social RPC refuses.
  update public.private_social_accounts
     set ownership_state = 'suspended',
         ownership_changed_at = now(),
         supabase_user_id = null,
         updated_at = now()
   where supabase_user_id = old.id;

  update public.profiles
     set tombstoned_at = coalesce(tombstoned_at, now()),
         avatar_url = null,
         avatar_object_key = null,
         avatar_generation = null,
         avatar_moderation_state = null,
         avatar_report_count = 0,
         avatar_reported_at = null,
         avatar_report_reason = null,
         avatar_report_actors = '{}'::text[],
         avatar_moderated_at = null,
         avatar_moderator_note = null,
         cover_object_key = null,
         cover_generation = null,
         cover_moderation_state = null,
         cover_report_count = 0,
         cover_reported_at = null,
         cover_report_reason = null,
         cover_report_actors = '{}'::text[],
         cover_moderated_at = null,
         cover_moderator_note = null,
         favourite_drink = null,
         interests = null,
         workplace = null,
         updated_at = now()
   where user_id = old.id;

  return old;
end;
$$;

revoke all on function public.stamp_profile_tombstone_on_auth_user_delete() from public, anon, authenticated;

commit;
