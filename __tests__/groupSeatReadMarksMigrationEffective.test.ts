// Effective PostgreSQL proof for 0261 (each group seat keeps its own read mark).
//
// THE FAULT. A message row has one `read_at`. In a group the first reader
// stamped it, and the store's unread predicate (`read_at is null` and not sent
// by the viewer) then answered 0 for every other member.
//
// THE PROOF. Before 0261 a seat has nowhere to keep a mark, and one reader's
// stamp clears a second member's count. After 0261 every existing seat reads
// null, so the old stamps still answer for it, and a mark set to a message's
// own `created_at` covers that message to the microsecond and nothing after
// it. A browser role still cannot write a seat. The rollback drops the column
// and a second apply is clean.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asBrowserRole,
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20261122150000_0261_group_seat_read_marks.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(MIGRATIONS, "rollback/20261122150000_0261_group_seat_read_marks_rollback.sql");
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

const BEN = "26100000-0000-4000-8000-000000000002";

let database: PostgresSession | null = null;
let group = "";

function db(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}

function hasColumn(): string {
  return db().sql(`
    select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'conversation_members' and column_name = 'last_read_at'
  `);
}

/** The legacy predicate: received messages nobody has stamped. */
function stampedUnread(handle: string): string {
  return db().sql(`
    select count(*) from public.messages
     where conversation_id = '${group}' and sender_handle <> '${handle}' and read_at is null
  `);
}

/** The store's group predicate after 0261: unstamped and after the seat's own mark. */
function seatUnread(handle: string): string {
  return db().sql(`
    select count(*) from public.messages m
      join public.conversation_members s on s.conversation_id = m.conversation_id and s.handle = '${handle}'
     where m.conversation_id = '${group}' and m.sender_handle <> '${handle}' and m.read_at is null
       and (s.last_read_at is null or m.created_at > s.last_read_at)
  `);
}

beforeAll(async () => {
  database = await startPostgres({ label: "group-seat-read-marks-0261" });
  database.applyFile(SESSION_FIXTURE);
  for (const migration of PREREQUISITES) database.applyFile(migration);
  group = database.sql(`
    insert into public.conversations (kind, created_by_handle) values ('group', 'ana') returning id
  `);
  database.sql(`
    insert into public.conversation_members (conversation_id, handle, role) values
      ('${group}', 'ana', 'owner'), ('${group}', 'ben', 'member'), ('${group}', 'cal', 'member');
    insert into public.messages (conversation_id, sender_handle, body, created_at) values
      ('${group}', 'ana', 'old and read', '2026-11-22 10:00:00.000001+00'),
      ('${group}', 'ana', 'first round is mine', '2026-11-22 10:01:00.000001+00');
  `);
}, 180_000);

afterAll(async () => database?.stop());

describe.skipIf(skipReason !== null)("0261 group seat read marks", () => {
  it("before 0261, one reader's stamp clears every other member's count", () => {
    expect(hasColumn()).toBe("0");
    expect(stampedUnread("cal")).toBe("2");
    db().sql(`update public.messages set read_at = now()
               where conversation_id = '${group}' and body = 'old and read'`);
    expect(stampedUnread("cal")).toBe("1");
  });

  it("after 0261, an existing seat has no mark and the old stamps still answer for it", () => {
    db().applyFile(FORWARD);
    expect(hasColumn()).toBe("1");
    expect(db().sql(`select count(*) from public.conversation_members where last_read_at is not null`)).toBe("0");
    expect(seatUnread("cal")).toBe("1");
  });

  it("a mark at a message's created_at covers it to the microsecond and nobody else's count moves", () => {
    db().sql(`
      update public.conversation_members
         set last_read_at = (select max(created_at) from public.messages where conversation_id = '${group}')
       where conversation_id = '${group}' and handle = 'ben'
    `);
    expect(seatUnread("ben")).toBe("0");
    expect(seatUnread("cal")).toBe("1");
    db().sql(`insert into public.messages (conversation_id, sender_handle, body, created_at)
              values ('${group}', 'ana', 'second round', '2026-11-22 10:01:00.000002+00')`);
    expect(seatUnread("ben")).toBe("1");
  });

  it("a browser role cannot write a seat mark", async () => {
    const attempt = await db().attempt(
      asBrowserRole(
        "authenticated",
        BEN,
        `update public.conversation_members set last_read_at = now() where handle = 'cal'`,
      ),
    );
    expect(attempt.ok).toBe(false);
  });

  it("the rollback drops the column and a second apply is clean", () => {
    db().applyFile(ROLLBACK);
    expect(hasColumn()).toBe("0");
    db().applyFile(FORWARD);
    db().applyFile(FORWARD);
    expect(hasColumn()).toBe("1");
  });
});
