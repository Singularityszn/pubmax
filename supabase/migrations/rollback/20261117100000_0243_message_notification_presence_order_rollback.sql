-- Removes the ordered presence RPC and its ordering counters.
-- Preserves message alert consent, subscriptions, mutes, claims and current presence.
begin;

drop function public.message_notification_presence_start(uuid, uuid, text, text);
drop function public.message_notification_presence(uuid, uuid, text, text, uuid, bigint, bigint);

create or replace function public.message_notification_bind(p_user_id uuid, p_session_id uuid, p_endpoint_hash text, p_token text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  insert into public.message_push_subscriptions as current (endpoint_hash, user_id, session_id, token)
    values (p_endpoint_hash, p_user_id, p_session_id, p_token)
  on conflict (endpoint_hash) do update set
    user_id = excluded.user_id, session_id = excluded.session_id,
    active_conversation_id = null, last_seen = null, updated_at = now()
  where current.token = excluded.token
    and (current.user_id is distinct from excluded.user_id or current.session_id is distinct from excluded.session_id);
  get diagnostics changed = row_count;
  if changed > 0 then return true; end if;
  return exists (select 1 from public.message_push_subscriptions s where s.endpoint_hash = p_endpoint_hash
    and s.token = p_token and s.user_id = p_user_id and s.session_id = p_session_id);
end;
$$;
revoke all on function public.message_notification_bind(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.message_notification_bind(uuid, uuid, text, text) to service_role;

alter table public.message_push_subscriptions
  drop column presence_activity_id,
  drop column presence_revision,
  drop column presence_generation;

commit;
