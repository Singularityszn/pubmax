// Effective PostgreSQL proof for 0176 (the handle `you` is reserved).
//
// THE FAULT. `/u/you` is the viewer's own sentinel route and `handle=you` is
// the self alias. 0152's claim RPC and 0029's rename RPC carried their own
// copy of the reserved list and `you` was not on it, so a real account could
// own the name: its profile never loaded and a signed-out read of
// `/api/profiles/you` returned a stranger (QA F01, 6 Oct 2026).
//
// THE PROOF. Apply every migration before 0176, show both RPCs ACCEPT `you`,
// apply 0176, show both refuse it as `reserved` and still mint an ordinary
// handle, then apply the rollback and show the old behaviour is back.

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
const FORWARD_NAME = "20261006140000_0176_reserve_handle_you.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20261006140000_0176_reserve_handle_you_rollback.sql",
);
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

const CLAIMER = "77777777-0000-4000-8000-000000000001";
const RENAMER = "77777777-0000-4000-8000-000000000002";
const ROLLBACK_CLAIMER = "77777777-0000-4000-8000-000000000003";
const ROLLBACK_RENAMER = "77777777-0000-4000-8000-000000000004";

type Result = { ok: boolean; code?: string; handle?: string };

let database: PostgresSession | null = null;

function db(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}

function claim(user: string, handle: string): Result {
  return JSON.parse(db().sql(`select public.claim_pubmaxx_handle('${user}', '${handle}')`));
}

function rename(user: string, handle: string): Result {
  return JSON.parse(db().sql(`select public.rename_pubmaxx_handle('${user}', '${handle}')`));
}

beforeAll(async () => {
  database = await startPostgres({ label: "reserve-you-0176" });
  database.applyFile(SESSION_FIXTURE);
  for (const migration of PREREQUISITES) database.applyFile(migration);
  for (const id of [CLAIMER, RENAMER, ROLLBACK_CLAIMER, ROLLBACK_RENAMER]) {
    database.sql(`insert into auth.users(id) values ('${id}');`);
  }
}, 180_000);

afterAll(async () => database?.stop());

describe.skipIf(skipReason !== null)("0176 reserves the handle you", () => {
  it("reproduces the fault: before 0176 the claim RPC hands out `you`", () => {
    const result = claim(ROLLBACK_CLAIMER, "you");
    expect(result).toMatchObject({ ok: true, handle: "you" });
    // Leave the database as the fault found it for the other doors.
    db().sql(
      `delete from public.profile_handle_aliases where lower(handle) = 'you';
       delete from public.profiles where lower(handle) = 'you';`,
    );
  });

  it("reproduces the fault: before 0176 the rename RPC hands out `you`", () => {
    expect(claim(ROLLBACK_RENAMER, "before_you")).toMatchObject({ ok: true });
    expect(rename(ROLLBACK_RENAMER, "you")).toMatchObject({ ok: true, handle: "you" });
    db().sql(
      `delete from public.profile_handle_aliases where profile_id in (select id from public.profiles where user_id = '${ROLLBACK_RENAMER}');
       delete from public.profiles where user_id = '${ROLLBACK_RENAMER}';`,
    );
  });

  it("after 0176 claim and rename both refuse `you` as reserved, in any case", () => {
    db().applyFile(FORWARD);
    for (const raw of ["you", "YOU", "  You "]) {
      expect(claim(CLAIMER, raw)).toMatchObject({ ok: false, code: "reserved" });
    }
    expect(claim(RENAMER, "rename_me")).toMatchObject({ ok: true });
    for (const raw of ["you", "YOU"]) {
      expect(rename(RENAMER, raw)).toMatchObject({ ok: false, code: "reserved" });
    }
    expect(db().sql("select count(*) from public.profiles where lower(handle) = 'you'")).toBe("0");
  });

  it("after 0176 an ordinary and a `you`-prefixed handle still claim", () => {
    expect(claim(CLAIMER, "youth")).toMatchObject({ ok: true, handle: "youth" });
  });

  it("the rollback restores the old behaviour and leaves every row alone", () => {
    db().applyFile(ROLLBACK);
    expect(db().sql("select count(*) from public.profiles where lower(handle) in ('youth', 'rename_me')")).toBe("2");
    expect(claim(ROLLBACK_CLAIMER, "you")).toMatchObject({ ok: true, handle: "you" });
  });
});
