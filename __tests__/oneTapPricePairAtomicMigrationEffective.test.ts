import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { oneTapPriceDropId } from "@/lib/oneTapPriceDropId";
import { asServiceRole, postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const migrations = join(process.cwd(), "supabase/migrations");
const forward = "20261110160000_0234_one_tap_price_pair_atomic.sql";
const signature = "public.create_one_tap_price_pair_atomic(text,text,integer,text,text,timestamptz,jsonb)";
const venue = "venue-pair-atomic";
const actor = "profile:pair-atomic";
const at = "2026-11-10T19:30:00.000Z";
const requestDrop = {
  id: "00000000-0000-4000-8000-000000000234",
  venue_id: venue,
  handle: "pair_drinker",
  drink: "Beer",
  measure: "pint",
  measure_label: null,
  price_gbp: 5,
  price_evidence: "unchecked",
  passed_down_note: "",
  era: "",
  vibe_tags: [],
  visibility: "public",
  pint_photo_key: "pair/pint.jpg",
  venue_photo_key: "pair/venue.jpg",
  receipt_photo_key: "pair/receipt.jpg",
  provenance: "contributor",
  status: "visible",
  created_at: at,
  authority_key: "a".repeat(64),
  price_day: null,
  confirmation_id: null,
  confirmed_at: null,
  confirmation_basis: null,
  confirming_drop_id: null,
  reported_at: null,
  report_reason: null,
  report_count: 0,
  moderated_at: null,
  moderator_note: null,
  leave_by_iso: null,
  last_train_decision: null,
};
let database: PostgresSession | null = null;
function db(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}
function call(submittedAt = at, pennies = 500): string {
  const drop = { ...requestDrop, price_gbp: pennies / 100, created_at: submittedAt };
  return `select public.create_one_tap_price_pair_atomic('${venue}', 'beer', ${pennies}, '${actor}',
    'pair_drinker', '${submittedAt}'::timestamptz, '${JSON.stringify(drop)}'::jsonb)`;
}
function counts(): string {
  return db().sql("select (select count(*) from public.community_prices) || '|' || (select count(*) from public.pint_drops)");
}

beforeAll(async () => {
  if (skipReason) return;
  try {
    database = await startPostgres({ label: "one-tap-0234", database: "pubmax_pair_0234" });
    database.applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const name of readdirSync(migrations).filter((name) => name.endsWith(".sql") && name < forward).sort()) {
      database.applyFile(join(migrations, name));
    }
    expect(() => database!.sql(call())).toThrow();
    database.applyFile(join(migrations, forward));
  } catch (error) {
    if (database) await database.stop();
    database = null;
    throw error;
  }
}, 600_000);
afterAll(async () => {
  if (database) await database.stop();
});
beforeEach(() => {
  if (!skipReason) db().sql("truncate public.community_prices, public.pint_drops cascade");
});

describe.skipIf(skipReason !== null)("0234 atomic one-tap pairing", () => {
  it("rolls back the price when the drop insert fails", () => {
    db().sql(`create function public.refuse_pair_drop() returns trigger language plpgsql as $$
      begin raise exception 'forced drop failure'; end $$;
      create trigger refuse_pair_drop before insert on public.pint_drops
      for each row execute function public.refuse_pair_drop();`);
    try {
      expect(db().expectRefusal(asServiceRole(call()))).toContain("forced drop failure");
      expect(counts()).toBe("0|0");
      db().sql(`insert into public.community_prices
        (venue_id, drink_category, price_pennies, actor, contributor_handle, submitted_at, hidden_at, moderator_note, report_count)
        values ('${venue}', 'beer', 420, '${actor}', 'pair_drinker', '${at}'::timestamptz - interval '1 hour', '${at}', 'Keep hidden', 2)`);
      const before = db().sql("select row_to_json(p)::text from public.community_prices p");
      expect(db().expectRefusal(asServiceRole(call()))).toContain("forced drop failure");
      expect(db().sql("select row_to_json(p)::text from public.community_prices p")).toBe(before);
      expect(counts()).toBe("1|0");
    } finally {
      db().sql("drop trigger refuse_pair_drop on public.pint_drops; drop function public.refuse_pair_drop()");
    }
  });

  it("writes both records with the request figure and complete drop payload", () => {
    const result = JSON.parse(db().sql(asServiceRole(call())));
    expect(result).toMatchObject({ status: "saved", created: true, price: { priceGbp: 5, submittedAt: Date.parse(at) } });
    expect(counts()).toBe("1|1");
    expect(db().sql("select price_pennies from public.community_prices")).toBe("500");
    const stored = JSON.parse(db().sql("select row_to_json(d) from public.pint_drops d"));
    expect(stored).toMatchObject({ ...requestDrop, id: result.drop.id, created_at: "2026-11-10T19:30:00+00:00" });
    expect(stored.id).toBe(oneTapPriceDropId(result.price.id, Date.parse(at), 5));
  });

  it.each([500, 800])("refuses an older request against a newer %i-penny observation", (pennies) => {
    db().sql(`insert into public.community_prices (venue_id, drink_category, price_pennies, actor, submitted_at)
      values ('${venue}', 'beer', ${pennies}, '${actor}', '${at}'::timestamptz + interval '1 hour')`);
    expect(JSON.parse(db().sql(asServiceRole(call())))).toEqual({ status: "superseded" });
    expect(db().sql("select price_pennies from public.community_prices")).toBe(String(pennies));
    expect(counts()).toBe("1|0");
  });

  it("serialises concurrent duplicate taps and keeps the first drop payload", async () => {
    const results = (await db().concurrentResults([asServiceRole(call()), asServiceRole(call())])).map((row) => JSON.parse(row));
    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(results[0].drop.id).toBe(results[1].drop.id);
    expect(counts()).toBe("1|1");
    const repeat = JSON.parse(db().sql(asServiceRole(call("2026-11-10T19:30:06.000Z"))));
    expect(repeat).toMatchObject({ created: false, price: { submittedAt: Date.parse(at) } });
    expect(counts()).toBe("1|1");
  });

  it.each(["anon", "authenticated"])("refuses the %s browser role", (role) => {
    expect(db().expectRefusal(`set role ${role}; ${call()}`)).toContain("permission denied");
    expect(counts()).toBe("0|0");
  });

  it("removes the function on rollback without removing stored records", () => {
    db().sql(asServiceRole(call()));
    db().applyFile(join(migrations, "rollback/20261110160000_0234_one_tap_price_pair_atomic_rollback.sql"));
    expect(db().sql(`select to_regprocedure('${signature}') is null`)).toBe("t");
    expect(() => db().sql(asServiceRole(call()))).toThrow();
    expect(counts()).toBe("1|1");
  });
});
