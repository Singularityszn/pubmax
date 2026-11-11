// Effective PostgreSQL proof for 0237: a stored message stamps its
// conversation's last_message_at.
//
// The inbox sorts and caps by last_message_at. send updates it best-effort
// after the insert, so a failed update left a restored chat sorting by an old
// stamp, outside the 100-chat inbox limit (#2776). The trigger moves the stamp
// in the same transaction as the insert, and the backfill repairs old stamps.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asServiceRole,
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20261111080000_0237_message_stamps_conversation.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20261111080000_0237_message_stamps_conversation_rollback.sql",
);
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

const STALE = "92370000-0000-4000-8000-000000000001";
const FRESH = "92370000-0000-4000-8000-000000000002";
const QUIET = "92370000-0000-4000-8000-000000000003";
const OLD_STAMP = "2026-11-01 12:00:00+00";

let database: PostgresSession | null = null;

function requireDatabase(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}

function stamp(conversation: string): string {
  return requireDatabase().sql(
    `select to_char(last_message_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') from public.conversations where id = '${conversation}';`,
  );
}

function send(conversation: string, createdAt: string): void {
  requireDatabase().sql(
    asServiceRole(
      `insert into public.messages (conversation_id, sender_handle, body, created_at)
         values ('${conversation}'::uuid, 'ken', 'see you there', '${createdAt}');`,
    ),
  );
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startPostgres({
    label: "message-stamps-conversation",
    database: "pubmax_message_stamps_conversation",
  });
  const session = requireDatabase();
  session.applyFile(SESSION_FIXTURE);
  for (const path of PREREQUISITES) session.applyFile(path);
  session.sql(
    [
      "insert into public.conversations (id, handle_a, handle_b, created_at, last_message_at) values",
      `  ('${STALE}'::uuid, 'ken', 'sam', '${OLD_STAMP}', '${OLD_STAMP}'),`,
      `  ('${FRESH}'::uuid, 'jen', 'ken', '${OLD_STAMP}', '${OLD_STAMP}'),`,
      `  ('${QUIET}'::uuid, 'ken', 'zoe', '${OLD_STAMP}', '${OLD_STAMP}');`,
    ].join("\n"),
  );
}, 240_000);

afterAll(async () => {
  await database?.stop();
  database = null;
});

describe.skipIf(skipReason !== null)("0237 a stored message stamps its conversation", () => {
  it("BEFORE the migration a message leaves the stamp behind when send's update fails", () => {
    send(STALE, "2026-11-05 09:00:00+00");
    expect(stamp(STALE)).toBe("2026-11-01 12:00:00");
  });

  it("applies cleanly, again with no change, and backfills the stale stamp", () => {
    const session = requireDatabase();
    session.applyFile(FORWARD);
    session.applyFile(FORWARD);
    expect(stamp(STALE)).toBe("2026-11-05 09:00:00");
    expect(stamp(QUIET)).toBe("2026-11-01 12:00:00");
  });

  it("stamps the conversation in the same insert, and touches no other", () => {
    send(FRESH, "2026-11-06 18:30:00+00");
    expect(stamp(FRESH)).toBe("2026-11-06 18:30:00");
    expect(stamp(QUIET)).toBe("2026-11-01 12:00:00");
  });

  it("never moves the stamp back for an older message", () => {
    send(FRESH, "2026-11-02 08:00:00+00");
    expect(stamp(FRESH)).toBe("2026-11-06 18:30:00");
  });

  it("keeps the trigger function closed to every browser role", () => {
    for (const role of ["anon", "authenticated"]) {
      expect(requireDatabase().sql(
        `select has_function_privilege('${role}', 'public._stamp_conversation_last_message_at()', 'execute');`,
      )).toBe("f");
    }
  });

  it("ROLLBACK stops the stamping and keeps stamps already moved, and the forward file applies again", () => {
    const session = requireDatabase();
    session.applyFile(ROLLBACK);
    send(QUIET, "2026-11-07 20:00:00+00");
    expect(stamp(QUIET)).toBe("2026-11-01 12:00:00");
    expect(stamp(FRESH)).toBe("2026-11-06 18:30:00");

    session.applyFile(FORWARD);
    expect(stamp(QUIET)).toBe("2026-11-07 20:00:00");
  });
});
