// Migration 0159 on PostgreSQL 16: duplicate round_spends index removal,
// pub_presence policy merge with identical SELECT rows, and rollback.

import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260927120000_0159_supabase_hygiene.sql",
);
const ROLLBACK_PATH = join(
  process.cwd(),
  "supabase/migrations/rollback/20260927120000_0159_supabase_hygiene_rollback.sql",
);

const LIVE = "10000000-0000-4000-8000-0000000000a1";
const EXPIRED = "10000000-0000-4000-8000-0000000000a2";

let session: PostgresSession | null = null;

function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL hygiene session did not start.");
  return session;
}

function installPre0159PresencePolicies(): void {
  db().sql(`
    drop policy if exists pub_presence_public_read on public.pub_presence;
    drop policy if exists pub_presence_client_deny on public.pub_presence;
    create policy pub_presence_public_read
      on public.pub_presence for select using (expires_at > now());
    create policy pub_presence_client_deny
      on public.pub_presence for all to anon, authenticated using (false) with check (false);
    revoke all on public.pub_presence from anon, authenticated;
    grant select on public.pub_presence to anon, authenticated;
  `);
}

function visiblePresenceIdsAsAnon(): string[] {
  const session = db();
  const out = execFileSync(session.psql, [
    ...session.databaseArgs,
    "-q",
    "-t",
    "-A",
    "-c",
    "begin; set local role anon; select id::text from public.pub_presence order by id; commit;",
  ], { encoding: "utf8" });
  return out
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function roundSpendsUniqueIndexCount(): number {
  return Number(
    db().sql(`
      select count(*)::text
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'round_spends'
        and indexdef like '%UNIQUE%'
        and indexdef like '%round_id%'
        and indexdef like '%client_ref%'
    `),
  );
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "supabase-hygiene-0159", database: "pubmax_supabase_hygiene" });
  db().sql(`
    create role anon nologin noinherit;
    create role authenticated nologin noinherit;
    create role service_role nologin noinherit bypassrls;

    create table public.rounds (id uuid primary key);
    insert into public.rounds (id) values ('20000000-0000-4000-8000-000000000001');

    create table public.round_spends (
      id uuid primary key,
      round_id uuid not null references public.rounds(id) on delete cascade,
      client_ref text not null,
      payer_handle text not null,
      recorded_by_handle text not null,
      venue_id text not null,
      venue_name text not null,
      total_pence integer not null,
      items jsonb not null default '[]'::jsonb,
      recorded_at timestamptz not null default now(),
      unique (round_id, client_ref)
    );
    create unique index round_spends_round_client_ref_idx
      on public.round_spends (round_id, client_ref);

    create table public.pub_presence (
      id uuid primary key,
      handle text not null,
      venue_id text not null,
      actor_hash text not null,
      created_at timestamptz not null default now(),
      expires_at timestamptz not null
    );
    alter table public.pub_presence enable row level security;
    alter table public.pub_presence force row level security;

    insert into public.pub_presence (id, handle, venue_id, actor_hash, expires_at) values
      ('${LIVE}', 'alice', 'venue-1', 'hash-a', now() + interval '1 hour'),
      ('${EXPIRED}', 'bob', 'venue-1', 'hash-b', now() - interval '1 hour');
  `);
  installPre0159PresencePolicies();
}, 180_000);

afterAll(async () => {
  await session?.stop();
});

describe.skipIf(skipReason !== null)("migration 0159 supabase hygiene", () => {
  it("reproduces duplicate round_spends indexes and overlapping presence policies", () => {
    expect(roundSpendsUniqueIndexCount()).toBe(2);
    const policies = db().sql(`
      select policyname from pg_policies
      where schemaname = 'public' and tablename = 'pub_presence'
      order by policyname
    `);
    expect(policies).toContain("pub_presence_client_deny");
    expect(policies).toContain("pub_presence_public_read");
    expect(visiblePresenceIdsAsAnon()).toEqual([LIVE]);
  });

  it("merges pub_presence SELECT without changing visible rows", () => {
    const before = visiblePresenceIdsAsAnon();
    db().applyFile(MIGRATION_PATH);
    const after = visiblePresenceIdsAsAnon();
    expect(after).toEqual(before);
    expect(roundSpendsUniqueIndexCount()).toBe(1);
    const policies = db().sql(`
      select policyname from pg_policies
      where schemaname = 'public' and tablename = 'pub_presence'
      order by policyname
    `);
    expect(policies).toContain("pub_presence_public_read");
    expect(policies).toContain("pub_presence_client_insert_deny");
    expect(
      db().sql(`
        select count(*)::text from pg_indexes
        where schemaname = 'public' and indexname = 'pub_presence_expires_created_idx'
      `),
    ).toBe("1");
  });

  it("rolls back and can re-apply forward", () => {
    db().applyFile(ROLLBACK_PATH);
    expect(roundSpendsUniqueIndexCount()).toBe(2);
    installPre0159PresencePolicies();
    expect(visiblePresenceIdsAsAnon()).toEqual([LIVE]);
    db().applyFile(MIGRATION_PATH);
    expect(visiblePresenceIdsAsAnon()).toEqual([LIVE]);
  });
});
