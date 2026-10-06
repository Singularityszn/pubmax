// Effective proof for 0107. This file APPLIES the migration to a real
// PostgreSQL 16 and exercises the table as the three Supabase roles, because a
// policy is a claim about what a role may do and only the database can answer
// that.
//
// Same host contract as the other effective migration proofs
// (rateLimitExpiryMigration, foundingMembersMigration): a host with no
// PostgreSQL binaries skips loudly rather than passing quietly.

import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260816180000_0107_venue_occupancy_reports.sql",
);
const ROLLBACK_PATH = join(
  process.cwd(),
  "supabase/migrations/rollback/20260816180000_0107_venue_occupancy_reports_rollback.sql",
);

const REPORTER = "00000000-0000-4000-8000-000000000011";

let session: PostgresSession | null = null;

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "occupancy-0107", database: "pubmax_occupancy_0107" });
  // The Supabase roles this table is governed by. service_role carries
  // BYPASSRLS in a Supabase project, so the local cluster mirrors that or
  // "the write path still works" would not be the thing under test.
  session.sql(`
    create role anon nologin noinherit;
    create role authenticated nologin noinherit;
    create role service_role nologin noinherit bypassrls;
    grant usage on schema public to anon, authenticated, service_role;

    create schema auth;
    grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users (id uuid primary key);
    insert into auth.users (id) values ('${REPORTER}');
  `);
  session.applyFile(MIGRATION_PATH);
}, 180_000);

beforeEach(() => {
  // The cascade proof deletes the account, so the reporter is re-seeded per
  // test rather than once, and a failed assertion cannot strand the next test.
  session?.sql(
    `truncate public.venue_occupancy_reports;
     insert into auth.users (id) values ('${REPORTER}') on conflict do nothing;`,
  );
});

afterAll(async () => {
  await session?.stop();
});

function requireSession(): PostgresSession {
  if (!session) throw new Error("PostgreSQL occupancy session did not start.");
  return session;
}

function insertReport(
  level: string,
  options: { source?: string; reportedAt?: string; id?: string } = {},
): string {
  const source = options.source ?? "crowd";
  const reportedAt = options.reportedAt ?? "now()";
  const id = options.id ?? "gen_random_uuid()";
  return `
    insert into public.venue_occupancy_reports
      (id, venue_id, reported_at, level, reporter_user_id, source)
    values (${id}, 'venue-16pnwmm', ${reportedAt}, '${level}', '${REPORTER}', '${source}')
  `;
}

describe.skipIf(skipReason !== null)("0107 applied to PostgreSQL", () => {
  it("takes a crowd report from the service role and reads it back", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertReport("some_seats")};`);

    expect(
      db.sql(
        "set role service_role; select level, source from public.venue_occupancy_reports",
      ),
    ).toBe("some_seats|crowd");
  });

  it("refuses a fourth word for a level, in either vocabulary", () => {
    const db = requireSession();

    // "rammed" is the Visit Report tense. The table stores the now tense only,
    // so the mapping has to happen before the insert, never in the column.
    expect(db.expectRefusal(`set role service_role; ${insertReport("rammed")};`))
      .toMatch(/venue_occupancy_reports_level_check/);
    expect(db.expectRefusal(`set role service_role; ${insertReport("packed")};`))
      .toMatch(/venue_occupancy_reports_level_check/);
    expect(
      db.expectRefusal(
        `set role service_role; ${insertReport("full", { source: "publish" })};`,
      ),
    ).toMatch(/venue_occupancy_reports_source_check/);
  });

  it("gives the browser roles neither a read nor a write", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertReport("full")};`);

    for (const role of ["anon", "authenticated"]) {
      expect(
        db.expectRefusal(
          `set role ${role}; select level from public.venue_occupancy_reports`,
        ),
      ).toMatch(/permission denied for table venue_occupancy_reports/);
      expect(db.expectRefusal(`set role ${role}; ${insertReport("empty")};`))
        .toMatch(/permission denied for table venue_occupancy_reports/);
    }

    // The row is still there: the browser was refused, not the write path.
    expect(
      db.sql("set role service_role; select count(*) from public.venue_occupancy_reports"),
    ).toBe("1");
  });

  it("leaves with the account that reported it", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertReport("empty")};`);

    db.sql(`delete from auth.users where id = '${REPORTER}'`);
    expect(
      db.sql("set role service_role; select count(*) from public.venue_occupancy_reports"),
    ).toBe("0");
  });

  it("keeps an out-of-window row for the forecast rather than deleting it", () => {
    const db = requireSession();
    db.sql(
      `set role service_role; ${insertReport("full", { reportedAt: "now() - interval '3 hours'" })};`,
    );
    db.sql(`set role service_role; ${insertReport("empty")};`);

    // The 90-minute rule is derived on READ, so the table holds both rows and
    // the now query is the thing that narrows.
    expect(
      db.sql("set role service_role; select count(*) from public.venue_occupancy_reports"),
    ).toBe("2");
    expect(
      db.sql(
        `set role service_role;
         select level from public.venue_occupancy_reports
         where reported_at >= now() - interval '90 minutes'
         order by reported_at desc limit 1`,
      ),
    ).toBe("empty");
  });

  it("rolls back to a database with no occupancy table, and re-applies", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertReport("some_seats")};`);

    db.applyFile(ROLLBACK_PATH);
    expect(db.sql("select to_regclass('public.venue_occupancy_reports') is null")).toBe(
      "t",
    );

    db.applyFile(MIGRATION_PATH);
    expect(
      db.sql("set role service_role; select count(*) from public.venue_occupancy_reports"),
    ).toBe("0");
  });
});
