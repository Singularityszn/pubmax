-- Requires applied migration 0242. Apply before deploying server-allocated presence clients.
begin;

alter table public.message_push_subscriptions
  add column presence_activity_id bigint not null default 0 check (presence_activity_id >= 0),
  add column presence_generation bigint not null default 0 check (presence_generation between 0 and 9007199254740991),
  add column presence_revision bigint not null default 0 check (presence_revision >= 0);

create or replace function public.message_notification_bind(p_user_id uuid, p_session_id uuid, p_endpoint_hash text, p_token text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  insert into public.message_push_subscriptions as current (endpoint_hash, user_id, session_id, token)
    values (p_endpoint_hash, p_user_id, p_session_id, p_token)
  on conflict (endpoint_hash) do update set
    user_id = excluded.user_id, session_id = excluded.session_id,
    active_conversation_id = null, last_seen = null, presence_activity_id = 0, presence_revision = 0, presence_generation = 0, updated_at = now()
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

create function public.message_notification_presence_start(p_user_id uuid, p_session_id uuid, p_endpoint_hash text, p_token text)
returns bigint language sql security definer set search_path = '' as $$
  update public.message_push_subscriptions s
  set presence_generation = greatest(s.presence_generation, s.presence_activity_id) + 1
  where s.endpoint_hash = p_endpoint_hash and s.token = p_token and s.user_id = p_user_id and s.session_id = p_session_id
    and greatest(s.presence_generation, s.presence_activity_id) < 9007199254740991
  returning presence_generation;
$$;
revoke all on function public.message_notification_presence_start(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.message_notification_presence_start(uuid, uuid, text, text) to service_role;

create function public.message_notification_presence(p_user_id uuid, p_session_id uuid, p_endpoint_hash text,
  p_token text, p_conversation_id uuid, p_activity_id bigint, p_revision bigint)
returns boolean language sql security definer set search_path = '' as $$
  with changed as (update public.message_push_subscriptions s set
    presence_revision = p_revision,
    presence_activity_id = p_activity_id,
    active_conversation_id = p_conversation_id,
    last_seen = now()
  where s.endpoint_hash = p_endpoint_hash and s.token = p_token and s.user_id = p_user_id and s.session_id = p_session_id
    and p_activity_id between 1 and 9007199254740991 and p_revision between 1 and 9007199254740991
    and p_activity_id <= s.presence_generation
    and (p_activity_id > s.presence_activity_id or (p_activity_id = s.presence_activity_id and p_revision > s.presence_revision))
  returning 1) select exists (select 1 from changed);
$$;
revoke all on function public.message_notification_presence(uuid, uuid, text, text, uuid, bigint, bigint) from public, anon, authenticated;
grant execute on function public.message_notification_presence(uuid, uuid, text, text, uuid, bigint, bigint) to service_role;

commit;
