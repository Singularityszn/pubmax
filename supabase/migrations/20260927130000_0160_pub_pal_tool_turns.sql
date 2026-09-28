-- Ephemeral correlation for ElevenLabs tool webhooks during one Pal turn (0160).
-- Keys are provider conversation ids; rows expire quickly and hold no account id.

create table if not exists public.pub_pal_tool_turns (
  conversation_id text primary key,
  payload         jsonb not null,
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now()
);

create index if not exists pub_pal_tool_turns_expires_at_idx
  on public.pub_pal_tool_turns (expires_at);

alter table public.pub_pal_tool_turns enable row level security;

revoke all on public.pub_pal_tool_turns from anon, authenticated;
grant all on public.pub_pal_tool_turns to service_role;
