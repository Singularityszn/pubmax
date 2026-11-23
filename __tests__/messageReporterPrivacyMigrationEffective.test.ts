// Effective PostgreSQL proof for 0257 (a participant never reads who reported
// a message).
//
// `messages.flagged_by` names the reporter. Before 0257 every participant of a
// thread held SELECT on the whole row, so in a group thread the reported
// sender could ask the table for `flagged_by` and learn who reported them.
//
// 1. BEFORE 0257 a group participant reads the reporter's handle.
// 2. AFTER it the reporter column is refused to every browser role, the rest
//    of the row still reads, and the poll-vote policy that reads `messages`
//    as the caller still admits a voter's own ballot.
// 3. The rollback hands the reporter column back.

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
const FORWARD_NAME = "20261122100000_0257_message_reporter_privacy.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20261122100000_0257_message_reporter_privacy_rollback.sql",
);
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

const DAVE = "77777777-0000-4000-8000-000000000001";
const ERIN = "77777777-0000-4000-8000-000000000002";
const FAY = "77777777-0000-4000-8000-000000000003";
const GROUP = "99999999-0000-4000-8000-000000000001";
const REPORTED = "aaaaaaaa-0000-4000-8000-000000000001";
const POLL = "aaaaaaaa-0000-4000-8000-000000000002";
const AT = "2026-11-22 20:00:00+00";

const READ_REPORTER = `select flagged_by from public.messages where id = '${REPORTED}';`;

let database: PostgresSession | null = null;

function requireDatabase(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}

function said(statement: string): string {
  return requireDatabase().sql(statement);
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startPostgres({
    label: "message-reporter-privacy",
    database: "pubmax_message_reporter_privacy",
  });
  const session = requireDatabase();
  session.applyFile(SESSION_FIXTURE);
  for (const path of PREREQUISITES) session.applyFile(path);
  session.sql(`
    insert into auth.users (id) values ('${DAVE}'), ('${ERIN}'), ('${FAY}');
    insert into public.profiles (id, user_id, handle) values
      ('${DAVE}', '${DAVE}', 'dave'),
      ('${ERIN}', '${ERIN}', 'erin'),
      ('${FAY}', '${FAY}', 'fay');
    insert into public.conversations (id, kind) values ('${GROUP}', 'group');
    insert into public.conversation_members (conversation_id, handle, role) values
      ('${GROUP}', 'dave', 'owner'), ('${GROUP}', 'erin', 'member'), ('${GROUP}', 'fay', 'member');
    insert into public.messages (id, conversation_id, sender_handle, body, created_at) values
      ('${REPORTED}', '${GROUP}', 'dave', 'something nasty', '${AT}');
    insert into public.messages
      (id, conversation_id, sender_handle, body, created_at, attachment_kind,
       attachment_poll_question, attachment_poll_options) values
      ('${POLL}', '${GROUP}', 'fay', 'vote', '${AT}', 'poll', 'Which pub?', '["Crown", "Anchor"]');
    insert into public.message_poll_votes (message_id, voter_handle, option_index) values
      ('${POLL}', 'erin', 1);
    update public.messages set flagged_at = '${AT}', flagged_by = 'erin' where id = '${REPORTED}';
  `);
}, 240_000);

afterAll(async () => {
  await database?.stop();
  database = null;
});

describe.skipIf(skipReason !== null)("0257 message reporter privacy", () => {
  it("BEFORE the migration the reported sender reads who reported them", () => {
    expect(said(asBrowserRole("authenticated", DAVE, READ_REPORTER))).toBe("erin");
  });

  it("applies cleanly, and again with no change", () => {
    const session = requireDatabase();
    session.applyFile(FORWARD);
    session.applyFile(FORWARD);
    expect(said("select count(*)::int from public.messages;")).toBe("2");
  });

  it("refuses the reporter column to every browser role", async () => {
    const session = requireDatabase();
    for (const [role, sub] of [
      ["authenticated", DAVE],
      ["authenticated", FAY],
      ["anon", null],
    ] as const) {
      for (const statement of [READ_REPORTER, `select * from public.messages where id = '${REPORTED}';`]) {
        const read = await session.attempt(asBrowserRole(role, sub, statement));
        expect(read.ok, `${role} ${sub}`).toBe(false);
        expect(read.said, `${role} ${sub}`).toMatch(/permission denied/);
      }
    }
  });

  it("still lets a participant read the thread and see that a message was reported", () => {
    expect(
      said(
        asBrowserRole(
          "authenticated",
          DAVE,
          `select body || ' ' || (flagged_at is not null) from public.messages where id = '${REPORTED}';`,
        ),
      ),
    ).toBe("something nasty true");
  });

  it("still admits a voter's own ballot through the policy that reads messages", () => {
    expect(
      said(
        asBrowserRole(
          "authenticated",
          ERIN,
          `select option_index from public.message_poll_votes where message_id = '${POLL}';`,
        ),
      ),
    ).toBe("1");
  });

  it("keeps the reporter for the service role", () => {
    expect(said(asServiceRole(READ_REPORTER))).toBe("erin");
  });

  it("ROLLBACK hands the reporter column back to participants", () => {
    requireDatabase().applyFile(ROLLBACK);
    expect(said(asBrowserRole("authenticated", DAVE, READ_REPORTER))).toBe("erin");
  });

  it("is applied again cleanly after the rollback", async () => {
    requireDatabase().applyFile(FORWARD);
    const read = await requireDatabase().attempt(asBrowserRole("authenticated", DAVE, READ_REPORTER));
    expect(read.ok).toBe(false);
  });
});
