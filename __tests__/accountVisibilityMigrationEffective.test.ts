// Migration 0154 against a real PostgreSQL 16 cluster: the fault before, the
// column after, and the rollback.
//
// Three things a shape test over the SQL text cannot prove, and all three are
// the reason this proof exists. The default really states what an existing row
// already was. The CHECK really refuses a third word, so the vocabulary in
// `lib/accountVisibility.ts` is mirrored rather than merely described. And the
// migration really moves NO grant and NO policy: the column that says what to
// withhold must not become the one column a browser JWT can read about every
// account at once.

import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ACCOUNT_VISIBILITIES } from "@/lib/accountVisibility";

import {
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260908090000_0154_account_visibility.sql",
);
const ROLLBACK_PATH = join(
  process.cwd(),
  "supabase/migrations/rollback/20260908090000_0154_account_visibility_rollback.sql",
);

let session: PostgresSession | null = null;
/** The policy set on `public.profiles` before 0154 runs, read back after it. */
let policiesBefore = "";

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({
    label: "account-visibility-0154",
    database: "pubmax_account_visibility",
  });
  // The pre-0154 shape: the columns this migration touches, the three Supabase
  // roles, and the grant plus owner policy migration 0067 leaves behind. `anon`
  // deliberately gets nothing on this table, which is what makes every public
  // read of somebody else's profile go through the service-role route.
  // `auth.uid()` is a platform function the fixture does not have, and the owner
  // policy below only has to EXIST for this proof, so a stand-in keeps the create
  // honest without pulling GoTrue in.
  session.sql(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit;

    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql stable as $$
      select null::uuid
    $$;

    create table public.profiles (
      id uuid primary key default gen_random_uuid(),
      handle text not null unique,
      user_id uuid,
      display_name text,
      bio text,
      home_city text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    alter table public.profiles enable row level security;
    grant select on table public.profiles to authenticated;
    grant select, insert, update, delete on table public.profiles to service_role;

    create policy profiles_owner_select
      on public.profiles for select to authenticated
      using (user_id = (select auth.uid()));
  `);
  session.sql(`
    insert into public.profiles (handle, display_name, bio, home_city)
    values ('night_person', 'Night Person', 'A bio', 'Camden');
  `);
  policiesBefore = session.sql(`
    select coalesce(string_agg(policyname || '|' || cmd || '|' || coalesce(qual, ''), ',' order by policyname), '')
    from pg_policies where schemaname = 'public' and tablename = 'profiles'
  `);
}, 180_000);

afterAll(async () => {
  await session?.stop();
});

function requireSession(): PostgresSession {
  if (!session) throw new Error("PostgreSQL account-visibility session did not start.");
  return session;
}

function columnExists(): boolean {
  return (
    requireSession().sql(`
      select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = 'visibility'
    `) === "1"
  );
}

describe.skipIf(skipReason !== null)("migration 0154 account visibility", () => {
  it("reproduces the fault first: there is nowhere to record the choice", () => {
    expect(columnExists()).toBe(false);
    const refusal = requireSession().expectRefusal(
      "update public.profiles set visibility = 'private' where handle = 'night_person'",
    );
    expect(refusal).toMatch(/visibility/i);
  });

  it("adds the column and states what every existing row already was", () => {
    requireSession().applyFile(MIGRATION_PATH);
    expect(columnExists()).toBe(true);
    expect(
      requireSession().sql(
        "select visibility from public.profiles where handle = 'night_person'",
      ),
    ).toBe("public");
  });

  it("is idempotent, so a re-apply is not an error", () => {
    requireSession().applyFile(MIGRATION_PATH);
    expect(columnExists()).toBe(true);
  });

  it("takes both words of the vocabulary and refuses a third", async () => {
    for (const word of ACCOUNT_VISIBILITIES) {
      const taken = await requireSession().attempt(
        `update public.profiles set visibility = '${word}' where handle = 'night_person'`,
      );
      expect(taken.ok).toBe(true);
    }
    const refusal = requireSession().expectRefusal(
      "update public.profiles set visibility = 'friends' where handle = 'night_person'",
    );
    expect(refusal).toMatch(/profiles_visibility_check/i);
  });

  it("refuses a null, so no row can carry an unreadable choice", () => {
    const refusal = requireSession().expectRefusal(
      "update public.profiles set visibility = null where handle = 'night_person'",
    );
    expect(refusal).toMatch(/null/i);
  });

  // The column that says what to withhold may not be the one a stranger reads.
  it("moves no grant: anon still reads nothing on this table", () => {
    expect(
      requireSession().sql(
        "select has_column_privilege('anon', 'public.profiles', 'visibility', 'select')",
      ),
    ).toBe("f");
    expect(
      requireSession().sql(
        "select has_column_privilege('authenticated', 'public.profiles', 'visibility', 'select')",
      ),
    ).toBe("t");
    expect(
      requireSession().sql(
        "select has_column_privilege('authenticated', 'public.profiles', 'visibility', 'update')",
      ),
    ).toBe("f");
  });

  it("moves no policy: the owner-only SELECT is the same policy it was", () => {
    const after = requireSession().sql(`
      select coalesce(string_agg(policyname || '|' || cmd || '|' || coalesce(qual, ''), ',' order by policyname), '')
      from pg_policies where schemaname = 'public' and tablename = 'profiles'
    `);
    expect(after).toBe(policiesBefore);
    expect(after).toContain("profiles_owner_select");
  });

  it("rolls back to the pre-0154 shape and keeps every row", () => {
    requireSession().sql(
      "update public.profiles set visibility = 'private' where handle = 'night_person'",
    );
    requireSession().applyFile(ROLLBACK_PATH);
    expect(columnExists()).toBe(false);
    expect(
      requireSession().sql(
        "select count(*) from pg_constraint where conname = 'profiles_visibility_check'",
      ),
    ).toBe("0");
    // The cost the rollback's own header names: the row survives, the choice does
    // not, and an absent column reads as public again.
    expect(
      requireSession().sql(
        "select display_name || '/' || bio from public.profiles where handle = 'night_person'",
      ),
    ).toBe("Night Person/A bio");
  });
});
