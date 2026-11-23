// Effective PostgreSQL proof for 0118. The Pint Drop table was named
// visit_reports before structured Visit Reports existed. 0118 renames it in
// place, so every row, key and policy keeps its identity, and leaves a
// security-invoker view behind for the previous server release. The rollback
// renames it back and loses nothing.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asServiceRole, postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const FORWARD_NAME = "20260824010000_0118_pint_drop_table_separation.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(MIGRATIONS, "rollback/20260824010000_0118_pint_drop_table_separation_rollback.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

const DROPS = ["e1180000-0000-4000-8000-000000000001", "e1180000-0000-4000-8000-000000000002"];

let database: PostgresSession | null = null;
let tableOid = "";

function db(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}

function relation(name: string): string {
  return db().sql(
    `select coalesce((select c.oid::text || ':' || c.relkind::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = '${name}'), 'absent');`,
  );
}

function policies(table: string): string {
  return db().sql(
    `select string_agg(policyname, ',' order by policyname) from pg_policies where schemaname = 'public' and tablename = '${table}';`,
  );
}

function rows(table: string): string {
  return db().sql(`select string_agg(id::text || '=' || round(price_gbp * 100)::int::text, ',' order by id) from public.${table};`);
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startPostgres({ label: "pint-0118", database: "pubmax_pint_0118" });
  db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
  for (const path of PREREQUISITES) db().applyFile(path);
  db().sql(
    DROPS.map(
      (id, index) =>
        `insert into public.visit_reports (id, venue_id, handle, price_gbp, status, visibility) values ('${id}', 'venue-0118', 'drinker_${index}', ${4.5 + index}, 'visible', 'public');`,
    ).join("\n"),
  );
  tableOid = relation("visit_reports").split(":")[0] ?? "";
}, 300_000);

afterAll(async () => {
  await database?.stop();
  database = null;
});

describe.skipIf(skipReason !== null)("0118 Pint Drop table separation", () => {
  it("BEFORE: the drops live in a table called visit_reports", () => {
    expect(relation("visit_reports")).toBe(`${tableOid}:r`);
    expect(relation("pint_drops")).toBe("absent");
    expect(rows("visit_reports")).toBe(`${DROPS[0]}=450,${DROPS[1]}=550`);
  });

  it("renames the same table, so no row is copied or lost", () => {
    db().applyFile(FORWARD);

    expect(relation("pint_drops")).toBe(`${tableOid}:r`);
    expect(rows("pint_drops")).toBe(`${DROPS[0]}=450,${DROPS[1]}=550`);
    expect(policies("pint_drops")).toContain("pint_drops_public_surface_select");
    expect(policies("pint_drops")).not.toContain("visit_reports_");
  });

  it("leaves visit_reports as a view the server can still read through", () => {
    expect(relation("visit_reports")).toMatch(/^\d+:v$/);
    expect(db().sql(asServiceRole("select count(*) from public.visit_reports;"))).toBe("2");
    expect(
      db().sql("select reloptions::text from pg_class where oid = 'public.visit_reports'::regclass;"),
    ).toContain("security_invoker=true");
  });

  it("points the report functions at the renamed table", () => {
    db().sql(`select public.report_pint_drop('${DROPS[0]}', 'wrong price', 99);`);
    expect(db().sql(`select report_count from public.pint_drops where id = '${DROPS[0]}';`)).toBe("1");
  });

  it("rolls back to the original table with every row", () => {
    db().applyFile(ROLLBACK);

    expect(relation("visit_reports")).toBe(`${tableOid}:r`);
    expect(relation("pint_drops")).toBe("absent");
    expect(rows("visit_reports")).toBe(`${DROPS[0]}=450,${DROPS[1]}=550`);
    expect(policies("visit_reports")).toContain("visit_reports_public_surface_select");
    expect(policies("visit_reports")).not.toContain("pint_drops_");
  });
});
