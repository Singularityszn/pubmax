import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startPostgres, type PostgresSession } from "./helpers/postgres";
let db: PostgresSession;
const root = join(process.cwd(), "supabase/migrations");
const name = "20261124201019_0270_night_signal_delivery.sql";
beforeAll(async () => {
  db = await startPostgres({ label: "signal-delivery" });
  db.sql("create role anon; create role authenticated; create role service_role bypassrls; create table public.rate_limits (key text primary key, hits timestamptz[] not null); insert into public.rate_limits values ('night-signal-broadcast:old-version', array[now()]);");
});
afterAll(async () => { await db?.stop(); });
it("retries a rejected broadcast without allowing stale claims or browser access", async () => {
  expect(db.sql("select to_regclass('public.night_signal_broadcasts') is null")).toBe("t");
  db.applyFile(join(root, name));
  const a = "00000000-0000-4000-8000-000000000001";
  const b = "00000000-0000-4000-8000-000000000002";
  expect(db.sql(`set role service_role; select public.claim_night_signal_broadcast('old-version','${a}')`)).toBe("f");
  expect(db.sql(`set role service_role; select public.claim_night_signal_broadcast('v1','${a}')`)).toBe("t");
  expect(db.sql(`set role service_role; select public.claim_night_signal_broadcast('v1','${b}')`)).toBe("f");
  expect(db.sql(`set role service_role; select public.settle_night_signal_broadcast('v1','${a}','retryable',1,0,1)`)).toBe("t");
  expect(db.sql(`set role service_role; select public.claim_night_signal_broadcast('v1','${b}')`)).toBe("t");
  expect(db.sql(`set role service_role; select public.settle_night_signal_broadcast('v1','${a}','delivered',1,1,0)`)).toBe("f");
  expect(db.sql(`set role service_role; select public.settle_night_signal_broadcast('v1','${b}','delivered',1,1,0)`)).toBe("t");
  expect(db.sql(`set role service_role; select public.claim_night_signal_broadcast('v1','${a}')`)).toBe("f");
  expect((await db.attempt(`set role anon; select public.claim_night_signal_broadcast('v2','${a}')`)).ok).toBe(false);
  db.applyFile(join(root, "rollback", name));
  expect(db.sql("select to_regclass('public.night_signal_broadcasts') is null")).toBe("t");
});
