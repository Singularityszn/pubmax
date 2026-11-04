// Effective PostgreSQL proof for 0218 (captain decision 9, 1 Nov 2026).
//
// The claim under test is not "the SQL parses". It is that a real server
// holding every migration before this one CANNOT tell a typed price from a
// billed one, that 0218 applies cleanly over rows already on file and
// re-judges none of them, that the closed set and the "evidence needs a
// price" rule are the TABLE's and not only the app's, and that the rollback
// gives the column back without touching a drinker's price.
//
// Every timestamp is a literal, for the reason 0141's proof gives: a test that
// leaned on the wall clock would be a different test at 00:30 than at noon.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PRICE_EVIDENCE } from "@/lib/pintDropReceipt";

import {
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20261101120000_0218_pint_drop_price_evidence.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20261101120000_0218_pint_drop_price_evidence_rollback.sql",
);
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

let database: PostgresSession | null = null;

function requireDatabase(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}

const VENUE = "venue-1vle947";
const AT = "2026-11-01 19:30:00+00";

function dropId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

/** One drop, every column named, so each fixture row reads the same. */
function insertDrop(options: {
  id: string;
  handle: string;
  price: string | null;
  authority: string;
  evidence?: string;
}): string {
  const columns = [
    "id",
    "venue_id",
    "handle",
    "drink",
    "price_gbp",
    "passed_down_note",
    "era",
    "provenance",
    "status",
    "authority_key",
    "created_at",
    ...(options.evidence ? ["price_evidence"] : []),
  ];
  const values = [
    `'${options.id}'::uuid`,
    `'${VENUE}'`,
    `'${options.handle}'`,
    "'Lager'",
    options.price ?? "null",
    options.price === null ? "'Old local.'" : "''",
    "''",
    options.price === null ? "'anecdote'" : "'contributor'",
    "'visible'",
    `'${options.authority}'`,
    `timestamptz '${AT}'`,
    ...(options.evidence ? [`'${options.evidence}'`] : []),
  ];
  return `insert into public.pint_drops (${columns.join(", ")}) values (${values.join(", ")});`;
}

const evidenceColumnCount = () =>
  requireDatabase().sql(
    "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'pint_drops' and column_name = 'price_evidence'",
  );

beforeAll(async () => {
  if (skipReason) return;
  try {
    database = await startPostgres({ label: "pint-evidence", database: "pubmax_pint_evidence_0218" });
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

describe.skipIf(skipReason !== null)("0218 on PostgreSQL", () => {
  it("cannot tell a typed price from a billed one before the migration", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();
    expect(evidenceColumnCount()).toBe("0");

    // Two prices already on file (one billed, one whose bill Storage lost) and
    // a note. Nothing on the table says which price was checked.
    db.sql(insertDrop({ id: dropId(1), handle: "billed", price: "5.20", authority: "pubmax:hatton:a" }));
    db.sql(insertDrop({ id: dropId(2), handle: "lostbill", price: "5.20", authority: "pubmax:hatton:b" }));
    db.sql(insertDrop({ id: dropId(3), handle: "lore", price: null, authority: "pubmax:hatton:c" }));
    expect(db.sql(`select count(*) from public.pint_drops where venue_id = '${VENUE}'`)).toBe("3");
  });

  it("applies over those rows and re-judges none of them", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();

    db.applyFile(FORWARD);

    expect(evidenceColumnCount()).toBe("1");
    // NO BACKFILL: every row written before 0218 reads as it always has.
    expect(
      db.sql(`select count(*) from public.pint_drops where venue_id = '${VENUE}' and price_evidence is not null`),
    ).toBe("0");
    expect(
      db.sql(`select sum(price_gbp) from public.pint_drops where venue_id = '${VENUE}'`),
    ).toBe("10.40");
  });

  it("takes both words of the closed set the app owns, on a priced row", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();
    // The table's set and the app's set are one set.
    expect([...PRICE_EVIDENCE]).toEqual(["receipt", "unchecked"]);

    db.sql(
      insertDrop({ id: dropId(4), handle: "typed", price: "4.80", authority: "pubmax:hatton:d", evidence: "unchecked" }),
    );
    db.sql(
      insertDrop({ id: dropId(5), handle: "snapped", price: "4.80", authority: "pubmax:hatton:e", evidence: "receipt" }),
    );
    expect(
      db.sql(`select string_agg(price_evidence, ',' order by id) from public.pint_drops where id in ('${dropId(4)}'::uuid, '${dropId(5)}'::uuid)`),
    ).toBe("unchecked,receipt");
  });

  it("refuses a word outside the closed set, and evidence on a drop with no price", async () => {
    const db = requireDatabase();

    const unknown = await db.attempt(
      `update public.pint_drops set price_evidence = 'checked' where id = '${dropId(1)}'::uuid`,
    );
    expect(unknown.ok).toBe(false);
    expect(unknown.said).toContain("pint_drops_price_evidence_known");

    const onANote = await db.attempt(
      `update public.pint_drops set price_evidence = 'unchecked' where id = '${dropId(3)}'::uuid`,
    );
    expect(onANote.ok).toBe(false);
    expect(onANote.said).toContain("pint_drops_price_evidence_needs_price");
  });

  it("gives the column back on rollback, keeps every drinker's price, and re-applies", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();

    const before = db.sql(
      `select count(*) || ':' || coalesce(sum(price_gbp)::text, '0') from public.pint_drops where venue_id = '${VENUE}'`,
    );

    db.applyFile(ROLLBACK);

    expect(evidenceColumnCount()).toBe("0");
    expect(
      db.sql(
        "select count(*) from pg_constraint where conname in ('pint_drops_price_evidence_known', 'pint_drops_price_evidence_needs_price')",
      ),
    ).toBe("0");
    expect(
      db.sql(
        `select count(*) || ':' || coalesce(sum(price_gbp)::text, '0') from public.pint_drops where venue_id = '${VENUE}'`,
      ),
    ).toBe(before);

    // The migration re-applies over the rolled-back table, so the rollback is a
    // real way back rather than a one-way door.
    db.applyFile(FORWARD);
    expect(evidenceColumnCount()).toBe("1");
  });
});
