import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const MIGRATION = join(process.cwd(), "supabase/migrations/20260824120000_0119_whats_on_listings.sql");
const ROLLBACK = join(process.cwd(), "supabase/migrations/rollback/20260824120000_0119_whats_on_listings_rollback.sql");

function rowJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "event-1",
    kind: "event",
    payload: { id: "event-1", kind: "event", title: "Live jazz" },
    observed_at: "2026-08-24T10:00:00.000Z",
    city: "london",
    ...overrides,
  }).replaceAll("'", "''");
}

const skipReason = postgresSkipReason();

describe.skipIf(skipReason !== null)("0119 whats_on_listings migration", () => {
  let database: PostgresSession | null = null;

  beforeAll(async () => {
    database = await startPostgres({ label: "whats-on-listings-0119" });
    database.sql("create role anon noinherit; create role authenticated noinherit; create role service_role noinherit bypassrls;");
    database.applyFile(MIGRATION);
  }, 180_000);

  afterAll(async () => database?.stop());

  it("applies schema, service-role permissions, and atomic replacement", () => {
    const db = database!;
    expect(db.sql("select to_regclass('public.whats_on_listings') is not null")).toBe("t");
    expect(db.sql("select to_regclass('public.whats_on_listing_generations') is not null")).toBe("t");
    expect(db.sql("select relrowsecurity from pg_class where oid='public.whats_on_listings'::regclass")).toBe("t");
    expect(db.sql("select relrowsecurity from pg_class where oid='public.whats_on_listing_generations'::regclass")).toBe("t");
    expect(db.sql("select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='whats_on_listings'")).toBe("id,kind,payload,observed_at,generated_at,city");
    expect(db.sql("select has_table_privilege('anon','public.whats_on_listings','select')")).toBe("f");
    expect(db.sql("select has_table_privilege('service_role','public.whats_on_listings','select')")).toBe("t");
    expect(db.sql("select has_table_privilege('anon','public.whats_on_listing_generations','select')")).toBe("f");
    expect(db.sql("select has_table_privilege('service_role','public.whats_on_listing_generations','select')")).toBe("t");
    expect(db.sql("select has_function_privilege('anon', p.oid, 'execute') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='replace_whats_on_listings'")).toBe("f");
    expect(db.sql("select has_function_privilege('service_role', p.oid, 'execute') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='replace_whats_on_listings'")).toBe("t");
    expect(db.sql("select count(*) from pg_policies where schemaname='public' and tablename='whats_on_listings'")).toBe("2");

    const good = rowJson();
    expect(db.sql(`select public.replace_whats_on_listings('event','[${good}]'::jsonb,'2026-08-24T20:00:00.000Z')`)).toBe("1");
    expect(db.sql("select to_char(generated_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') from public.whats_on_listing_generations where kind='event'")).toBe("2026-08-24 20:00:00");
    const invalid = rowJson({ observed_at: "not-a-timestamp" });
    expect(() => db.sql(`select public.replace_whats_on_listings('event','[${invalid}]'::jsonb,'2026-08-24T20:00:00.000Z')`)).toThrow();
    expect(db.sql("select count(*) from public.whats_on_listings where id='event-1'")).toBe("1");

    const stale = rowJson({ payload: { id: "event-1", kind: "event", title: "Older jazz" } });
    expect(() => db.sql(`select public.replace_whats_on_listings('event','[${stale}]'::jsonb,'2026-08-24T19:00:00.000Z')`)).toThrow();
    expect(db.sql("select payload->>'title' from public.whats_on_listings where id='event-1'")).toBe("Live jazz");

    const mismatchedKind = rowJson({
      id: "mismatched-kind",
      kind: "quiz",
      payload: { id: "mismatched-kind", kind: "quiz", title: "Still event lane" },
    });
    expect(db.sql(`select public.replace_whats_on_listings('event','[${mismatchedKind}]'::jsonb,'2026-08-24T20:00:00.000Z')`)).toBe("1");
    expect(db.sql("select kind from public.whats_on_listings where id='mismatched-kind'")).toBe("event");

    expect(db.sql("select public.replace_whats_on_listings('event','[]'::jsonb,'2026-08-24T21:00:00.000Z')")).toBe("0");
    expect(db.sql("select count(*) from public.whats_on_listings where kind='event'")).toBe("0");
    expect(db.sql("select to_char(generated_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') from public.whats_on_listing_generations where kind='event'")).toBe("2026-08-24 21:00:00");
    expect(() => db.sql(`select public.replace_whats_on_listings('event','[${good}]'::jsonb,'2026-08-24T20:00:00.000Z')`)).toThrow();
    expect(db.sql("select count(*) from public.whats_on_listings where kind='event'")).toBe("0");
  });

  it("rolls back the table and replacement function", () => {
    const db = database!;
    db.applyFile(ROLLBACK);
    expect(db.sql("select to_regclass('public.whats_on_listings') is null")).toBe("t");
    expect(db.sql("select to_regclass('public.whats_on_listing_generations') is null")).toBe("t");
    expect(db.sql("select to_regprocedure('public.replace_whats_on_listings(text,jsonb,timestamptz)') is null")).toBe("t");
  });
});
