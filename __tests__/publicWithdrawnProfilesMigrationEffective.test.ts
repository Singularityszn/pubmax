// Migration 0157 against a real PostgreSQL 16 cluster: which profiles the one
// public withdrawal read answers, who may call it, and the rollback.
//
// The rule is a query over auth.users, private_social_accounts and profiles, so
// only running it proves it: a banned or suspended LIVE profile is withdrawn,
// a DELETED (tombstoned) profile is not, even though deletion also marks its
// Social account suspended, an expired ban has lifted, and a withdrawn
// profile's earlier handles are withdrawn with it.

import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260925120000_0157_public_withdrawn_profiles.sql",
);
const ROLLBACK_PATH = join(
  process.cwd(),
  "supabase/migrations/rollback/20260925120000_0157_public_withdrawn_profiles_rollback.sql",
);

const ID = {
  bannedUser: "00000000-0000-4000-8000-000000000001",
  expiredUser: "00000000-0000-4000-8000-000000000002",
  liveUser: "00000000-0000-4000-8000-000000000003",
  banned: "10000000-0000-4000-8000-000000000001",
  expired: "10000000-0000-4000-8000-000000000002",
  live: "10000000-0000-4000-8000-000000000003",
  suspended: "10000000-0000-4000-8000-000000000004",
  deleted: "10000000-0000-4000-8000-000000000005",
};

let session: PostgresSession | null = null;

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({
    label: "public-withdrawn-profiles-0157",
    database: "pubmax_public_withdrawn_profiles",
  });
  // The columns 0157 reads, and the three Supabase roles it grants against.
  session.sql(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;
    create schema auth;
    create table auth.users (id uuid primary key, banned_until timestamptz);
    create table public.profiles (
      id uuid primary key,
      handle text not null unique,
      user_id uuid,
      tombstoned_at timestamptz
    );
    create table public.private_social_accounts (
      profile_id uuid not null unique references public.profiles(id),
      ownership_state text not null default 'active'
    );
    create table public.profile_handle_aliases (
      profile_id uuid not null references public.profiles(id),
      handle text not null
    );
    insert into auth.users (id, banned_until) values
      ('${ID.bannedUser}', now() + interval '100 years'),
      ('${ID.expiredUser}', now() - interval '1 day'),
      ('${ID.liveUser}', null);
    insert into public.profiles (id, handle, user_id, tombstoned_at) values
      ('${ID.banned}', 'karansdad', '${ID.bannedUser}', null),
      ('${ID.expired}', 'lifted', '${ID.expiredUser}', null),
      ('${ID.live}', 'alice', '${ID.liveUser}', null),
      ('${ID.suspended}', 'nikhil_x', null, null),
      ('${ID.deleted}', 'departed', null, now());
    insert into public.private_social_accounts (profile_id, ownership_state) values
      ('${ID.live}', 'active'),
      ('${ID.suspended}', 'suspended'),
      ('${ID.deleted}', 'suspended');
    insert into public.profile_handle_aliases (profile_id, handle) values
      ('${ID.banned}', 'karansdad'),
      ('${ID.banned}', 'nikhil_old'),
      ('${ID.live}', 'alice_old'),
      ('${ID.deleted}', 'departed_old');
  `);
  session.applyFile(MIGRATION_PATH);
}, 180_000);

afterAll(async () => {
  await session?.stop();
});

describe.skipIf(skipReason !== null)("0157 public withdrawn profiles", () => {
  it("answers every handle of live banned and suspended profiles, never deleted or lifted ones", () => {
    expect(
      session!.sql(
        "select string_agg(handle, ',' order by handle) from public.public_withdrawn_profiles()",
      ),
    ).toBe("karansdad,nikhil_old,nikhil_x");
  });

  it("is callable by the service role alone", () => {
    expect(
      session!.sql(`
        select string_agg(r || ':' || has_function_privilege(r, 'public.public_withdrawn_profiles()', 'execute'), ',' order by r)
        from unnest(array['anon', 'authenticated', 'service_role']) as r
      `),
    ).toBe("anon:false,authenticated:false,service_role:true");
  });

  it("rolls back to no function", () => {
    session!.applyFile(ROLLBACK_PATH);
    expect(
      session!.sql("select to_regprocedure('public.public_withdrawn_profiles()') is null"),
    ).toBe("t");
  });
});
