import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asBrowserRole, asServiceRole, postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const root = process.cwd();
let session: PostgresSession | null = null;
function db(): PostgresSession { if (!session) throw new Error("PostgreSQL is unavailable"); return session; }

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "deal-prices", database: "pubmax_deals_0254" });
  session.applyFile(join(root, "scripts/rls/session-fixture.sql"));
});
afterAll(async () => { await session?.stop(); });

describe.skipIf(skipReason !== null)("deal price migration", () => {
  it("creates protected, constrained storage and rolls back", async () => {
    expect(db().sql("select to_regclass('public.deal_prices') is null")).toBe("t");
    db().applyFile(join(root, "supabase/migrations/20261120120000_0254_deal_prices.sql"));
    db().applyFile(join(root, "supabase/migrations/20261120120000_0254_deal_prices.sql"));
    const insert = "insert into public.deal_prices (venue_id, drink_category, drink, measure, price_pennies, days, starts_at, ends_at, actor) values ('venue-1', 'beer', 'lager', 'pint', 450, array[1,2]::smallint[], '16:00', '19:00', 'opaque')";
    db().sql(asServiceRole(insert));
    expect(db().sql("select count(*) from public.deal_prices")).toBe("1");
    expect((await db().attempt(asBrowserRole("anon", null, "select * from public.deal_prices"))).ok).toBe(false);
    expect((await db().attempt(asBrowserRole("authenticated", "a0000000-0000-4000-8000-000000000001", insert))).ok).toBe(false);
    expect((await db().attempt(asServiceRole(insert.replace("array[1,2]", "array[8]")))).ok).toBe(false);
    const id = db().sql("select id from public.deal_prices limit 1");
    const report = `select public.report_deal_price('${id}', 'opaque-reader')`;
    expect(await db().concurrentResults(Array.from({ length: 4 }, () => asServiceRole(report)))).toEqual(["t", "t", "t", "t"]);
    expect(db().sql("select count(*) from public.deal_price_reports")).toBe("1");
    expect((await db().attempt(asBrowserRole("anon", null, "select * from public.list_deals_for_review()"))).ok).toBe(false);
    expect((await db().attempt(asBrowserRole("anon", null, report))).ok).toBe(false);
    const revision = db().sql(`select revision from public.deal_prices where id = '${id}'`);
    const hide = `select public.moderate_deal_price('${id}', '${revision}', true)`;
    expect((await db().attempt(asBrowserRole("authenticated", "a0000000-0000-4000-8000-000000000001", hide))).ok).toBe(false);
    expect(db().sql(asServiceRole(hide))).toBe("t");
    expect(db().sql(asServiceRole(hide))).toBe("f");
    expect(db().sql(`select hidden from public.deal_prices where id = '${id}'`)).toBe("t");
    const nextRevision = db().sql(`select revision from public.deal_prices where id = '${id}'`);
    expect(db().sql(asServiceRole(`select public.moderate_deal_price('${id}', '${nextRevision}', false)`))).toBe("t");
    expect(db().sql(asServiceRole("select count(*) from public.list_deals_for_review()"))).toBe("0");
    expect(db().sql(asServiceRole(report))).toBe("t");
    expect(db().sql(asServiceRole("select count(*) from public.list_deals_for_review()"))).toBe("1");
    for (const sibling of [
      insert.replace("array[1,2]", "array[5]"),
      insert.replace("'16:00'", "'15:00'"),
      insert.replace("'19:00'", "'20:00'"),
    ]) db().sql(asServiceRole(sibling));
    expect(db().sql("select count(*) from public.deal_prices")).toBe("4");
    const correction = insert.replace("450,", "500,") + " on conflict (venue_id, drink_category, drink, measure, measure_label, actor, days, starts_at, ends_at) do update set price_pennies = excluded.price_pennies returning id";
    expect(db().sql(asServiceRole(correction))).toBe(id);
    expect(db().sql("select count(*) from public.deal_prices")).toBe("4");
    expect(db().sql(`select price_pennies from public.deal_prices where id = '${id}'`)).toBe("500");
    for (const days of ["array[2,1]", "array[1,1]", "'[0:1]={1,2}'"]) {
      expect((await db().attempt(asServiceRole(insert.replace("array[1,2]", days)))).ok).toBe(false);
    }
    db().applyFile(join(root, "supabase/migrations/rollback/20261120120000_0254_deal_prices_rollback.sql"));
    expect(db().sql("select to_regclass('public.deal_prices') is null")).toBe("t");
  });
});
