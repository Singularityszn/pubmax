-- Crowd occupancy moderation (0109): reader flag and moderator hide.
-- Captain / firstmate applies. Agents ship SQL only.
--
-- WHAT THIS ADDS: a stamp and a flag ledger for venue_occupancy_reports,
-- the same shape community prices already use. A reader can FLAG a now
-- reading. A moderator can HIDE it. Hide never deletes. Reporting never
-- auto-hides: one account must not erase a pub's now reading.
--
-- Apply AFTER 0107. The browser still never touches these tables.

begin;

alter table public.venue_occupancy_reports
  add column if not exists hidden_at timestamptz,
  add column if not exists reported_at timestamptz,
  add column if not exists report_reason text,
  add column if not exists report_count integer not null default 0;

comment on column public.venue_occupancy_reports.hidden_at is
  'Moderator hide stamp. Null means visible. Hide never deletes the row.';
comment on column public.venue_occupancy_reports.report_count is
  'Distinct reporter count. A flag never hides the reading.';

create index if not exists venue_occupancy_reports_review_idx
  on public.venue_occupancy_reports (reported_at desc)
  where report_count > 0 or hidden_at is not null;

create table if not exists public.venue_occupancy_flags (
  id uuid primary key default gen_random_uuid(),
  occupancy_report_id uuid not null references public.venue_occupancy_reports (id) on delete cascade,
  actor_hash text,
  reason text,
  created_at timestamptz not null default now(),
  unique (occupancy_report_id, actor_hash)
);

comment on table public.venue_occupancy_flags is
  'Per-actor occupancy flags. Service-role only. Reporting never hides.';

alter table public.venue_occupancy_flags enable row level security;

revoke all on table public.venue_occupancy_flags from public, anon, authenticated;
grant select, insert, update, delete on table public.venue_occupancy_flags to service_role;

drop policy if exists venue_occupancy_flags_anon_deny on public.venue_occupancy_flags;
create policy venue_occupancy_flags_anon_deny
  on public.venue_occupancy_flags for all to anon
  using (false) with check (false);

drop policy if exists venue_occupancy_flags_authenticated_deny on public.venue_occupancy_flags;
create policy venue_occupancy_flags_authenticated_deny
  on public.venue_occupancy_flags for all to authenticated
  using (false) with check (false);

-- Insert-the-ledger-then-count. Unknown id returns null (route maps to 404).
-- A same-actor repeat answers true without moving the counter.
-- Nothing in this function may stamp a hide.
create or replace function public.report_occupancy_report(
  p_id uuid,
  p_actor_hash text,
  p_reason text
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_inserted boolean;
begin
  if not exists (select 1 from public.venue_occupancy_reports where id = p_id) then
    return null;
  end if;

  insert into public.venue_occupancy_flags (occupancy_report_id, actor_hash, reason)
  values (p_id, nullif(p_actor_hash, ''), nullif(p_reason, ''))
  on conflict (occupancy_report_id, actor_hash) do nothing;
  v_inserted := found;

  if not v_inserted then
    return true;
  end if;

  update public.venue_occupancy_reports
     set report_count  = coalesce(report_count, 0) + 1,
         reported_at   = now(),
         report_reason = coalesce(nullif(p_reason, ''), report_reason)
   where id = p_id;

  return true;
end;
$$;

revoke all on function public.report_occupancy_report(uuid, text, text) from public, anon, authenticated;
grant execute on function public.report_occupancy_report(uuid, text, text) to service_role;

commit;
