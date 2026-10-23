import { createClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/database";
import { asServiceRole, postgresSkipReason, startMigratedPostgres, type PostgresSession } from "./helpers/postgres";

const boundary = vi.hoisted(() => ({
  getClient: () => null as unknown,
  take: async () => ({ verdict: false }),
}));
vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/supabase")>(),
  getSupabaseAdmin: () => boundary.getClient(),
  isSupabaseConfigured: () => true,
  checkRateLimitDurableDetailed: () => boundary.take(),
}));
import { refundRateLimitHit } from "@/lib/rateLimitRefund.server";
import { reserveRateLimit } from "@/lib/pintDrops";

const KEY = "ors-global:fixture";
const FORWARD = "supabase/migrations/20261023170000_0196_rate_limit_refund.sql";
const ROLLBACK = "supabase/migrations/rollback/20261023170000_0196_rate_limit_refund_rollback.sql";
const skipReason = postgresSkipReason();
let database: PostgresSession;
let writes: number;
let largestUrl: number;
let largestBody: number;
let loseReply: boolean;
let missingRpc: boolean;
let beforeWrite: (() => Promise<void>) | undefined;
const count = () => Number(database.sql(`select cardinality(hits) from public.rate_limits where key = '${KEY}'`));
const refund = () => `select public.refund_rate_limit_hit('${KEY}')`;

beforeAll(async () => {
  if (skipReason) return;
  database = await startMigratedPostgres({ label: "refund-rpc" });
});
afterAll(async () => { await database?.stop(); });
afterEach(() => { vi.restoreAllMocks(); });

beforeEach(() => {
  if (skipReason) return;
  writes = 0;
  largestUrl = 0;
  largestBody = 0;
  loseReply = false;
  missingRpc = false;
  beforeWrite = undefined;
  database.sql(`delete from public.rate_limits;
    insert into public.rate_limits (key, hits, expires_at)
    values ('${KEY}', array[now(), now()], now() + interval '1 day');`);
  boundary.take = async () => ({ verdict: database.sql(asServiceRole(`select public.check_rate_limit('${KEY}', 2000, 86400000)`)) === "t" });
  boundary.getClient = () => createClient<Database>("http://fixture.invalid", "fixture-key", {
    auth: { persistSession: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      largestUrl = Math.max(largestUrl, url.href.length);
      if (url.href.length > 8_192) return Response.json({ message: "URI too long" }, { status: 414 });
      if (init?.method === "POST") {
        expect(url.pathname).toBe("/rest/v1/rpc/refund_rate_limit_hit");
        expect(url.search).toBe("");
        largestBody = Math.max(largestBody, String(init.body).length);
        writes += 1;
        const interleave = beforeWrite;
        beforeWrite = undefined;
        await interleave?.();
        if (missingRpc) return Response.json({ code: "PGRST202", message: "Missing function" }, { status: 404 });
        const args = JSON.parse(String(init.body)) as Database["public"]["Functions"]["refund_rate_limit_hit"]["Args"];
        expect(args.p_key).toBe(KEY);
        const result = await database.sqlAsync(asServiceRole(refund()));
        if (loseReply) return Response.json({ message: "Lost reply" }, { status: 500 });
        return Response.json(result === "t");
      }
      throw new Error(`Unexpected refund request: ${init?.method} ${url.pathname}`);
    } },
  });
});

describe.skipIf(skipReason !== null)("atomic rate-limit refunds", () => {
  it("refunds 2,000 timestamps with a bounded URL through the real client and PostgreSQL", async () => {
    database.sql(`update public.rate_limits set hits = array(select now() from generate_series(1, 2000)) where key = '${KEY}'`);
    expect(await refundRateLimitHit(KEY)).toBe(true);
    expect(count()).toBe(1_999);
    expect(largestUrl).toBeLessThan(200);
    expect(largestBody).toBeLessThan(100);
    expect(writes).toBe(1);
  });

  it("permits only the service role and preserves table RLS", () => {
    const statement = refund();
    for (const role of ["anon", "authenticated"]) {
      expect(database.expectRefusal(`set role ${role}; ${statement}`)).toContain("42501");
      expect(database.expectRefusal(`set role ${role}; select * from public.rate_limits`)).toContain("42501");
    }
    expect(database.sql("select relrowsecurity from pg_class where oid = 'public.rate_limits'::regclass")).toBe("t");
    expect(database.sql(asServiceRole(statement))).toBe("t");
    expect(count()).toBe(1);
  });

  it("removes one unit per successful call", () => {
    expect(database.sql(asServiceRole(refund()))).toBe("t");
    expect(count()).toBe(1);
    expect(database.sql(asServiceRole(refund()))).toBe("t");
    expect(count()).toBe(0);
  });

  it("handles empty and missing rows without creating or charging them", async () => {
    database.sql(`update public.rate_limits set hits = '{}' where key = '${KEY}'`);
    expect(database.sql(asServiceRole(refund()))).toBe("t");
    expect(await refundRateLimitHit(KEY)).toBe(true);
    database.sql(`delete from public.rate_limits where key = '${KEY}'`);
    expect(database.sql(asServiceRole(refund()))).toBe("t");
    expect(await refundRateLimitHit(KEY)).toBe(true);
    expect(writes).toBe(2);
    expect(database.sql("select count(*) from public.rate_limits")).toBe("0");
  });

  it("serializes simultaneous refunds without losing either unit", async () => {
    const statement = asServiceRole(refund());
    expect((await database.concurrentResults([statement, statement])).sort()).toEqual(["t", "t"]);
    expect(count()).toBe(0);
  });

  it("preserves a charge made just before the refund update", async () => {
    beforeWrite = async () => {
      expect(await database.sqlAsync(asServiceRole(`select public.check_rate_limit('${KEY}', 2000, 86400000)`))).toBe("f");
    };
    expect(await refundRateLimitHit(KEY)).toBe(true);
    expect(count()).toBe(2);
    expect(writes).toBe(1);
  });

  it("refunds two reservations concurrently through the real client", async () => {
    expect(await Promise.all([refundRateLimitHit(KEY), refundRateLimitHit(KEY)])).toEqual([true, true]);
    expect(count()).toBe(0);
  });

  it("returns all eleven unused cold-crawl reservations after cancellation", async () => {
    database.sql(`update public.rate_limits set hits = '{}' where key = '${KEY}'`);
    const controller = new AbortController();
    const reservations = await Promise.all(Array.from({ length: 11 }, () =>
      reserveRateLimit(KEY, 2000, 86400000, controller.signal)));
    expect(count()).toBe(11);
    controller.abort();
    expect(reservations.every((reservation) => reservation?.commit() === false)).toBe(true);
    expect(await Promise.all(reservations.map((reservation) => reservation?.release())))
      .toEqual(Array(11).fill(true));
    expect(count()).toBe(0);
  });

  it("retains all charges interleaved with eleven concurrent refunds", async () => {
    database.sql(`update public.rate_limits set hits = array(select now() from generate_series(1, 11)) where key = '${KEY}'`);
    const operations = Array.from({ length: 11 }, () => [
      refundRateLimitHit(KEY),
      database.sqlAsync(asServiceRole(`select public.check_rate_limit('${KEY}', 2000, 86400000)`)),
    ]).flat();
    expect((await Promise.all(operations)).every((result) => result === true || result === "f")).toBe(true);
    expect(count()).toBe(11);
    expect(writes).toBe(11);
  });

  it("releases a cancelled reservation once through the real refund transport", async () => {
    const controller = new AbortController();
    const reservation = await reserveRateLimit(KEY, 2000, 86400000, controller.signal);
    expect(count()).toBe(3);
    controller.abort();
    expect(reservation?.commit()).toBe(false);
    expect(await Promise.all([reservation?.release(), reservation?.release()])).toEqual([true, false]);
    expect(await reservation?.release()).toBe(false);
    expect(count()).toBe(2);
    expect(writes).toBe(1);
  });

  it("preserves other buckets and expiry metadata", async () => {
    database.sql("insert into public.rate_limits (key, hits, expires_at) values ('other', array[now()], now() + interval '1 day')");
    const metadata = database.sql(`select json_build_array(updated_at, expires_at) from public.rate_limits where key = '${KEY}'`);
    expect(await refundRateLimitHit(KEY)).toBe(true);
    expect(database.sql(`select json_build_array(updated_at, expires_at) from public.rate_limits where key = '${KEY}'`)).toBe(metadata);
    expect(database.sql("select cardinality(hits) from public.rate_limits where key = 'other'")).toBe("1");
  });

  it("never repeats an ambiguous write after a lost reply", async () => {
    loseReply = true;
    expect(await refundRateLimitHit(KEY)).toBe(false);
    expect(count()).toBe(1);
    expect(writes).toBe(1);
  });

  it("retains the unit when the refund function is missing", async () => {
    missingRpc = true;
    expect(await refundRateLimitHit(KEY)).toBe(false);
    expect(count()).toBe(2);
    expect(writes).toBe(1);
  });

  it.each(["missing", "lost reply"])("does not repeat a reservation release after %s", async (failure) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const reservation = await reserveRateLimit(KEY, 2000, 86400000);
    missingRpc = failure === "missing";
    loseReply = failure === "lost reply";
    expect(await reservation?.release()).toBe(false);
    expect(await reservation?.release()).toBe(false);
    expect(writes).toBe(1);
    expect(count()).toBe(failure === "missing" ? 3 : 2);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(errors.mock.calls[0]?.[0]))).toEqual({
      level: "error", event: "rate_limit.refund_failed", ts: expect.any(Number),
    });
  });

  it("rolls back only the function and restores it without changing limiter state", async () => {
    const before = database.sql(`select row_to_json(r) from public.rate_limits r where key = '${KEY}'`);
    database.applyFile(ROLLBACK);
    try {
      expect(await refundRateLimitHit(KEY)).toBe(false);
      expect(count()).toBe(2);
      expect(database.sql("select to_regprocedure('public.refund_rate_limit_hit(text)') is null")).toBe("t");
      expect(database.sql(`select row_to_json(r) from public.rate_limits r where key = '${KEY}'`)).toBe(before);
      expect(database.sql("select relrowsecurity from pg_class where oid = 'public.rate_limits'::regclass")).toBe("t");
      expect(database.sql(asServiceRole(`select public.check_rate_limit('${KEY}', 2000, 86400000)`))).toBe("f");
      expect(count()).toBe(3);
    } finally {
      database.applyFile(FORWARD);
    }
    expect(await refundRateLimitHit(KEY)).toBe(true);
    expect(count()).toBe(2);
  });
});
