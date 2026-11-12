import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const migrations = join(process.cwd(), "supabase/migrations");
const name = "20261112150941_0238_pint_drop_rating.sql";
const forward = join(migrations, name);
const rollback = join(migrations, "rollback/20261112150941_0238_pint_drop_rating_rollback.sql");
let database: PostgresSession | null = null;

function db(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}

function columnCount(): string {
  return db().sql("select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'pint_drops' and column_name = 'rating'");
}

beforeAll(async () => {
  if (skipReason) return;
  try {
    database = await startPostgres({ label: "pint-rating", database: "pubmax_pint_rating_0238" });
    database.applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const prerequisite of readdirSync(migrations).filter((file) => file.endsWith(".sql") && file < name).sort()) {
      database.applyFile(join(migrations, prerequisite));
    }
  } catch (error) {
    if (database) await database.stop();
    database = null;
    throw error;
  }
}, 600_000);

afterAll(async () => {
  if (database) await database.stop();
  database = null;
});

describe.skipIf(skipReason !== null)("0238 per-drop whole stars on PostgreSQL", () => {
  it("adds nullable stars, enforces 1 through 5, rolls back and re-applies", async () => {
    expect(columnCount()).toBe("0");
    db().sql(`insert into public.pint_drops
      (id, venue_id, handle, drink, price_gbp, passed_down_note, era, provenance, status, created_at)
      values ('00000000-0000-4000-8000-000000002380', 'venue-1vle947', 'ale', 'Guinness', 4.20, '', '', 'contributor', 'visible', '2026-11-12T19:30:00Z')`);
    db().applyFile(forward);
    db().applyFile(forward);
    expect(columnCount()).toBe("1");
    expect(db().sql("select data_type || ':' || is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'pint_drops' and column_name = 'rating'")).toBe("smallint:YES");
    expect(db().sql("select count(*) from public.pint_drops where id = '00000000-0000-4000-8000-000000002380' and rating is not null")).toBe("0");
    for (const rating of [1, 2, 3, 4, 5]) {
      db().sql(`update public.pint_drops set rating = ${rating} where id = '00000000-0000-4000-8000-000000002380'`);
      expect(db().sql("select rating from public.pint_drops where id = '00000000-0000-4000-8000-000000002380'")).toBe(String(rating));
    }
    for (const rating of [0, 6]) {
      const result = await db().attempt(`update public.pint_drops set rating = ${rating} where id = '00000000-0000-4000-8000-000000002380'`);
      expect(result.ok).toBe(false);
      expect(result.said).toContain("pint_drops_rating_range");
    }
    db().sql("update public.pint_drops set rating = null where id = '00000000-0000-4000-8000-000000002380'");
    expect(db().sql("select count(*) from public.pint_drops where id = '00000000-0000-4000-8000-000000002380' and rating is null")).toBe("1");
    db().sql("update public.pint_drops set rating = 4 where id = '00000000-0000-4000-8000-000000002380'");
    db().applyFile(rollback);
    expect(columnCount()).toBe("0");
    expect(db().sql("select count(*) from pg_constraint where conrelid = 'public.pint_drops'::regclass and conname = 'pint_drops_rating_range'")).toBe("0");
    expect(db().sql("select price_gbp from public.pint_drops where id = '00000000-0000-4000-8000-000000002380'")).toBe("4.20");
    db().applyFile(forward);
    expect(columnCount()).toBe("1");
    expect(db().sql("select count(*) from public.pint_drops where id = '00000000-0000-4000-8000-000000002380' and rating is null")).toBe("1");
  });
});
