import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startPostgres, type PostgresSession } from "./helpers/postgres";

let db: PostgresSession;
const base = join(process.cwd(), "supabase/migrations");
const migration = join(base, "20261120001000_0251_payday_pint.sql");
const rollback = join(base, "rollback/20261120001000_0251_payday_pint_rollback.sql");
beforeAll(async () => {
  db = await startPostgres({ label: "payday-pint" });
  db.sql("create role anon; create role authenticated; create role service_role bypassrls;");
});
afterAll(async () => { await db?.stop(); });

it("requires confirmation, rejects an older confirmation after withdrawal, and rolls back", async () => {
  expect(db.sql("select to_regclass('public.payday_pint_subscribers') is null")).toBe("t");
  db.applyFile(migration);
  db.sql("insert into public.payday_pint_pending values ('first', 'person@example.test', 'Bank', 'weekly', '2026-11-01', '2026-11-03', 'token-a')");
  expect(db.sql("select count(*) from public.payday_pint_subscribers")).toBe("0");
  expect(db.sql("set role service_role; select public.confirm_payday_pint('first', '2026-11-02')")).toBe("t");
  db.sql("insert into public.payday_pint_pending values ('older', 'person@example.test', 'Bank', 'weekly', '2026-11-01 12:00', '2026-11-04', 'token-b')");
  db.sql("insert into public.payday_pint_pending values ('newer', 'person@example.test', 'Oxford Circus', 'weekly', '2026-11-02 01:00', '2026-11-04', 'token-c')");
  expect(db.sql("select public.confirm_payday_pint('newer', '2026-11-02 02:00')")).toBe("t");
  expect(db.sql("select unsubscribe_token from public.payday_pint_subscribers")).toBe("token-a");
  db.sql("update public.payday_pint_subscribers set unsubscribed_at = '2026-11-03' where unsubscribe_token = 'token-a'");
  expect(db.sql("select public.confirm_payday_pint('older', '2026-11-03')")).toBe("f");
  expect(db.sql("select count(*) from public.payday_pint_subscribers where unsubscribed_at is null")).toBe("0");
  expect((await db.attempt("set role anon; select * from public.payday_pint_pending")).ok).toBe(false);
  expect((await db.attempt("set role authenticated; select * from public.payday_pint_subscribers")).ok).toBe(false);
  db.applyFile(rollback);
  expect(db.sql("select to_regclass('public.payday_pint_subscribers') is null")).toBe("t");
});
