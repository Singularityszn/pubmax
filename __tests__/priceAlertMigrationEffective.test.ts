import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const root = process.cwd();
const forward = join(root, "supabase/migrations/20261120000000_0251_price_alerts.sql");
const rollback = join(root, "supabase/migrations/rollback/20261120000000_0251_price_alerts_rollback.sql");
let database: PostgresSession | null = null;

beforeAll(async () => {
  if (skipReason) return;
  database = await startPostgres({ label: "price-alert", database: "pubmax_price_alert_0251" });
  database.applyFile(join(root, "scripts/rls/session-fixture.sql"));
  database.sql("create table public.pint_drops (id uuid primary key)");
});

afterAll(async () => { if (database) await database.stop(); });

describe.skipIf(skipReason !== null)("price alert database", () => {
  it("binds one account per device, denies browser access and rolls back", () => {
    if (!database) throw new Error("PostgreSQL session unavailable");
    const db = database;
    const userA = "a0000000-0000-4000-8000-000000000001";
    const userB = "b0000000-0000-4000-8000-000000000002";
    const dropId = "d0000000-0000-4000-8000-000000000003";
    expect(db.sql("select to_regclass('public.price_alert_preferences') is null")).toBe("t");
    db.sql(`insert into auth.users (id) values ('${userA}'), ('${userB}')`);
    db.applyFile(forward);
    expect(db.sql("select has_table_privilege('authenticated', 'public.price_alert_preferences', 'select')")).toBe("f");
    expect(db.sql("select has_table_privilege('anon', 'public.price_alert_claims', 'select')")).toBe("f");
    expect(db.sql("select has_function_privilege('authenticated', 'public.price_alert_bind(uuid,text,integer,text)', 'execute')")).toBe("f");
    expect(db.sql("select has_function_privilege('authenticated', 'public.price_alert_claim(uuid,uuid,text,text,integer)', 'execute')")).toBe("f");
    db.sql(`insert into public.pint_drops (id) values ('${dropId}')`);
    db.sql(`select public.price_alert_bind('${userA}', 'camden', 500, 'device')`);
    expect(db.sql(`select public.price_alert_claim('${userA}', '${dropId}', 'device', 'camden', 400)`)).toBe("f");
    expect(db.sql(`select public.price_alert_claim('${userA}', '${dropId}', 'device', 'camden', 500)`)).toBe("t");
    expect(db.sql(`select public.price_alert_claim('${userA}', '${dropId}', 'device', 'camden', 500)`)).toBe("f");
    db.sql(`select public.price_alert_bind('${userB}', 'brixton', 600, 'device')`);
    expect(db.sql(`select public.price_alert_claim('${userA}', '${dropId}', 'device', 'camden', 500)`)).toBe("f");
    expect(db.sql("select user_id::text || ':' || area from public.price_alert_preferences")).toBe(`${userB}:brixton`);
    db.sql(`delete from auth.users where id = '${userB}'`);
    expect(db.sql("select count(*) from public.price_alert_preferences")).toBe("0");
    db.applyFile(rollback);
    expect(db.sql("select to_regclass('public.price_alert_preferences') is null")).toBe("t");
  });
});
