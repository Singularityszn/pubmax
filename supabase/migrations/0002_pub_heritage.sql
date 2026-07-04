-- Retrieved heritage facts for a pub, one row per fact, each carrying its source.
-- Read best-effort by lib/heritage.ts when Supabase is configured; public read-only.

create table if not exists pub_heritage (
  id           bigint generated always as identity primary key,
  pub_id       text,
  source       text        not null,
  fact         text        not null,
  source_ref   text,
  retrieved_at timestamptz  default now()
);

create index if not exists pub_heritage_pub_id_idx on pub_heritage (pub_id);

alter table pub_heritage enable row level security;

create policy "pub_heritage public read"
  on pub_heritage for select
  using (true);
