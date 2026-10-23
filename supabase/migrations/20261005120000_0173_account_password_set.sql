-- A password counts only once its owner set it (0173).
-- Captain applies. Agents ship SQL only.
--
-- THE FAULT. 0099 read "has a password" off `auth.users.encrypted_password`.
-- GoTrue writes a random password hash into that column when an email-link
-- (OTP) sign-up creates the account, so every email sign-up answered true
-- from its first second. The account hub then showed "Change password" and
-- asked for a current password the person never had, and the handle +
-- password sign-in could never be set up. Reproduced on a local Supabase
-- (GoTrue v2.197.0) on 5 Oct 2026: `signInWithOtp` for a new address leaves a
-- 60-character bcrypt hash and `account_has_password` answers true.
--
-- THE RULE. An account has a password when its OWNER set one, and the hash
-- is still there. GoTrue writes the random hash on INSERT and never touches
-- it on a later email-link sign-in (measured). A password the person chooses
-- (`updateUser({ password })` from their own session, or a recovery link
-- followed by the same call) is an UPDATE that changes the hash. So an AFTER
-- UPDATE trigger on `auth.users` records the moment the hash changes, and
-- 0099's function now asks for that record as well as a non-empty hash.
--
-- WHAT THIS DOES NOT CHANGE. Setting a first password still needs the
-- person's own GoTrue session, and changing one still goes through
-- `/api/auth/change-password/verify` first. No route of ours writes the
-- record: the database writes it when GoTrue changes the hash, so no caller
-- can claim a password it did not set, or erase one it did.
--
-- THE BACKFILL. Every account that exists when 0173 is applied and holds a
-- non-empty hash is recorded, so every existing account keeps the "Change
-- password" it shows today and nothing regresses. No older record can tell
-- an owner-set password from the random one: production keeps no rows in
-- `auth.audit_log_entries` (read-only check, 5 Oct 2026). So the new rule
-- applies only to accounts created after the apply.
--
-- THE LIMIT. An existing email-link sign-up that never set a password still
-- reads as having one. It keeps "Change password" and still needs the
-- current-password path or a recovery link to set one.
--
-- THE RECORD. `pubmax_private.account_password_set` holds the account id and
-- when the password was last set, and nothing else. No client role may read
-- or write it: grants are revoked and RLS is on with no policy. It cascades
-- with the auth user, so a deleted account leaves nothing behind.
--
-- `search_path` is pinned empty on both functions so every name inside
-- resolves schema-qualified, as 0099 explains.

begin;

create table if not exists pubmax_private.account_password_set (
  user_id uuid primary key references auth.users (id) on delete cascade,
  set_at timestamptz not null default now()
);

comment on table pubmax_private.account_password_set is
  'One row per account whose owner has set a password. Written only by the auth.users trigger and the 0173 backfill. No client role may read or write it.';

alter table pubmax_private.account_password_set enable row level security;
revoke all on table pubmax_private.account_password_set from public;
revoke all on table pubmax_private.account_password_set from anon;
revoke all on table pubmax_private.account_password_set from authenticated;

create or replace function pubmax_private.record_account_password_set()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.encrypted_password is not null
    and new.encrypted_password <> ''
    and new.encrypted_password is distinct from old.encrypted_password
  then
    insert into pubmax_private.account_password_set (user_id, set_at)
    values (new.id, now())
    on conflict (user_id) do update set set_at = excluded.set_at;
  end if;
  return new;
end;
$$;

comment on function pubmax_private.record_account_password_set() is
  'Records that an account''s owner set a password when GoTrue changes auth.users.encrypted_password. The random hash an email-link sign-up writes on INSERT is never recorded.';

revoke all on function pubmax_private.record_account_password_set() from public;
revoke all on function pubmax_private.record_account_password_set() from anon;
revoke all on function pubmax_private.record_account_password_set() from authenticated;

drop trigger if exists account_password_set_on_auth_user_update on auth.users;
create trigger account_password_set_on_auth_user_update
  after update of encrypted_password on auth.users
  for each row
  execute function pubmax_private.record_account_password_set();

insert into pubmax_private.account_password_set (user_id)
select u.id
from auth.users u
where u.encrypted_password is not null
  and u.encrypted_password <> ''
on conflict (user_id) do nothing;

create or replace function public.account_has_password(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join pubmax_private.account_password_set s on s.user_id = u.id
    where u.id = p_user_id
      and u.encrypted_password is not null
      and u.encrypted_password <> ''
  );
$$;

comment on function public.account_has_password(uuid) is
  'True when the account''s owner set a password that Supabase auth still holds. The random hash an email-link sign-up carries does not count. Returns one boolean and never the hash. Service role only: a browser-callable version would be an oracle for which accounts have passwords.';

revoke all on function public.account_has_password(uuid) from public;
revoke all on function public.account_has_password(uuid) from anon;
revoke all on function public.account_has_password(uuid) from authenticated;
grant execute on function public.account_has_password(uuid) to service_role;

commit;
