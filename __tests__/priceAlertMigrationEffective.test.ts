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
    expect(db.sql("select to_regclass('public.price_alert_preferences') is null")).toBe("t");
    db.sql(`insert into auth.users (id) values ('${userA}'), ('${userB}')`);
    db.applyFile(forward);
    expect(db.sql("select has_table_privilege('authenticated', 'public.price_alert_preferences', 'select')")).toBe("f");
    expect(db.sql("select has_table_privilege('anon', 'public.price_alert_claims', 'select')")).toBe("f");
    expect(db.sql("select has_function_privilege('authenticated', 'public.price_alert_bind(uuid,text,integer,text)', 'execute')")).toBe("f");
    expect(db.sql("select has_function_privilege('authenticated', 'public.price_alert_claim(uuid,text,text,text,integer,timestamptz)', 'execute')")).toBe("f");
    expect(db.sql("select has_function_privilege('authenticated', 'public.price_alert_due(uuid,integer)', 'execute')")).toBe("f");
    expect(db.sql("select has_table_privilege('authenticated', 'public.price_alert_listing_seen', 'select')")).toBe("f");
    expect(db.sql("select has_function_privilege('anon', 'public.price_alert_observe_listings(text[])', 'execute')")).toBe("f");
    const fingerprint = `listed:${"a".repeat(64)}`;
    db.sql(`select public.price_alert_observe_listings(array['${fingerprint}'])`);
    db.sql(`update public.price_alert_listing_seen set first_seen = now() - interval '1 day'`);
    db.sql(`select public.price_alert_observe_listings(array['${fingerprint}'])`);
    expect(db.sql("select first_seen < now() - interval '23 hours' from public.price_alert_listing_seen")).toBe("t");
    db.sql(`select public.price_alert_bind('${userA}', 'camden', 500, 'device')`);
    expect(db.sql(`select threshold_pence from public.price_alert_preferences where user_id = '${userA}'`)).toBe("500");
    for (const threshold of [1, 400, 450, 475, 550, 600, 601, 100000]) {
      expect(db.expectRefusal(`select public.price_alert_bind('${userA}', 'camden', ${threshold}, 'device')`)).toContain("23514");
      expect(db.expectRefusal(`update public.price_alert_preferences set threshold_pence = ${threshold} where user_id = '${userA}'`)).toContain("23514");
    }
    db.sql(`select public.price_alert_bind('${userA}', 'camden', 500, 'device')`);
    db.sql(`update public.price_alert_preferences set enabled_at = now() - interval '1 hour' where user_id = '${userA}'`);
    expect(db.sql("select count(*) from public.price_alert_due(null, 500)")).toBe("1");
    expect(db.sql(`select public.price_alert_claim('${userA}', 'listed:old', 'device', 'camden', 500, now() - interval '2 hours')`)).toBe("f");
    expect(db.sql(`select public.price_alert_claim('${userA}', 'listed:new', 'device', 'camden', 400, now() - interval '30 minutes')`)).toBe("f");
    expect(db.sql(`select public.price_alert_claim('${userA}', 'listed:new', 'device', 'camden', 500, now() - interval '30 minutes')`)).toBe("t");
    expect(db.sql("select count(*) from public.price_alert_due(null, 500)")).toBe("0");
    expect(db.sql(`select public.price_alert_claim('${userA}', 'drop:new', 'device', 'camden', 500, now() - interval '30 minutes')`)).toBe("f");
    db.sql(`select public.price_alert_bind('${userB}', 'brixton', 500, 'device')`);
    expect(db.sql(`select public.price_alert_claim('${userA}', 'listed:other', 'device', 'camden', 500, now() - interval '30 minutes')`)).toBe("f");
    expect(db.sql("select user_id::text || ':' || area from public.price_alert_preferences")).toBe(`${userB}:brixton`);
    db.sql(`delete from auth.users where id = '${userB}'`);
    expect(db.sql("select count(*) from public.price_alert_preferences")).toBe("0");
    db.applyFile(rollback);
    expect(db.sql("select to_regclass('public.price_alert_preferences') is null")).toBe("t");
  });
});
