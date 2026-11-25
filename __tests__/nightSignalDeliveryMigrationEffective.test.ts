import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startPostgres, type PostgresSession } from "./helpers/postgres";
let db: PostgresSession;
const root = join(process.cwd(), "supabase/migrations");
const name = "20261124201019_0270_night_signal_delivery.sql";
beforeAll(async () => {
  db = await startPostgres({ label: "signal-delivery" });
  db.sql("create role anon; create role authenticated; create role service_role bypassrls;");
  db.applyFile(join(root, "20260705214454_0003_rate_limits.sql"));
  db.applyFile(join(root, "20260806145644_0070_rate_limit_expiry.sql"));
  db.applyFile(join(root, "20261017090000_0181_rate_limit_refusals_uncharged.sql"));
  db.sql("insert into public.rate_limits (key, hits, expires_at) values ('night-signal-broadcast:old-version', array[now()], now() + interval '7 days');");
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
  for (const state of ["sending", "unknown", "retryable"]) {
    expect(db.sql(`set role service_role; select public.claim_night_signal_broadcast('${state}','${a}')`)).toBe("t");
    if (state !== "sending") expect(db.sql(`set role service_role; select public.settle_night_signal_broadcast('${state}','${a}','${state}',1,0,1)`)).toBe("t");
  }
  db.sql("insert into public.rate_limits (key, hits, expires_at) values ('night-signal-broadcast:unknown', array[now() - interval '8 days'], now() - interval '1 day');");
  db.applyFile(join(root, "rollback", name));
  expect(db.sql("select to_regclass('public.night_signal_broadcasts') is null")).toBe("t");
  for (const version of ["old-version", "v1", "sending", "unknown"]) {
    expect(db.sql(`select public.check_rate_limit('night-signal-broadcast:${version}',1,604800000)`)).toBe("t");
  }
  expect(db.sql("select public.check_rate_limit('night-signal-broadcast:retryable',1,604800000)")).toBe("f");
  expect(db.sql("select public.check_rate_limit('night-signal-broadcast:new-version',1,604800000)")).toBe("f");
});
