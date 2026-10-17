// Effective PostgreSQL proof for 0179.
//
// Before this migration `public.pint_drop_comments` is a member of the
// `supabase_realtime` publication (0014), although nothing subscribes to it
// and browser roles hold no privilege on it. After 0179 it is not a member,
// a second apply is a no-op, and the rollback puts it back.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20261016100000_0179_pint_drop_comments_publication.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20261016100000_0179_pint_drop_comments_publication_rollback.sql",
);
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

let database: PostgresSession | null = null;

function requireDatabase(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}

function member(table: string): string {
  return requireDatabase().sql(
    "select count(*)::int from pg_publication_tables " +
      `where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = '${table}';`,
  );
}

function anyBrowserPrivilege(role: string): string {
  return requireDatabase().sql(
    `select has_table_privilege('${role}', 'public.pint_drop_comments', 'select,insert,update,delete');`,
  );
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startPostgres({
    label: "comments-publication",
    database: "pubmax_comments_publication",
  });
  const session = requireDatabase();
  session.applyFile(SESSION_FIXTURE);
  for (const path of PREREQUISITES) session.applyFile(path);
}, 300_000);

afterAll(async () => {
  await database?.stop();
  database = null;
});

describe.skipIf(skipReason !== null)("0179 pint_drop_comments publication", () => {
  it("BEFORE: pint_drop_comments is published although no browser role can touch it", () => {
    expect(member("pint_drop_comments")).toBe("1");
    expect(member("pint_drops")).toBe("0");
    expect(anyBrowserPrivilege("anon")).toBe("f");
    expect(anyBrowserPrivilege("authenticated")).toBe("f");
  });

  it("takes the table out of the publication, and a second apply is a no-op", () => {
    const session = requireDatabase();
    session.applyFile(FORWARD);
    expect(member("pint_drop_comments")).toBe("0");

    session.applyFile(FORWARD);
    expect(member("pint_drop_comments")).toBe("0");
    expect(
      session.sql("select has_table_privilege('service_role', 'public.pint_drop_comments', 'select');"),
    ).toBe("t");
  });

  it("rolls the table back into the publication, and a second rollback is a no-op", () => {
    const session = requireDatabase();
    session.applyFile(ROLLBACK);
    expect(member("pint_drop_comments")).toBe("1");

    session.applyFile(ROLLBACK);
    expect(member("pint_drop_comments")).toBe("1");
    expect(anyBrowserPrivilege("authenticated")).toBe("f");
  });
});
