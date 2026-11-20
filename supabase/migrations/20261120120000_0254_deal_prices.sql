create table if not exists public.deal_prices (
  id uuid primary key default gen_random_uuid(),
  venue_id text not null,
  drink_category text not null check (drink_category in ('beer', 'wine', 'whisky', 'gin', 'vodka', 'rum', 'cocktail', 'shot', 'alcohol-free', 'soft-drink', 'coffee', 'other')),
  drink text not null check (char_length(drink) between 1 and 100),
  measure text not null check (measure in ('pint','half','125ml','175ml','250ml','bottle','single','double','other')),
  measure_label text not null default '' check (char_length(measure_label) <= 24),
  end_date date,
  price_pennies integer not null check (price_pennies between 100 and 3000),
  days smallint[] not null check (cardinality(days) between 1 and 7 and array_position(days, null) is null and days <@ array[0,1,2,3,4,5,6]::smallint[]),
  starts_at time not null,
  ends_at time not null,
  conditions text not null default '' check (char_length(conditions) <= 200),
  actor text not null,
  submitted_at timestamptz not null default now(),
  hidden boolean not null default false,
  reviewed_at timestamptz,
  revision uuid not null default gen_random_uuid(),
  check (starts_at <> ends_at),
  check (array_lower(days, 1) = 1 and days[1] < days[2] and days[2] < days[3]
    and days[3] < days[4] and days[4] < days[5] and days[5] < days[6] and days[6] < days[7]),
  check ((measure = 'other' and char_length(measure_label) > 0) or (measure <> 'other' and measure_label = '')),
  unique (venue_id, drink_category, drink, measure, measure_label, actor, days, starts_at, ends_at)
);

create index if not exists deal_prices_venue_recent_idx on public.deal_prices (venue_id, submitted_at desc);
create index if not exists deal_prices_recent_idx on public.deal_prices (submitted_at desc) where not hidden;
alter table public.deal_prices enable row level security;
revoke all on public.deal_prices from anon, authenticated;
grant all on public.deal_prices to service_role;

create table if not exists public.deal_price_reports (
  deal_id uuid not null references public.deal_prices(id) on delete cascade,
  actor_hash text not null,
  created_at timestamptz not null default now(),
  primary key (deal_id, actor_hash)
);
alter table public.deal_price_reports enable row level security;
revoke all on public.deal_price_reports from anon, authenticated;
grant all on public.deal_price_reports to service_role;

create or replace function public.report_deal_price(p_id uuid, p_actor_hash text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_actor_hash is null or length(p_actor_hash) = 0 then return false; end if;
  perform 1 from public.deal_prices where id = p_id for update;
  if not found then return false; end if;
  insert into public.deal_price_reports as reports (deal_id, actor_hash, created_at) values (p_id, p_actor_hash, clock_timestamp())
    on conflict (deal_id, actor_hash) do update set created_at = excluded.created_at
    where reports.created_at <= (select reviewed_at from public.deal_prices where id = p_id);
  return true;
end;
$$;
revoke all on function public.report_deal_price(uuid, text) from public, anon, authenticated;
grant execute on function public.report_deal_price(uuid, text) to service_role;

create or replace function public.moderate_deal_price(p_id uuid, p_revision uuid, p_hidden boolean)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.deal_prices set hidden = p_hidden, reviewed_at = clock_timestamp(), revision = gen_random_uuid()
    where id = p_id and revision = p_revision;
  return found;
end;
$$;
revoke all on function public.moderate_deal_price(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.moderate_deal_price(uuid, uuid, boolean) to service_role;

create or replace function public.list_deals_for_review()
returns setof public.deal_prices language sql stable security invoker set search_path = '' as $$
  select d.* from public.deal_prices d
  where d.hidden or exists (
    select 1 from public.deal_price_reports r
    where r.deal_id = d.id and (d.reviewed_at is null or r.created_at > d.reviewed_at)
  );
$$;
revoke all on function public.list_deals_for_review() from public, anon, authenticated;
grant execute on function public.list_deals_for_review() to service_role;
