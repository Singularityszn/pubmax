-- Rollback 0173: read "has a password" off the hash alone again.
--
-- COST. This brings the 0173 fault back: every email-link sign-up answers
-- true, so the account hub asks those accounts for a current password they
-- never had and they cannot set up the handle + password sign-in. The record
-- of which owners set a password is dropped with its table. Applying 0173
-- again rebuilds it from `auth.audit_log_entries`, but not for a password
-- set by an admin call, which that log does not name.

begin;

drop trigger if exists account_password_set_on_auth_user_update on auth.users;
drop function if exists pubmax_private.record_account_password_set();
drop table if exists pubmax_private.account_password_set;

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
    where u.id = p_user_id
      and u.encrypted_password is not null
      and u.encrypted_password <> ''
  );
$$;

comment on function public.account_has_password(uuid) is
  'True when the account carries a password in Supabase auth. Returns one boolean and never the hash. Service role only: a browser-callable version would be an oracle for which accounts have passwords.';

revoke all on function public.account_has_password(uuid) from public;
revoke all on function public.account_has_password(uuid) from anon;
revoke all on function public.account_has_password(uuid) from authenticated;
grant execute on function public.account_has_password(uuid) to service_role;

commit;
