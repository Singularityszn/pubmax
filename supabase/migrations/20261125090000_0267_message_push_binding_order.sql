-- Requires applied migration 0243. Apply before deploying ordered message alert bindings.
-- Each device write carries the order the device issued it in. A write changes a binding only when
-- it is newer than the write that made it, so a delayed release or restore cannot undo a later one.
begin;

alter table public.message_push_subscriptions
  add column bind_sequence bigint not null default 0 check (bind_sequence >= 0);

create function public.message_notification_bind_ordered(p_user_id uuid, p_session_id uuid, p_endpoint_hash text,
  p_token text, p_sequence bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_sequence is null or p_sequence < 1 then return false; end if;
  insert into public.message_push_subscriptions as current (endpoint_hash, user_id, session_id, token, bind_sequence)
    values (p_endpoint_hash, p_user_id, p_session_id, p_token, p_sequence)
  on conflict (endpoint_hash) do update set
    bind_sequence = excluded.bind_sequence,
    user_id = excluded.user_id, session_id = excluded.session_id, updated_at = now(),
    active_conversation_id = case when current.user_id = excluded.user_id and current.session_id = excluded.session_id then current.active_conversation_id end,
    last_seen = case when current.user_id = excluded.user_id and current.session_id = excluded.session_id then current.last_seen end,
    presence_activity_id = case when current.user_id = excluded.user_id and current.session_id = excluded.session_id then current.presence_activity_id else 0 end,
    presence_revision = case when current.user_id = excluded.user_id and current.session_id = excluded.session_id then current.presence_revision else 0 end,
    presence_generation = case when current.user_id = excluded.user_id and current.session_id = excluded.session_id then current.presence_generation else 0 end
  where current.token = excluded.token and current.bind_sequence < excluded.bind_sequence;
  return exists (select 1 from public.message_push_subscriptions s where s.endpoint_hash = p_endpoint_hash
    and s.token = p_token and s.user_id = p_user_id and s.session_id = p_session_id);
end;
$$;
revoke all on function public.message_notification_bind_ordered(uuid, uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.message_notification_bind_ordered(uuid, uuid, text, text, bigint) to service_role;

create function public.message_notification_release(p_endpoint_hash text, p_token text, p_sequence bigint, p_session_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.message_push_subscriptions s
  where s.endpoint_hash = p_endpoint_hash and s.token = p_token and s.bind_sequence < p_sequence
    and (p_session_id is null or s.session_id = p_session_id);
$$;
revoke all on function public.message_notification_release(text, text, bigint, uuid) from public, anon, authenticated;
grant execute on function public.message_notification_release(text, text, bigint, uuid) to service_role;

commit;
