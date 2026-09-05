// Effective PostgreSQL proof for 0140 (#1354).
//
// The claim under test is not "the SQL parses". It is that a real server holding
// every migration before this one CANNOT record a confirmation at all, that
// 0140 makes one recordable, that a HALF-WRITTEN confirmation is refused rather
// than stored as evidence nobody can look up, and that the rollback takes the
// columns while leaving every drinker's Pint Drop where it was.

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
const FORWARD_NAME = "20260903170000_0140_pint_drop_confirmations.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20260903170000_0140_pint_drop_confirmations_rollback.sql",
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

const VENUE = "venue-confirm-1354";
const DROP_A = "00000000-0000-4000-8000-0000000000c1";
const DROP_B = "00000000-0000-4000-8000-0000000000c2";
const CONFIRMATION = "00000000-0000-4000-8000-0000000000cf";

function seedPair(db: PostgresSession): void {
  db.sql(`
    delete from public.pint_drops where venue_id = '${VENUE}';
    insert into public.pint_drops
      (id, venue_id, handle, drink, price_gbp, passed_down_note, era, provenance, status, created_at)
    values
      ('${DROP_A}'::uuid, '${VENUE}', 'karan', 'Pint', 4.20, '', '', 'contributor', 'visible', now()),
      ('${DROP_B}'::uuid, '${VENUE}', 'sam', 'Pint', 4.50, '', '', 'contributor', 'visible', now());
  `);
}

function confirmPair(db: PostgresSession, basis: string, peer: string | null): void {
  db.sql(`
    update public.pint_drops
       set confirmation_id = '${CONFIRMATION}'::uuid,
           confirmed_at = now(),
           confirmation_basis = '${basis}',
           confirming_drop_id = ${peer === null ? "null" : `'${peer}'::uuid`}
     where id in ('${DROP_A}'::uuid, '${DROP_B}'::uuid);
  `);
}

beforeAll(async () => {
  if (skipReason) return;
  try {
    database = await startPostgres({ label: "pint-confirm", database: "pubmax_pint_confirm_0140" });
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

describe.skipIf(skipReason !== null)("0140 on PostgreSQL", () => {
  it("cannot record a confirmation before the migration, and can after it", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();
    seedPair(db);

    // The gap the London scout reported, on a real server: there is nowhere to
    // put a confirmation, so green is unreachable however the app is written.
    expect(
      db.sql(
        "select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'pint_drops' and column_name = 'confirmation_id'",
      ),
    ).toBe("0");
    expect(() => confirmPair(db, "second_reporter", DROP_B)).toThrow();

    db.applyFile(FORWARD);

    confirmPair(db, "second_reporter", DROP_B);
    // ONE agreement between two reporters is ONE event, so both rows answer the
    // same citation.
    expect(
      db.sql(
        `select count(distinct confirmation_id)::text from public.pint_drops where venue_id = '${VENUE}' and confirmation_id is not null`,
      ),
    ).toBe("1");
    expect(
      db.sql(
        `select count(*)::text from public.pint_drops where venue_id = '${VENUE}' and confirmation_id is not null`,
      ),
    ).toBe("2");
    // The read the trust standing and the Index producer both make.
    expect(
      db.sql(
        "select count(*)::text from pg_indexes where schemaname = 'public' and indexname = 'pint_drops_confirmed_venue_idx'",
      ),
    ).toBe("1");
  }, 300_000);

  it("refuses a confirmation that could not answer the citation it invites", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();
    seedPair(db);

    // An id with no date and no basis is not evidence: the Index cites the id
    // and then has nothing to say about when, or on what grounds.
    expect(() =>
      db.sql(
        `update public.pint_drops set confirmation_id = '${CONFIRMATION}'::uuid where id = '${DROP_A}'::uuid`,
      ),
    ).toThrow();
    // A basis nobody defined is the same problem wearing a word.
    expect(() => confirmPair(db, "vibes", DROP_B)).toThrow();
    // A moderator confirmation is one person's decision and names no peer, so a
    // peer id on that basis would be a claim nobody made.
    expect(() => confirmPair(db, "moderator", DROP_B)).toThrow();
    confirmPair(db, "moderator", null);
    expect(
      db.sql(
        `select count(*)::text from public.pint_drops where venue_id = '${VENUE}' and confirmation_basis = 'moderator' and confirming_drop_id is null`,
      ),
    ).toBe("2");
  }, 300_000);

  it("takes the confirmation and no drinker's Pint Drop on rollback", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();
    seedPair(db);
    confirmPair(db, "second_reporter", DROP_B);

    db.applyFile(ROLLBACK);

    expect(
      db.sql(
        "select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'pint_drops' and column_name in ('confirmation_id','confirmed_at','confirmation_basis','confirming_drop_id')",
      ),
    ).toBe("0");
    expect(
      db.sql(
        "select count(*)::text from pg_indexes where schemaname = 'public' and indexname = 'pint_drops_confirmed_venue_idx'",
      ),
    ).toBe("0");
    // Every price, date and author survives. A confirmation is evidence we
    // derived; a Pint Drop is a drinker's own account, and a rollback of ours
    // may not cost them one.
    expect(
      db.sql(
        `select string_agg(price_gbp::numeric(10,2)::text, ',' order by handle) from public.pint_drops where venue_id = '${VENUE}'`,
      ),
    ).toBe("4.20,4.50");
  }, 300_000);
});
