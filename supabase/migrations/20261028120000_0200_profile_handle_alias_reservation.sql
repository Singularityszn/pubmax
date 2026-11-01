-- 0200 reserves a retired alias against every other profile row (audit finding
-- lib/profileOwnership:gateHandleAction-unlinked-lane-ignores-tombstone-and-retired-alias).
-- A renamed account's previous handle stays in profile_handle_aliases and has
-- no profiles row. The claim and rename RPCs refuse it as taken, but a bare
-- insert (profileStore.ensure() on the one-tap price, follow and check-in
-- paths) could mint a second, unowned profiles row under it, and the anonymous
-- demo lane then wrote content under the renamed account's old name.
-- This trigger refuses an insert, or a handle change, onto a handle the alias
-- ledger assigns to a DIFFERENT profile. The rename RPC writes the new alias
-- before it moves profiles.handle, so a profile still takes its own alias.
-- Existing rows are not re-checked: the trigger fires only on insert and on
-- update of handle. The function lives in pubmax_private, outside the
-- PostgREST schema, and no client role may execute it.
-- Captain applies this migration. Rollback drops the trigger and the function.

begin;

create or replace function pubmax_private.refuse_profile_handle_held_by_alias()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
      from public.profile_handle_aliases as alias
     where lower(alias.handle) = lower(new.handle)
       and alias.profile_id <> new.id
  ) then
    raise exception 'profile handle % is held by another profile''s alias', new.handle
      using errcode = '23505';
  end if;
  return new;
end;
$$;

revoke all on function pubmax_private.refuse_profile_handle_held_by_alias() from public;
revoke all on function pubmax_private.refuse_profile_handle_held_by_alias() from anon;
revoke all on function pubmax_private.refuse_profile_handle_held_by_alias() from authenticated;

drop trigger if exists profiles_handle_not_held_by_alias on public.profiles;
create trigger profiles_handle_not_held_by_alias
  before insert or update of handle on public.profiles
  for each row
  execute function pubmax_private.refuse_profile_handle_held_by_alias();

commit;
