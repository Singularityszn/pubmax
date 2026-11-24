begin;

create function public._refuse_retired_messaging_handle()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_handles text[];
  v_profiles uuid[];
  v_profile uuid;
begin
  select array_agg(pg_catalog.lower(pg_catalog.to_jsonb(new) ->> c))
    into v_handles from pg_catalog.unnest(tg_argv) c;
  if tg_op = 'UPDATE' then
    select array_agg(h) into v_handles from pg_catalog.unnest(v_handles) h
     where not exists (select 1 from pg_catalog.unnest(tg_argv) c
                        where pg_catalog.lower(pg_catalog.to_jsonb(old) ->> c) = h);
  end if;
  select array_agg(m.id order by m.id) into v_profiles
    from (
      select p.id from public.profiles p where pg_catalog.lower(p.handle) = any(v_handles)
      union
      select a.profile_id from public.profile_handle_aliases a
       where pg_catalog.lower(a.handle) = any(v_handles)
    ) m;
  foreach v_profile in array coalesce(v_profiles, array[]::uuid[]) loop
    perform public._lock_live_author(v_profile);
  end loop;
  perform p.id from public.profiles p where p.id = any(v_profiles)
    order by p.id for share;
  if exists (
    select 1 from public.profile_handle_aliases a
    join public.profiles p on p.id = a.profile_id
    where pg_catalog.lower(a.handle) = any(v_handles)
      and pg_catalog.lower(p.handle) <> pg_catalog.lower(a.handle)
  ) then
    raise exception using errcode = '23514', message = 'messaging_handle_retired';
  end if;
  return new;
end;
$$;

revoke all on function public._refuse_retired_messaging_handle()
  from public, anon, authenticated, service_role;

create trigger conversations_refuse_retired_handle
  before insert or update of handle_a, handle_b on public.conversations
  for each row execute function public._refuse_retired_messaging_handle('handle_a', 'handle_b');
create trigger conversation_members_refuse_retired_handle
  before insert or update of handle on public.conversation_members
  for each row execute function public._refuse_retired_messaging_handle('handle');
create trigger conversation_deletions_refuse_retired_handle
  before insert or update of handle on public.conversation_deletions
  for each row execute function public._refuse_retired_messaging_handle('handle');
create trigger message_poll_votes_refuse_retired_handle
  before insert or update of voter_handle on public.message_poll_votes
  for each row execute function public._refuse_retired_messaging_handle('voter_handle');
create trigger messages_refuse_retired_handle
  before insert or update of sender_handle on public.messages
  for each row execute function public._refuse_retired_messaging_handle('sender_handle');
create trigger notifications_refuse_retired_handle
  before insert or update of recipient_handle on public.notifications
  for each row execute function public._refuse_retired_messaging_handle('recipient_handle');

commit;
