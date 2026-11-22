// Migration 0260, proved against a real PostgreSQL 16 holding every migration
// before it.
//
// K11: 0170 left `authenticated` a whole-table SELECT on `public.profiles`, and
// the owner policy admits the caller's own row. So a person whose avatar or
// cover was reported could read, through the database API, what the reporter
// wrote, who reported it (as hashes) and the moderator's note about them.
//
//   BEFORE 0260: the owner reads all six moderation columns of their own row.
//   AFTER  0260: the owner is refused those six columns and still reads the
//                rest of their own row. Another account still sees no rows.
//                The service role still reads everything.
//   ROLLBACK:    the whole-table grant comes back, and the forward file
//                re-applies.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
const FORWARD_NAME = "20261122110000_0260_profile_moderation_text_owner_read.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20261122110000_0260_profile_moderation_text_owner_read_rollback.sql",
);
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

const OWNER = "a2600000-0000-4000-8000-000000000001";
const OWNER_PROFILE = "a2600000-0000-4000-8000-000000000002";
const STRANGER = "b2600000-0000-4000-8000-000000000003";

const MODERATION_TEXT = [
  "avatar_report_reason",
  "avatar_report_actors",
  "avatar_moderator_note",
  "cover_report_reason",
  "cover_report_actors",
  "cover_moderator_note",
] as const;

let database: PostgresSession | null = null;

function db(): PostgresSession {
  if (!database) throw new Error("the 0260 proof cluster is not running");
  return database;
}

function ownRow(columns: string): string {
  return asBrowserRole("authenticated", OWNER, `select ${columns} from public.profiles where id = '${OWNER_PROFILE}'`);
}

function expectOwnerReadsModerationText(): void {
  for (const column of MODERATION_TEXT) {
    expect(db().sql(ownRow(`${column}::text`)), column).toMatch(/reporter wrote|reporter-hash|moderator noted/);
  }
}

async function expectOwnerRefusedModerationText(): Promise<void> {
  for (const column of MODERATION_TEXT) {
    const read = await db().attempt(ownRow(`${column}::text`));
    expect(read.ok, column).toBe(false);
    expect(read.said, column).toMatch(/permission denied/i);
    expect(read.said, column).not.toMatch(/reporter wrote|reporter-hash|moderator noted/);
  }
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startPostgres({ label: "moderation-text-0260", database: "pubmax_moderation_text_0260" });
  database.applyFile(SESSION_FIXTURE);
  for (const path of PREREQUISITES) database.applyFile(path);
  db().sql(`
    insert into auth.users (id) values ('${OWNER}'), ('${STRANGER}');
    insert into public.profiles (
      id, user_id, handle, display_name,
      avatar_report_reason, avatar_report_actors, avatar_moderator_note,
      cover_report_reason, cover_report_actors, cover_moderator_note
    ) values (
      '${OWNER_PROFILE}', '${OWNER}', 'reported260', 'Reported Person',
      'the reporter wrote this', array['reporter-hash-1'], 'the moderator noted this',
      'the reporter wrote that', array['reporter-hash-2'], 'the moderator noted that'
    );
  `);
}, 300_000);

afterAll(async () => {
  await database?.stop();
}, 180_000);

describe.skipIf(skipReason !== null)("0260: an account cannot read the moderation text about itself", () => {
  it("BEFORE: the owner reads the reporter's text and the moderator's note on their own row", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    expectOwnerReadsModerationText();
  });

  it("AFTER: the owner is refused the moderation text and still reads the rest of their row", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    db().applyFile(FORWARD);
    await expectOwnerRefusedModerationText();

    expect(db().sql(ownRow("handle, display_name, avatar_report_count, visibility"))).toContain("reported260");

    expect(
      db().sql(asBrowserRole("authenticated", STRANGER, `select count(*) from public.profiles where id = '${OWNER_PROFILE}'`)),
    ).toBe("0");

    const anon = await db().attempt(asBrowserRole("anon", null, "select count(*) from public.profiles"));
    expect(anon.ok).toBe(false);

    expect(
      db().sql(asServiceRole(`select avatar_moderator_note from public.profiles where id = '${OWNER_PROFILE}'`)),
    ).toBe("the moderator noted this");
  });

  it("ROLLBACK restores the whole-table read, and the forward file re-applies", async ({ skip }) => {
    if (skipReason) skip(skipReason);
    db().applyFile(ROLLBACK);
    expectOwnerReadsModerationText();

    db().applyFile(FORWARD);
    await expectOwnerRefusedModerationText();
  });
});
