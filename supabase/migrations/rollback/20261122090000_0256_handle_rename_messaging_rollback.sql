-- Rollback 0256: restores the 0177 body of `rename_pubmaxx_handle`, which
-- writes only `profiles` and `profile_handle_aliases`. A rename after this
-- rollback leaves the account's conversations, group seats, chat deletions,
-- poll votes, sent messages and notifications under the old handle, so the
-- inbox looks empty again (audit F11). Rows that 0256 already moved stay under
-- the new handle. No row is touched.

begin;

comment on column public.messages.sender_profile_id is
  'The profile that sent this message, stamped from profile_handle_aliases on insert. sender_handle is text captured at send time and a rename does not rewrite it, so this is the identity account deletion joins on (0151).';

comment on column public.messages.sender_handle is null;

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
