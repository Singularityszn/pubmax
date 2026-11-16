-- A nearby Been stores only its account, pub and first check-in time.
-- Only the server may write proof after checking an explicitly shared fix.
create table if not exists public.nearby_visits (
  user_id uuid not null references auth.users(id) on delete cascade,
  venue_id text not null check (length(venue_id) between 1 and 200),
  checked_at timestamptz not null default now(),
  primary key (user_id, venue_id)
);

alter table public.nearby_visits enable row level security;
revoke all on public.nearby_visits from public, anon, authenticated, service_role;
grant select, insert on public.nearby_visits to service_role;
