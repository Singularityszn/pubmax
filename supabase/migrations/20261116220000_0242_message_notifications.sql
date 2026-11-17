begin;

create table public.message_notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  preview boolean not null default false
);

create table public.message_push_subscriptions (
  endpoint_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  token text not null check (length(token) between 1 and 2048),
  active_conversation_id uuid references public.conversations(id) on delete set null,
  last_seen timestamptz,
  updated_at timestamptz not null default now()
);
create index message_push_subscriptions_session_idx on public.message_push_subscriptions(session_id);
create index message_push_subscriptions_user_idx on public.message_push_subscriptions(user_id, updated_at desc);
create index message_push_subscriptions_active_conversation_idx on public.message_push_subscriptions(active_conversation_id);

create table public.message_notification_mutes (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  primary key (user_id, conversation_id)
);

create table public.message_notification_claims (
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  primary key (user_id, message_id)
);
create index message_notification_mutes_conversation_idx on public.message_notification_mutes(conversation_id);
create index message_notification_claims_message_idx on public.message_notification_claims(message_id);

alter table public.message_notification_preferences enable row level security;
alter table public.message_push_subscriptions enable row level security;
alter table public.message_notification_mutes enable row level security;
alter table public.message_notification_claims enable row level security;
revoke all on public.message_notification_preferences, public.message_push_subscriptions,
  public.message_notification_mutes, public.message_notification_claims from public, anon, authenticated;
grant all on public.message_notification_preferences, public.message_push_subscriptions,
  public.message_notification_mutes, public.message_notification_claims to service_role;

create function public.message_notification_session_active(p_user_id uuid, p_session_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  return exists (select 1 from auth.sessions where id = p_session_id and user_id = p_user_id
    and (not_after is null or not_after > now()));
exception when undefined_table or undefined_column then
  return false;
end;
$$;
revoke all on function public.message_notification_session_active(uuid, uuid) from public, anon, authenticated;
grant execute on function public.message_notification_session_active(uuid, uuid) to service_role;

create function public.message_notification_targets(p_user_id uuid, p_conversation_id uuid)
returns table (token text) language plpgsql security definer set search_path = '' as $$
begin
  delete from public.message_push_subscriptions s where s.user_id = p_user_id
    and not public.message_notification_session_active(p_user_id, s.session_id);
  return query select s.token from public.message_push_subscriptions s
    where s.user_id = p_user_id and (s.active_conversation_id is distinct from p_conversation_id
      or s.last_seen is null or s.last_seen < now() - interval '30 seconds')
    order by s.updated_at desc limit 20;
end;
$$;
revoke all on function public.message_notification_targets(uuid, uuid) from public, anon, authenticated;
grant execute on function public.message_notification_targets(uuid, uuid) to service_role;

commit;
