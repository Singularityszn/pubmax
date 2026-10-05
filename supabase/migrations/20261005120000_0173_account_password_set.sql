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
-- THE BACKFILL. GoTrue logs `user_updated_password` in
-- `auth.audit_log_entries` each time an owner sets a password, with the
-- account id as `actor_id`. Every account with such an entry and a non-empty
-- hash is recorded, so an account that really set a password keeps "Change
-- password". An account whose only password came from an admin call
-- (`auth.admin.createUser` or `updateUserById`) has no such entry and reads
-- as "Create password" until its owner sets one. On a live account the
-- owner then creates a password without the current one, which is the same
-- authority they already hold: a signed-in session can set a password today.
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

insert into pubmax_private.account_password_set (user_id, set_at)
select u.id, max(a.created_at)
from auth.users u
join auth.audit_log_entries a
  on a.payload ->> 'actor_id' = u.id::text
 and a.payload ->> 'action' = 'user_updated_password'
where u.encrypted_password is not null
  and u.encrypted_password <> ''
group by u.id
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
