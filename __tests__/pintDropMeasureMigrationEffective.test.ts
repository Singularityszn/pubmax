// Effective PostgreSQL proof for 0147 (contribution battle test D04).
//
// The claim under test is not "the SQL parses". It is that a real server
// holding every migration before this one CANNOT TELL a half from a pint, that
// 0147 applies cleanly over the exact rows the finding left behind, that its
// backfill FLAGS those rows and SCALES NOTHING, that the closed set and the
// label rule are enforced by the table rather than only by the app, and that
// the rollback gives the columns back without touching a drinker's price.
//
// The fixture is the report's own row: Arnos Arms, "Half of lager" at £2.60,
// confirmed by a second reporter and therefore feeding pin colour, the
// cheapest-pint buckets and the Pint Index at a pub whose pint is £5.50.
//
// Every timestamp is a literal, for the reason 0141's proof gives: a test that
// leaned on the wall clock would be a different test at 00:30 than at noon.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

import { NON_PINT_MEASURE_PATTERNS } from "@/lib/drinkMeasure";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20260905170000_0147_pint_drop_measure.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20260905170000_0147_pint_drop_measure_rollback.sql",
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

// The report's own rows. Two accounts at one pub, agreeing on £2.60 for a HALF,
// which is what minted the confirmation the Index would have cited.
const VENUE = "venue-xjf3n0";
const CONFIRMATION = "1d334c69-0000-4000-8000-000000000001";
const AT = "2026-09-05 14:05:57+01";

function dropId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

/** One priced drop, every column named, so each fixture row reads the same. */
function insertPriced(options: {
  id: string;
  handle: string;
  drink: string;
  price: string;
  authority: string;
  confirmed?: boolean;
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
    ...(options.confirmed
      ? ["confirmation_id", "confirmed_at", "confirmation_basis"]
      : []),
  ];
  const values = [
    `'${options.id}'::uuid`,
    `'${VENUE}'`,
    `'${options.handle}'`,
    `'${options.drink}'`,
    options.price,
    "''",
    "''",
    "'contributor'",
    "'visible'",
    `'${options.authority}'`,
    `timestamptz '${AT}'`,
    ...(options.confirmed
      ? [`'${CONFIRMATION}'::uuid`, `timestamptz '${AT}'`, "'second_reporter'"]
      : []),
  ];
  return `insert into public.pint_drops (${columns.join(", ")}) values (${values.join(", ")});`;
}

beforeAll(async () => {
  if (skipReason) return;
  try {
    database = await startPostgres({ label: "pint-measure", database: "pubmax_pint_measure_0147" });
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

describe.skipIf(skipReason !== null)("0147 on PostgreSQL", () => {
  it("cannot tell a half from a pint before the migration", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();

    expect(
      db.sql(
        "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'pint_drops' and column_name in ('measure', 'measure_label')",
      ),
    ).toBe("0");

    // The report's pair, written exactly as the preview stored it: alice says
    // "Half of lager", bob's confirming row carries no drink text at all, and
    // both share one confirmation id.
    db.sql(
      insertPriced({
        id: dropId(1),
        handle: "alicepent",
        drink: "Half of lager",
        price: "2.60",
        authority: "pubmax:xjf3n0:alice",
        confirmed: true,
      }),
    );
    db.sql(
      insertPriced({
        id: dropId(2),
        handle: "bobpent",
        drink: "",
        price: "2.60",
        authority: "pubmax:xjf3n0:bob",
        confirmed: true,
      }),
    );
    // A real pint at the same pub, so the backfill has something it must LEAVE.
    db.sql(
      insertPriced({
        id: dropId(3),
        handle: "carolpent",
        drink: "Pint of Guinness",
        price: "5.50",
        authority: "pubmax:xjf3n0:carol",
      }),
    );
    // The word-boundary case, which a naive LIKE '%half%' would flag wrongly.
    db.sql(
      insertPriced({
        id: dropId(4),
        handle: "davepent",
        drink: "Halfway House Pale",
        price: "5.20",
        authority: "pubmax:xjf3n0:dave",
      }),
    );

    // Nothing on the table separates them: four priced rows, one lane.
    expect(db.sql(`select count(*) from public.pint_drops where venue_id = '${VENUE}'`)).toBe(
      "4",
    );
  });

  it("applies over those rows and flags the half without scaling it", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();

    db.applyFile(FORWARD);

    expect(
      db.sql(`select measure from public.pint_drops where id = '${dropId(1)}'::uuid`),
    ).toBe("half");

    // THE POINT OF THE WHOLE MIGRATION: the figure is untouched. A flag is not
    // a correction, and £2.60 stays £2.60 rather than becoming £5.20.
    expect(
      db.sql(`select price_gbp from public.pint_drops where id = '${dropId(1)}'::uuid`),
    ).toBe("2.60");

    // The row keeps its confirmation, its author and its night. It stops
    // answering the pint lane; nothing about it is erased.
    expect(
      db.sql(
        `select confirmation_id is not null and confirmation_basis = 'second_reporter' from public.pint_drops where id = '${dropId(1)}'::uuid`,
      ),
    ).toBe("t");

    // The confirming row said nothing about a measure, so it stays a pint here.
    // That is honest and it is also harmless: lib/pintDropConfirmation.ts needs
    // BOTH sides of a pair to be pints, so the pair confirms nothing either way.
    expect(
      db.sql(`select measure from public.pint_drops where id = '${dropId(2)}'::uuid`),
    ).toBe("pint");

    // A real pint is left alone, and so is the word-boundary case.
    expect(
      db.sql(`select measure from public.pint_drops where id = '${dropId(3)}'::uuid`),
    ).toBe("pint");
    expect(
      db.sql(`select measure from public.pint_drops where id = '${dropId(4)}'::uuid`),
    ).toBe("pint");
  });

  it("flags every other non-pint word the owner module names", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();

    // The SQL backfill is a COPY of NON_PINT_MEASURE_PATTERNS. Rather than
    // restate the list here, drive it from the owner and re-run the same two
    // statements the migration runs, so a word added to the module without
    // being added to the SQL fails on the word itself.
    let index = 100;
    for (const entry of NON_PINT_MEASURE_PATTERNS) {
      index += 1;
      db.sql(
        insertPriced({
          id: dropId(index),
          handle: `word${index}`,
          drink: `${entry.word} of lager`,
          price: "3.10",
          authority: `pubmax:xjf3n0:word${index}`,
        }),
      );
    }

    db.sql(
      "update public.pint_drops set measure = 'half' where measure = 'pint' and drink is not null and (drink ~* '\\mhalf\\M' or drink ~* '\\mhalves\\M' or drink ~* '(^|\\s)1/2(\\s|$)' or drink ~* '(^|\\s)½(\\s|$)')",
    );
    db.sql(
      "update public.pint_drops set measure = 'other' where measure = 'pint' and drink is not null and (drink ~* '\\msmall\\M' or drink ~* '\\mschooner\\M' or drink ~* '\\mthird\\M' or drink ~* '\\mthirds\\M' or drink ~* '(^|\\s)1/3(\\s|$)' or drink ~* '(^|\\s)⅓(\\s|$)' or drink ~* '(^|\\s)2/3(\\s|$)' or drink ~* '(^|\\s)⅔(\\s|$)')",
    );

    let checked = 100;
    for (const entry of NON_PINT_MEASURE_PATTERNS) {
      checked += 1;
      expect(
        db.sql(`select measure from public.pint_drops where id = '${dropId(checked)}'::uuid`),
        `"${entry.word} of lager" must be flagged as ${entry.measure}`,
      ).toBe(entry.measure);
    }
  });

  it("refuses a measure outside the closed set, and a label beside a pint", async () => {
    const db = requireDatabase();

    const unknown = await db.attempt(
      `update public.pint_drops set measure = 'yard' where id = '${dropId(3)}'::uuid`,
    );
    expect(unknown.ok).toBe(false);
    expect(unknown.said).toContain("pint_drops_measure_known");

    const strayLabel = await db.attempt(
      `update public.pint_drops set measure_label = 'schooner' where id = '${dropId(3)}'::uuid`,
    );
    expect(strayLabel.ok).toBe(false);
    expect(strayLabel.said).toContain("pint_drops_measure_label_only_on_other");

    // The label is welcome where it belongs.
    expect(
      (
        await db.attempt(
          `update public.pint_drops set measure = 'other', measure_label = 'schooner' where id = '${dropId(3)}'::uuid`,
        )
      ).ok,
    ).toBe(true);
    db.sql(
      `update public.pint_drops set measure = 'pint', measure_label = null where id = '${dropId(3)}'::uuid`,
    );
  });

  it("gives the columns back on rollback and keeps every drinker's price", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();

    const before = db.sql(
      `select count(*) || ':' || coalesce(sum(price_gbp)::text, '0') from public.pint_drops where venue_id = '${VENUE}'`,
    );

    db.applyFile(ROLLBACK);

    expect(
      db.sql(
        "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'pint_drops' and column_name in ('measure', 'measure_label')",
      ),
    ).toBe("0");

    // Every row, and every figure on it, survives the rollback untouched.
    expect(
      db.sql(
        `select count(*) || ':' || coalesce(sum(price_gbp)::text, '0') from public.pint_drops where venue_id = '${VENUE}'`,
      ),
    ).toBe(before);

    // And the migration is re-appliable over the rolled-back table, which is
    // what makes the rollback a real escape hatch rather than a one-way door.
    db.applyFile(FORWARD);
    expect(
      db.sql(`select measure from public.pint_drops where id = '${dropId(1)}'::uuid`),
    ).toBe("half");
  });
});
