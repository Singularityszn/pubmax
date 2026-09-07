// Effective PostgreSQL proof for 0139 (#1292).
//
// The defect is not asserted here, it is REPRODUCED. On a real server holding
// migrations up to 0132, a stored 8 pound Community Price observed later than a
// 5 pound request makes public.create_one_tap_price_pair mint a Pint Drop
// reporting 8 pounds, while the 5 pound observation the drinker typed is never
// stored. 0139 then withdraws the function, and its rollback restores 0132's
// body faithfully, defect and all, which is what a rollback of a withdrawal has
// to mean.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20260903160000_0139_one_tap_price_pair_removal.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20260903160000_0139_one_tap_price_pair_removal_rollback.sql",
);
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

const SIGNATURE =
  "public.create_one_tap_price_pair(text,text,integer,text,text,timestamptz,uuid,text,text,text,text,text)";

const VENUE = "venue-one-tap-1292";
const ACTOR = "profile:00000000-0000-4000-8000-0000000000f1";
const HANDLE = "karan";
const EARLIER = "2026-09-03 18:00:00+00";
const LATER = "2026-09-03 20:00:00+00";
const STORED_PENNIES = 800;
const SUBMITTED_PENNIES = 500;

let database: PostgresSession | null = null;

function requireDatabase(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}

// One drinker's own stored observation, made LATER than the request that
// follows it. This is the ordinary correction case the newer-wins upsert exists
// for, which is exactly why the pair function cannot tell it apart from a write.
function seedStoredNewerPrice(db: PostgresSession): void {
  db.sql(`
    truncate table public.pint_drops cascade;
    truncate table public.community_prices cascade;
    insert into public.community_prices
      (venue_id, drink_category, price_pennies, actor, contributor_handle, submitted_at)
    values
      ('${VENUE}', 'beer', ${STORED_PENNIES}, '${ACTOR}', '${HANDLE}', '${LATER}'::timestamptz);
  `);
}

// price_gbp is an unconstrained numeric, so read it at a fixed scale rather
// than comparing against whatever trailing zeros the server prints.
function dropPounds(db: PostgresSession, dropId: string): string {
  return db.sql(
    `select price_gbp::numeric(10,2)::text from public.pint_drops where id = '${dropId}'::uuid`,
  );
}

function callPair(db: PostgresSession, dropId: string): string {
  return db.sql(`select price_pennies from public.create_one_tap_price_pair(
    '${VENUE}',
    'beer',
    ${SUBMITTED_PENNIES},
    '${ACTOR}',
    '${HANDLE}',
    '${EARLIER}'::timestamptz,
    '${dropId}'::uuid,
    '${HANDLE}',
    'Pint',
    null,
    null,
    'authority-1292'
  )`);
}

beforeAll(async () => {
  if (skipReason) return;
  try {
    database = await startPostgres({ label: "one-tap-0139", database: "pubmax_one_tap_0139" });
    database.applyFile(SESSION_FIXTURE);
    for (const path of PREREQUISITES) database.applyFile(path);
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

describe.skipIf(skipReason !== null)("0139 on PostgreSQL", () => {
  it("reproduces the #1292 drop at a price nobody submitted, then withdraws it", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();
    seedStoredNewerPrice(db);

    const dropId = "00000000-0000-4000-8000-0000000000e1";
    // The function answers with the KEPT row's pennies, not the request's.
    expect(callPair(db, dropId)).toBe(String(STORED_PENNIES));
    // The drinker's 5 pound observation reached no table.
    expect(
      db.sql(
        `select count(*)::text from public.community_prices where venue_id = '${VENUE}' and price_pennies = ${SUBMITTED_PENNIES}`,
      ),
    ).toBe("0");
    // And the Pint Drop reports 8 pounds, which nobody submitted, rather than
    // the 5 pounds that was sent. That is the defect, on a real server, before
    // anything of ours runs.
    expect(dropPounds(db, dropId)).toBe("8.00");
    expect(dropPounds(db, dropId)).not.toBe("5.00");

    db.applyFile(FORWARD);

    expect(db.sql(`select coalesce(to_regprocedure('${SIGNATURE}')::text, 'gone')`)).toBe(
      "gone",
    );
    expect(() => callPair(db, "00000000-0000-4000-8000-0000000000e2")).toThrow();
    // The withdrawal takes the function and nothing else: the drop already
    // written stays, because no column tells a pair-written row from a
    // two-phase one and removing a drinker's Pint Drop on a guess is worse.
    expect(db.sql(`select count(*)::text from public.pint_drops where venue_id = '${VENUE}'`)).toBe(
      "1",
    );
    expect(
      db.sql(
        `select price_pennies::text from public.community_prices where venue_id = '${VENUE}'`,
      ),
    ).toBe(String(STORED_PENNIES));
  }, 300_000);

  it("restores 0132's function, grants and defect on rollback", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();

    db.applyFile(ROLLBACK);

    expect(db.sql(`select coalesce(to_regprocedure('${SIGNATURE}')::text, 'gone')`)).not.toBe(
      "gone",
    );
    expect(
      db.sql(
        `select has_function_privilege('anon', '${SIGNATURE}', 'execute')::text || '|' || has_function_privilege('authenticated', '${SIGNATURE}', 'execute')::text || '|' || has_function_privilege('service_role', '${SIGNATURE}', 'execute')::text`,
      ),
    ).toBe("false|false|true");

    // Faithful means the old behaviour comes back with the old body. A rollback
    // that quietly shipped a repaired function would be a second live change
    // wearing a rollback's name.
    seedStoredNewerPrice(db);
    const dropId = "00000000-0000-4000-8000-0000000000e3";
    expect(callPair(db, dropId)).toBe(String(STORED_PENNIES));
    expect(dropPounds(db, dropId)).toBe("8.00");
  }, 300_000);
});

const RECEIPT_FORWARD_NAME = "20260907230000_0156_community_price_receipt.sql";
const RECEIPT_FORWARD = join(MIGRATIONS, RECEIPT_FORWARD_NAME);
const RECEIPT_ROLLBACK = join(MIGRATIONS, "rollback/20260907230000_0156_community_price_receipt_rollback.sql");
const OLD_PRICE_SIGNATURE = "public.upsert_attributed_community_price_if_newer(text,text,integer,text,text,timestamptz,uuid,integer)";
const RECEIPT_SIGNATURE = "public.upsert_attributed_community_price_if_newer(text,text,integer,text,text,timestamptz,uuid,integer,text)";

function receiptCall(pennies: number, minute: number, key?: string, venue = "receipt-pub"): string {
  const receipt = key === undefined ? "" : `, '${key}'`;
  return `select row_to_json(w)::text from public.upsert_attributed_community_price_if_newer(
    '${venue}', 'coffee', ${pennies}, '${ACTOR}', '${HANDLE}',
    '2026-09-07 18:${String(minute).padStart(2, "0")}:00+00'::timestamptz, null, null${receipt}
  ) w`;
}

describe.skipIf(skipReason !== null)("0156 receipt ownership on PostgreSQL", () => {
  beforeAll(() => {
    const db = requireDatabase();
    // Continue the same disposable cluster through the current schema.
    for (const name of readdirSync(MIGRATIONS).filter(
      (name) => name.endsWith(".sql") && name >= FORWARD_NAME && name < RECEIPT_FORWARD_NAME,
    ).sort()) db.applyFile(join(MIGRATIONS, name));
  });

  it("reproduces the missing attachment contract, then installs one unambiguous RPC", () => {
    const db = requireDatabase();
    expect(db.sql(`select count(*) from information_schema.columns
      where table_schema='public' and table_name='community_prices' and column_name='receipt_photo_key'`)).toBe("0");
    const before = JSON.parse(db.sql(receiptCall(300, 1)));
    expect(before).not.toHaveProperty("receipt_photo_key");
    db.applyFile(RECEIPT_FORWARD);
    db.applyFile(RECEIPT_FORWARD);
    expect(db.sql(`select to_regprocedure('${OLD_PRICE_SIGNATURE}') is null`)).toBe("t");
    expect(db.sql(`select count(*) from pg_proc where pronamespace='public'::regnamespace
      and proname='upsert_attributed_community_price_if_newer'`)).toBe("1");
    expect(db.sql(`select has_function_privilege('anon','${RECEIPT_SIGNATURE}','execute')::text || '|' ||
      has_function_privilege('authenticated','${RECEIPT_SIGNATURE}','execute')::text || '|' ||
      has_function_privilege('service_role','${RECEIPT_SIGNATURE}','execute')::text`)).toBe("false|false|true");
    expect(JSON.parse(db.sql(receiptCall(300, 2)))).toMatchObject({ write_applied: true, receipt_photo_key: null });
  });

  it("stores a coffee price and receipt together without creating a Pint Drop", () => {
    const db = requireDatabase();
    const saved = JSON.parse(db.sql(receiptCall(350, 3, "receipt-pub/first/receipt.jpg")));
    expect(saved).toMatchObject({ price_pennies: 350, write_applied: true,
      receipt_photo_key: "receipt-pub/first/receipt.jpg", replaced_receipt_photo_key: null });
    expect(db.sql(`select price_pennies::text || '|' || receipt_photo_key from public.community_prices
      where venue_id='receipt-pub'`)).toBe("350|receipt-pub/first/receipt.jpg");
    expect(db.sql(`select count(*) from public.pint_drops where venue_id='receipt-pub'`)).toBe("0");
  });

  it("keeps moderation while replacing both price and receipt, then refuses a stale bill", () => {
    const db = requireDatabase();
    db.sql(`update public.community_prices set hidden_at=now(), report_count=2 where venue_id='receipt-pub'`);
    const saved = JSON.parse(db.sql(receiptCall(400, 5, "receipt-pub/second/receipt.jpg")));
    expect(saved).toMatchObject({ price_pennies: 400, write_applied: true,
      receipt_photo_key: "receipt-pub/second/receipt.jpg", replaced_receipt_photo_key: "receipt-pub/first/receipt.jpg" });
    const stale = JSON.parse(db.sql(receiptCall(300, 4, "receipt-pub/stale/receipt.jpg")));
    expect(stale).toMatchObject({ price_pennies: 400, write_applied: false,
      receipt_photo_key: "receipt-pub/second/receipt.jpg", replaced_receipt_photo_key: null });
    expect(db.sql(`select (hidden_at is not null)::text || '|' || report_count::text
      from public.community_prices where venue_id='receipt-pub'`)).toBe("true|2");
  });

  it("rolls back the receipt with an invalid price", () => {
    const db = requireDatabase();
    expect(() => db.sql(receiptCall(0, 6, "receipt-pub/invalid/receipt.jpg"))).toThrow();
    expect(db.sql(`select price_pennies::text || '|' || receipt_photo_key from public.community_prices
      where venue_id='receipt-pub'`)).toBe("400|receipt-pub/second/receipt.jpg");
  });

  it.each([false, true])("keeps the newest price and its own bill under concurrent writes, equal price=%s", async (equalPrice) => {
    const db = requireDatabase();
    const venue = equalPrice ? "receipt-equal" : "receipt-race";
    await db.concurrent([
      receiptCall(equalPrice ? 450 : 300, 10, `${venue}/old/receipt.jpg`, venue),
      receiptCall(450, 11, `${venue}/new/receipt.jpg`, venue),
    ]);
    expect(db.sql(`select price_pennies::text || '|' || receipt_photo_key from public.community_prices
      where venue_id='${venue}'`)).toBe(`450|${venue}/new/receipt.jpg`);
    expect(db.sql(`select count(*) from public.community_prices where venue_id='${venue}'`)).toBe("1");
  });

  it("clears an old bill when an eight-argument caller corrects the price", () => {
    const result = JSON.parse(requireDatabase().sql(receiptCall(500, 7)));
    expect(result).toMatchObject({ write_applied: true, receipt_photo_key: null,
      replaced_receipt_photo_key: "receipt-pub/second/receipt.jpg" });
  });

  it("restores the old signature on rollback while retaining price and moderation", () => {
    const db = requireDatabase();
    db.applyFile(RECEIPT_ROLLBACK);
    expect(db.sql(`select to_regprocedure('${RECEIPT_SIGNATURE}') is null`)).toBe("t");
    expect(db.sql(`select to_regprocedure('${OLD_PRICE_SIGNATURE}') is not null`)).toBe("t");
    expect(JSON.parse(db.sql(receiptCall(600, 8))).price_pennies).toBe(600);
    expect(db.sql(`select (hidden_at is not null)::text || '|' || report_count::text
      from public.community_prices where venue_id='receipt-pub'`)).toBe("true|2");
    db.applyFile(RECEIPT_FORWARD);
  });
});
