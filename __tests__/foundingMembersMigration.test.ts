// Migration 0097: the founding number, its grant, and its rollback.
//
// Two halves, because they answer different questions.
//
// SHAPE pins the things a reader of the SQL must be able to rely on without a
// database in front of them: one lock on one constant key, a unique index, the
// cap stated in both SQL and TypeScript, a backfill ordered by arrival, and a
// rollback that removes everything the forward migration added.
//
// PROOF runs the real thing. It boots a throwaway PostgreSQL 16, applies the
// migration over a minimal profiles/aliases bootstrap, then fires a hundred and
// twenty claims from twelve concurrent connections. The count of distinct
// numbers is the only honest answer to "is the grant race-safe", and a lock
// written down is not the same as a lock that works.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

import { FOUNDING_MEMBER_CAP } from "@/lib/foundingMembers";

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260809140000_0097_founding_members.sql",
);
const ROLLBACK_PATH = join(
  process.cwd(),
  "supabase/migrations/rollback/20260809140000_0097_founding_members_rollback.sql",
);

const migration = readFileSync(MIGRATION_PATH, "utf8");
const rollback = readFileSync(ROLLBACK_PATH, "utf8");

/**
 * The migration's own backfill statement, lifted out of the file so the proof
 * below runs the shipped SQL rather than a paraphrase that could drift from it.
 */
const BACKFILL_STATEMENT = (() => {
  const start = migration.indexOf("with ranked as (");
  const end = migration.indexOf("\ncommit;", start);
  if (start < 0 || end < 0) {
    throw new Error("Migration 0097 no longer contains a recognisable backfill statement.");
  }
  return migration.slice(start, end).trim();
})();

describe.skipIf(skipReason !== null)("migration 0097 shape", () => {
  it("states the same cap the app does", () => {
    expect(FOUNDING_MEMBER_CAP).toBe(100);
    expect(migration).toMatch(
      /founding_member_number >= 1 and founding_member_number <= 100/,
    );
    expect(migration).toMatch(/v_taken >= 100 or v_highest >= 100/);
  });

  it("takes ONE advisory lock on a constant key, not on the handle", () => {
    // The claim's own lock is keyed on the handle, so two people claiming
    // different handles take different locks and would race for one number.
    expect(migration).toMatch(
      /pg_advisory_xact_lock\(hashtextextended\('pubmax:founding_member_number', 0\)\)/,
    );
  });

  it("backs the lock with a unique index on the number", () => {
    expect(migration).toMatch(
      /create unique index if not exists profiles_founding_member_number_key[\s\S]*?on public\.profiles \(founding_member_number\)[\s\S]*?where founding_member_number is not null/,
    );
  });

  it("keeps the grant helper in pubmax_private and off the browser roles", () => {
    expect(migration).toMatch(
      /create or replace function pubmax_private\.grant_founding_member_number\(/,
    );
    expect(migration).not.toMatch(
      /create or replace function public\.grant_founding_member_number\(/,
    );
    expect(migration).toMatch(
      /revoke all on function pubmax_private\.grant_founding_member_number\(uuid\)\s*\n?\s*from public, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /grant execute on function pubmax_private\.grant_founding_member_number\(uuid\)\s*\n?\s*to service_role;/,
    );
  });

  it("grants only to a claimed, live handle", () => {
    expect(migration).toMatch(/and user_id is not null\s*\n\s*and tombstoned_at is null/);
  });

  it("grants from inside the claim path so a rolled-back claim burns no number", () => {
    expect(migration).toMatch(/create or replace function public\.claim_pubmaxx_handle\(/);
    const grantCalls = migration.match(
      /pubmax_private\.grant_founding_member_number\(v_profile\.id\)/g,
    );
    // Both success exits: the fresh insert and the idempotent re-claim.
    expect(grantCalls).toHaveLength(2);
    expect(migration).toMatch(/'founding_member_number', v_founding/);
  });

  it("backfills oldest first, with a deterministic tie-break", () => {
    expect(migration).toMatch(
      /row_number\(\) over \(order by created_at asc, id asc\) as position/,
    );
    expect(migration).toMatch(/and ranked\.position <= 100/);
    // Re-applying must not renumber a cohort that already exists.
    expect(migration).toMatch(
      /and not exists \(\s*\n\s*select 1 from public\.profiles taken\s*\n\s*where taken\.founding_member_number is not null\s*\n\s*\)/,
    );
  });

  it("rolls back every object it added and restores the old claim function", () => {
    expect(rollback).toMatch(/drop column if exists founding_member_number/);
    expect(rollback).toMatch(/drop constraint if exists profiles_founding_member_number_check/);
    expect(rollback).toMatch(/drop index if exists public\.profiles_founding_member_number_key/);
    expect(rollback).toMatch(/drop index if exists public\.profiles_founding_member_wall_idx/);
    expect(rollback).toMatch(
      /drop function if exists pubmax_private\.grant_founding_member_number\(uuid\)/,
    );
    expect(rollback).toMatch(/create or replace function public\.claim_pubmaxx_handle\(/);
    expect(rollback).not.toMatch(/grant_founding_member_number\(v_profile\.id\)/);
  });
});

// ── The proof ────────────────────────────────────────────────────────────────

// The smallest schema migration 0097 needs: the profiles columns it reads and
// writes, and the alias table the claim path inserts into.
const BOOTSTRAP = `
  create extension if not exists "pgcrypto";
  create role anon noinherit;
  create role authenticated noinherit;
  create role service_role noinherit;
  create schema if not exists pubmax_private;
  grant usage on schema pubmax_private to authenticated, service_role;

  create table public.profiles (
    id uuid primary key default gen_random_uuid(),
    user_id uuid unique,
    handle text not null unique,
    tombstoned_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create table public.profile_handle_aliases (
    profile_id uuid not null references public.profiles(id) on delete cascade,
    handle text not null unique,
    is_current boolean not null default true
  );
`;

let session: PostgresSession | null = null;

/**
 * Each claim gets its own psql process, so each is its own connection and its
 * own transaction. That is what makes the advisory lock a real contest.
 */
function claim(live: PostgresSession, userId: string, handle: string): Promise<string> {
  return live.sqlAsync(
    `select public.claim_pubmaxx_handle('${userId}'::uuid, '${handle}')`,
  );
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({
    label: "founding-members-0097",
    database: "pubmax_founding_members",
  });
  session.sql(BOOTSTRAP);
  session.applyFile(MIGRATION_PATH);
}, 180_000);

afterAll(async () => {
  await session?.stop();
});

function requireSession(): PostgresSession {
  if (!session) throw new Error("the 0097 proof cluster is not running");
  return session;
}

function uuidFor(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

describe.skipIf(skipReason !== null)("migration 0097 in a real PostgreSQL", () => {
  it(
    "gives a hundred concurrent claims a hundred distinct numbers and no more",
    async () => {
      const live = requireSession();
      live.sql("truncate public.profile_handle_aliases, public.profiles cascade");

      const total = FOUNDING_MEMBER_CAP + 20;
      const fleet = 12;
      const queue = Array.from({ length: total }, (_, index) => index + 1);
      const workers = Array.from({ length: fleet }, async () => {
        for (;;) {
          const index = queue.shift();
          if (index === undefined) return;
          await claim(live, uuidFor(index), `founder_${String(index).padStart(3, "0")}`);
        }
      });
      await Promise.all(workers);

      expect(live.sql("select count(*) from public.profiles")).toBe(String(total));
      expect(
        live.sql(
          "select count(*) from public.profiles where founding_member_number is not null",
        ),
      ).toBe(String(FOUNDING_MEMBER_CAP));
      expect(
        live.sql(
          "select count(distinct founding_member_number) from public.profiles where founding_member_number is not null",
        ),
      ).toBe(String(FOUNDING_MEMBER_CAP));
      // Contiguous 1..100 with no gaps and nothing past the cap.
      expect(
        live.sql(
          "select min(founding_member_number) || '-' || max(founding_member_number) from public.profiles",
        ),
      ).toBe(`1-${FOUNDING_MEMBER_CAP}`);
    },
    180_000,
  );

  it("hands a re-claim its own number back rather than a second one", async () => {
    const live = requireSession();
    live.sql("truncate public.profile_handle_aliases, public.profiles cascade");

    const first = await claim(live, uuidFor(1), "same_person");
    const again = await claim(live, uuidFor(1), "same_person");
    expect(JSON.parse(first).founding_member_number).toBe(1);
    expect(JSON.parse(again).founding_member_number).toBe(1);
    expect(
      live.sql("select count(*) from public.profiles where founding_member_number is not null"),
    ).toBe("1");
  });

  it("refuses a duplicate number even if the lock were bypassed", async () => {
    const live = requireSession();
    live.sql("truncate public.profile_handle_aliases, public.profiles cascade");
    await claim(live, uuidFor(1), "first_in");
    await claim(live, uuidFor(2), "second_in");

    expect(() =>
      live.sql(
        "update public.profiles set founding_member_number = 1 where handle = 'second_in'",
      ),
    ).toThrow(/duplicate key|unique constraint/i);
    expect(() =>
      live.sql(
        "update public.profiles set founding_member_number = 101 where handle = 'second_in'",
      ),
    ).toThrow(/profiles_founding_member_number_check/i);
  });

  it("backfills the accounts already here oldest first", async () => {
    const live = requireSession();
    live.sql("truncate public.profile_handle_aliases, public.profiles cascade");
    // Three claimed accounts created out of alphabetical order, one unowned
    // legacy row, one tombstoned account. Only the claimed live ones count, and
    // the order is arrival, not the alphabet.
    live.sql(`
      insert into public.profiles (user_id, handle, created_at) values
        ('${uuidFor(11)}'::uuid, 'karanmrn', '2026-01-01T09:00:00Z'),
        ('${uuidFor(12)}'::uuid, 'karanszn', '2026-01-01T10:00:00Z'),
        ('${uuidFor(13)}'::uuid, 'a_latecomer', '2026-05-01T10:00:00Z'),
        ('${uuidFor(14)}'::uuid, 'departed', '2025-06-01T09:00:00Z');
      insert into public.profiles (handle, created_at)
        values ('legacy_anon', '2025-01-01T09:00:00Z');
      update public.profiles set tombstoned_at = now() where handle = 'departed';
    `);

    // Run the migration's OWN backfill statement, lifted from the file, so this
    // proves the shipped SQL rather than a paraphrase of it.
    live.sql(BACKFILL_STATEMENT);

    expect(
      live.sql(
        "select handle || '=' || founding_member_number from public.profiles where founding_member_number is not null order by founding_member_number",
      ),
    ).toBe(["karanmrn=1", "karanszn=2", "a_latecomer=3"].join("\n"));
    // Neither the unowned legacy row nor the departed account is in the cohort.
    expect(
      live.sql(
        "select count(*) from public.profiles where founding_member_number is null",
      ),
    ).toBe("2");

    // Re-applying is a no-op: a cohort that exists is never renumbered.
    live.sql(BACKFILL_STATEMENT);
    expect(
      live.sql("select count(*) from public.profiles where founding_member_number is not null"),
    ).toBe("3");
  });
});
