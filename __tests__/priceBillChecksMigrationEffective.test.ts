// Effective PostgreSQL proof for 0220, the bill check (captain 5 Nov 2026).
//
// The claim under test is not "the SQL parses". It is that a real server
// holding every migration before this one has NOWHERE to say whether a bill
// showed its price, that 0220 applies over rows already on file and touches
// none of them, that the verdict's shape (the closed set, the lines it may
// keep, one check per price, a review that is a stamp) is the TABLE's and not
// only the app's, that no browser role reads or writes a row, and that the
// rollback gives the table back without touching a drinker's price.
//
// Every timestamp is a literal, for the reason 0141's proof gives.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BILL_CHECK_MAX_LINES, BILL_CHECK_RESULTS } from "@/lib/billCheck";
import { BILL_CHECK_REVIEW_DECISIONS } from "@/lib/billCheckStore";

import {
  asBrowserRole,
  asServiceRole,
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20261105120000_0220_price_bill_checks.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(MIGRATIONS, "rollback/20261105120000_0220_price_bill_checks_rollback.sql");
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

const VENUE = "venue-1vle947";
const AT = "2026-11-05 19:30:00+00";
const STRANGER = "c1111111-1111-4111-8111-111111111111";

const DROP_MATCH = "00000000-0000-4000-8000-000000000001";
const DROP_MISMATCH = "00000000-0000-4000-8000-000000000002";
const DROP_UNREADABLE = "00000000-0000-4000-8000-000000000003";
const DROP_LATER = "00000000-0000-4000-8000-000000000004";
const PRICE_PAIRED = "10000000-0000-4000-8000-000000000001";

let database: PostgresSession | null = null;

function db(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}

function insertDrop(id: string, price: string): string {
  return `insert into public.pint_drops
    (id, venue_id, handle, drink, price_gbp, price_evidence, passed_down_note, era, provenance, status, authority_key, created_at)
    values ('${id}'::uuid, '${VENUE}', 'drinker_${id.slice(-1)}', 'Guinness', ${price}, 'unchecked', '', '',
      'contributor', 'visible', 'pubmax:blackfriar:${id.slice(-1)}', timestamptz '${AT}');`;
}

function lines(count: number): string {
  return `'${JSON.stringify(Array.from({ length: count }, (_, i) => ({ name: `Item ${i}`, price_gbp: 4.5 })))}'::jsonb`;
}

function insertCheck(fields: {
  drop?: string | null;
  price?: string | null;
  result?: string;
  lineCount?: number;
  pennies?: number;
  linesSql?: string;
}): string {
  const drop = fields.drop === undefined ? DROP_LATER : fields.drop;
  const price = fields.price ?? null;
  return asServiceRole(`insert into public.price_bill_checks
    (pint_drop_id, community_price_id, venue_id, price_pennies, result, lines)
    values (${drop ? `'${drop}'::uuid` : "null"}, ${price ? `'${price}'::uuid` : "null"}, '${VENUE}',
      ${fields.pennies ?? 450}, '${fields.result ?? "mismatch"}', ${fields.linesSql ?? lines(fields.lineCount ?? 1)});`);
}

const tableExists = () => db().sql("select to_regclass('public.price_bill_checks') is not null");

beforeAll(async () => {
  if (skipReason) return;
  try {
    database = await startPostgres({ label: "bill-checks", database: "pubmax_bill_checks_0220" });
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

describe.skipIf(skipReason !== null)("0220 on PostgreSQL", () => {
  it("has nowhere to say whether a bill showed its price before the migration", () => {
    expect(tableExists()).toBe("f");
    // Prices already on file, each sent with a bill. Nothing on the server can
    // say which of those bills was read, or what it showed.
    db().sql(insertDrop(DROP_MATCH, "6.20"));
    db().sql(insertDrop(DROP_MISMATCH, "4.50"));
    db().sql(insertDrop(DROP_UNREADABLE, "5.00"));
    db().sql(`insert into public.community_prices (id, venue_id, drink_category, price_pennies, actor, submitted_at)
      values ('${PRICE_PAIRED}'::uuid, '${VENUE}', 'beer', 450, 'actor-paired', timestamptz '${AT}');`);
    expect(db().sql(`select count(*) from public.pint_drops where venue_id = '${VENUE}'`)).toBe("3");
  });

  it("applies over those rows and touches none of them", () => {
    const before = db().sql(
      `select string_agg(id || ':' || price_gbp || ':' || price_evidence, ',' order by id) from public.pint_drops where venue_id = '${VENUE}'`,
    );
    db().applyFile(FORWARD);
    expect(tableExists()).toBe("t");
    expect(db().sql("select count(*) from public.price_bill_checks")).toBe("0");
    expect(
      db().sql(
        `select string_agg(id || ':' || price_gbp || ':' || price_evidence, ',' order by id) from public.pint_drops where venue_id = '${VENUE}'`,
      ),
    ).toBe(before);
  });

  it("records each of the three verdicts the app owns, with only the lines each needs", async () => {
    expect([...BILL_CHECK_RESULTS]).toEqual(["match", "mismatch", "unreadable"]);
    for (const insert of [
      insertCheck({ drop: DROP_MATCH, result: "match", lineCount: 1, pennies: 620 }),
      insertCheck({ drop: DROP_MISMATCH, price: PRICE_PAIRED, result: "mismatch", lineCount: 3 }),
      insertCheck({ drop: DROP_UNREADABLE, result: "unreadable", linesSql: "'[]'::jsonb", pennies: 500 }),
    ]) {
      const answer = await db().attempt(insert);
      expect(answer.ok, answer.said).toBe(true);
    }
    expect(db().sql("select string_agg(result, ',' order by result) from public.price_bill_checks")).toBe(
      "match,mismatch,unreadable",
    );
  });

  it("refuses a word outside the closed set, a row that names no price, and a price of nothing", async () => {
    db().sql(insertDrop(DROP_LATER, "4.80"));
    const word = await db().attempt(insertCheck({ result: "checked" }));
    expect(word.ok).toBe(false);
    expect(word.said).toContain("price_bill_checks_result_check");

    const orphan = await db().attempt(insertCheck({ drop: null, price: null }));
    expect(orphan.ok).toBe(false);
    expect(orphan.said).toContain("price_bill_checks_subject_check");

    const free = await db().attempt(insertCheck({ pennies: 0 }));
    expect(free.ok).toBe(false);
    expect(free.said).toContain("price_bill_checks_price_check");
  });

  it("keeps the lines to what the verdict needs, and to the app's own ceiling", async () => {
    expect(BILL_CHECK_MAX_LINES).toBe(20);
    const long = await db().attempt(insertCheck({ lineCount: 21 }));
    expect(long.ok).toBe(false);
    expect(long.said).toContain("price_bill_checks_lines_shape_check");

    const notAList = await db().attempt(insertCheck({ linesSql: `'{"name":"Guinness"}'::jsonb` }));
    expect(notAList.ok).toBe(false);
    expect(notAList.said).toContain("price_bill_checks_lines_shape_check");

    const unreadableWithLines = await db().attempt(insertCheck({ result: "unreadable", lineCount: 1 }));
    expect(unreadableWithLines.ok).toBe(false);
    expect(unreadableWithLines.said).toContain("price_bill_checks_lines_verdict_check");

    const matchWithNoLine = await db().attempt(insertCheck({ result: "match", linesSql: "'[]'::jsonb" }));
    expect(matchWithNoLine.ok).toBe(false);
    expect(matchWithNoLine.said).toContain("price_bill_checks_lines_verdict_check");
  });

  it("reads a bill once: a second check of one price is refused", async () => {
    const again = await db().attempt(insertCheck({ drop: DROP_MATCH, result: "match", pennies: 620 }));
    expect(again.ok).toBe(false);
    expect(again.said).toContain("price_bill_checks_pint_drop_idx");

    const pricedAgain = await db().attempt(insertCheck({ drop: null, price: PRICE_PAIRED }));
    expect(pricedAgain.ok).toBe(false);
    expect(pricedAgain.said).toContain("price_bill_checks_community_price_idx");
  });

  it("refuses every browser read and write", async () => {
    for (const [role, sub] of [["anon", null], ["authenticated", STRANGER]] as const) {
      const read = await db().attempt(asBrowserRole(role, sub, "select lines from public.price_bill_checks"));
      expect(read.ok, `${role} read`).toBe(false);
      expect(read.said).toMatch(/42501|permission denied/);
      const write = await db().attempt(
        asBrowserRole(
          role,
          sub,
          `insert into public.price_bill_checks (pint_drop_id, venue_id, price_pennies, result, lines)
           values ('${DROP_LATER}'::uuid, '${VENUE}', 450, 'match', '[{"name":"x","price_gbp":4.5}]'::jsonb)`,
        ),
      );
      expect(write.ok, `${role} insert`).toBe(false);
      const review = await db().attempt(
        asBrowserRole(role, sub, "update public.price_bill_checks set reviewed_at = now(), review_decision = 'kept'"),
      );
      expect(review.ok, `${role} update`).toBe(false);
      const remove = await db().attempt(asBrowserRole(role, sub, "delete from public.price_bill_checks"));
      expect(remove.ok, `${role} delete`).toBe(false);
    }
    expect(db().sql("select count(*) from public.price_bill_checks where reviewed_at is not null")).toBe("0");
    expect(db().sql("select count(*) from public.price_bill_checks")).toBe("3");
  });

  it("reviews a mismatch by stamp alone, only a mismatch, and keeps the row", async () => {
    expect([...BILL_CHECK_REVIEW_DECISIONS]).toEqual(["kept", "hidden"]);
    const half = await db().attempt(
      asServiceRole(`update public.price_bill_checks set reviewed_at = timestamptz '${AT}' where pint_drop_id = '${DROP_MISMATCH}'::uuid`),
    );
    expect(half.ok).toBe(false);
    expect(half.said).toContain("price_bill_checks_review_stamp_check");

    const unknown = await db().attempt(
      asServiceRole(
        `update public.price_bill_checks set reviewed_at = timestamptz '${AT}', review_decision = 'deleted' where pint_drop_id = '${DROP_MISMATCH}'::uuid`,
      ),
    );
    expect(unknown.ok).toBe(false);
    expect(unknown.said).toContain("price_bill_checks_review_decision_check");

    const onAMatch = await db().attempt(
      asServiceRole(
        `update public.price_bill_checks set reviewed_at = timestamptz '${AT}', review_decision = 'kept' where pint_drop_id = '${DROP_MATCH}'::uuid`,
      ),
    );
    expect(onAMatch.ok).toBe(false);
    expect(onAMatch.said).toContain("price_bill_checks_review_mismatch_check");

    const reviewed = await db().attempt(
      asServiceRole(
        `update public.price_bill_checks set reviewed_at = timestamptz '${AT}', review_decision = 'hidden' where pint_drop_id = '${DROP_MISMATCH}'::uuid`,
      ),
    );
    expect(reviewed.ok, reviewed.said).toBe(true);
    expect(
      db().sql(
        `select result || ':' || review_decision from public.price_bill_checks where pint_drop_id = '${DROP_MISMATCH}'::uuid`,
      ),
    ).toBe("mismatch:hidden");
    // The queue's own index answers the queue read.
    expect(
      db().sql(
        "select count(*) from pg_indexes where schemaname = 'public' and indexname = 'price_bill_checks_queue_idx'",
      ),
    ).toBe("1");
  });

  it("gives the table back on rollback, keeps every drinker's price, and re-applies", () => {
    const prices = () =>
      db().sql(
        `select count(*) || ':' || sum(price_gbp) || ':' || string_agg(price_evidence, ',' order by id) from public.pint_drops where venue_id = '${VENUE}'`,
      );
    const before = prices();
    const communityBefore = db().sql(`select count(*) from public.community_prices where venue_id = '${VENUE}'`);

    db().applyFile(ROLLBACK);

    expect(tableExists()).toBe("f");
    expect(prices()).toBe(before);
    expect(db().sql(`select count(*) from public.community_prices where venue_id = '${VENUE}'`)).toBe(communityBefore);

    db().applyFile(ROLLBACK);
    db().applyFile(FORWARD);
    expect(tableExists()).toBe("t");
    expect(db().sql("select count(*) from public.price_bill_checks")).toBe("0");
    db().applyFile(FORWARD);
  });
});
