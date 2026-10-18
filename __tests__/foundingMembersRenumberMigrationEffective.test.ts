// Effective PostgreSQL proof for 0190 (founding members renumbered).
//
// THE FAULT. The wall read 2, 3, 4, 5, 7, 8, 14 ... 19: deleted QA accounts
// kept Nos. 9-13, a suspended account kept No. 6, and the QA Pub Pal account
// and the smoke account sat at Nos. 18 and 19 (captain, 18 Oct 2026).
//
// THE PROOF. Apply every migration before 0190, claim the production cohort in
// its real order, retire the same rows, and show the gaps. Apply 0190 and show
// the live members hold 1..N in their old order, the test accounts hold
// nothing, a re-claim cannot hand one a number back, and a second apply after
// a later departure moves nothing. Then roll back and
// show every old number is where it was.

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
const FORWARD_NAME = "20261018100000_0190_founding_members_renumber.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20261018100000_0190_founding_members_renumber_rollback.sql",
);
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

// The production cohort, in claim order (No. 1 first).
const COHORT = [
  "karan",
  "karansznx",
  "blair",
  "tkm",
  "harichakaravarthi",
  "karansdad",
  "richardraghul",
  "jitvansaagar",
  "vp4qa39758",
  "vp4b43330",
  "vp5a737384",
  "vp5b737384",
  "astrascout83327",
  "ben",
  "schmali123",
  "davide",
  "lain",
  "qa_pubpal_1003",
  "pubmaxx_smoke",
] as const;
const DEPARTED = ["vp4qa39758", "vp4b43330", "vp5a737384", "vp5b737384", "astrascout83327"];
const EXCLUDED = ["karansdad", "qa_pubpal_1003", "pubmaxx_smoke"];
const LATECOMER = "a_new_member";

let database: PostgresSession | null = null;

function db(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}

function userFor(index: number): string {
  return `19019019-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function claim(index: number, handle: string): { ok: boolean; founding_member_number: number | null } {
  return JSON.parse(db().sql(`select public.claim_pubmaxx_handle('${userFor(index)}', '${handle}')`));
}

function wall(): string {
  return db().sql(
    "select string_agg(handle || '=' || founding_member_number, ',' order by founding_member_number) from public.profiles where founding_member_number is not null",
  );
}

const BEFORE = COHORT.map((handle, index) => `${handle}=${index + 1}`).join(",");

beforeAll(async () => {
  database = await startPostgres({ label: "founding-renumber-0190" });
  database.applyFile(SESSION_FIXTURE);
  for (const migration of PREREQUISITES) database.applyFile(migration);
  for (let index = 1; index <= COHORT.length + 1; index += 1) {
    database.sql(`insert into auth.users(id) values ('${userFor(index)}');`);
  }
}, 180_000);

afterAll(async () => database?.stop());

describe.skipIf(skipReason !== null)("0190 renumbers the founders wall", () => {
  it("reproduces the fault: departed and test accounts hold numbers", () => {
    COHORT.forEach((handle, index) => {
      expect(claim(index + 1, handle)).toMatchObject({ ok: true, founding_member_number: index + 1 });
    });
    db().sql(
      `update public.profiles set tombstoned_at = now(), user_id = null
        where handle in (${DEPARTED.map((handle) => `'${handle}'`).join(", ")});`,
    );
    expect(wall()).toBe(BEFORE);
  });

  it("after 0190 the live members hold 1..N in their old order and nobody else holds one", () => {
    db().applyFile(FORWARD);
    expect(wall()).toBe(
      [
        "karan=1",
        "karansznx=2",
        "blair=3",
        "tkm=4",
        "harichakaravarthi=5",
        "richardraghul=6",
        "jitvansaagar=7",
        "ben=8",
        "schmali123=9",
        "davide=10",
        "lain=11",
      ].join(","),
    );
    expect(
      db().sql(
        "select string_agg(handle, ',' order by handle) from public.profiles where founding_member_excluded",
      ),
    ).toBe([...EXCLUDED].sort().join(","));
  });

  it("a test account that re-claims its handle gets no number back", () => {
    const index = COHORT.indexOf("pubmaxx_smoke") + 1;
    expect(claim(index, "pubmaxx_smoke")).toMatchObject({ ok: true, founding_member_number: null });
  });

  it("the next real claim takes the next number", () => {
    expect(claim(COHORT.length + 1, LATECOMER)).toMatchObject({ ok: true, founding_member_number: 12 });
  });

  it("re-applying 0190 after a founder departs moves nothing", () => {
    // A departure after the first apply keeps its number (0097's rule), so a
    // second apply must not release it and shift everybody after it.
    db().sql("update public.profiles set tombstoned_at = now(), user_id = null where handle = 'lain'");
    const before = wall();
    const ledger = db().sql("select count(*) from pubmax_private.founding_member_renumber_0190");
    db().applyFile(FORWARD);
    expect(wall()).toBe(before);
    expect(db().sql("select count(*) from pubmax_private.founding_member_renumber_0190")).toBe(ledger);
  });

  it("no client role can read the way back", () => {
    for (const role of ["anon", "authenticated"]) {
      expect(
        db().sql(
          `select has_table_privilege('${role}', 'pubmax_private.founding_member_renumber_0190', 'select')`,
        ),
      ).toBe("f");
    }
  });

  it("the rollback puts every old number back and the latecomer gives up the clash", () => {
    db().applyFile(ROLLBACK);
    expect(wall()).toBe(BEFORE);
    expect(
      db().sql(`select founding_member_number is null from public.profiles where handle = '${LATECOMER}'`),
    ).toBe("t");
    expect(
      db().sql(
        "select count(*) from information_schema.columns where table_name = 'profiles' and column_name = 'founding_member_excluded'",
      ),
    ).toBe("0");
  });
});
