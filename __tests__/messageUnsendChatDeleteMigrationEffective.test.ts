// Effective PostgreSQL proof for 0230 (unsend a message, delete a chat).
//
// THE CLAIMS UNDER TEST are constraints and grants, so only a real database
// can answer them:
//
// 1. BEFORE 0230 an unsent message has no shape it could take: 0102's content
//    check refuses a row with no words and no attachment.
// 2. AFTER it, an unsent message holds nothing unless it was reported. A
//    reported one keeps its words for the moderator queue.
// 3. A chat delete is one mark per person per conversation, in the handle
//    alphabet, gone with its conversation, and closed to every browser role.
// 4. The rollback says what it costs and does it: deleted chats come back,
//    and an unsent message with nothing left in it is removed.

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
const FORWARD_NAME = "20261110120000_0230_message_unsend_and_chat_delete.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20261110120000_0230_message_unsend_and_chat_delete_rollback.sql",
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

const KEN = "77777777-0000-4000-8000-000000000001";
const DM = "99999999-0000-4000-8000-000000000001";
const OTHER_DM = "99999999-0000-4000-8000-000000000002";
const PLAIN = "aaaaaaaa-0000-4000-8000-000000000001";
const REPORTED = "aaaaaaaa-0000-4000-8000-000000000002";
const AT = "2026-11-10 20:00:00+00";

function count(sql: string): string {
  return requireDatabase().sql(sql);
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startPostgres({
    label: "unsend-chat-delete",
    database: "pubmax_unsend_chat_delete",
  });
  const session = requireDatabase();
  session.applyFile(SESSION_FIXTURE);
  for (const path of PREREQUISITES) session.applyFile(path);
  session.sql(
    [
      "insert into public.conversations (id, handle_a, handle_b, created_at, last_message_at) values",
      `  ('${DM}'::uuid, 'ken', 'sam', '${AT}', '${AT}'),`,
      `  ('${OTHER_DM}'::uuid, 'jen', 'ken', '${AT}', '${AT}');`,
      "insert into public.messages (id, conversation_id, sender_handle, body, created_at) values",
      `  ('${PLAIN}'::uuid, '${DM}'::uuid, 'ken', 'meet at 8', '${AT}'),`,
      `  ('${REPORTED}'::uuid, '${DM}'::uuid, 'ken', 'something nasty', '${AT}');`,
      `update public.messages set flagged_at = '${AT}', flagged_by = 'sam' where id = '${REPORTED}'::uuid;`,
    ].join("\n"),
  );
}, 240_000);

afterAll(async () => {
  await database?.stop();
  database = null;
});

describe.skipIf(skipReason !== null)("0230 unsend and chat delete", () => {
  it("BEFORE the migration a message cannot be emptied out", async () => {
    const said = await requireDatabase().attempt(
      `update public.messages set body = '' where id = '${PLAIN}'::uuid;`,
    );
    expect(said.ok).toBe(false);
    expect(said.said).toMatch(/messages_content_chk/);
  });

  it("applies cleanly, and again with no change", () => {
    const session = requireDatabase();
    session.applyFile(FORWARD);
    session.applyFile(FORWARD);
    expect(count("select count(*)::int from public.messages;")).toBe("2");
  });

  it("lets an unsent message hold nothing", async () => {
    const said = await requireDatabase().attempt(
      asServiceRole(
        `update public.messages set unsent_at = '${AT}', body = '' where id = '${PLAIN}'::uuid;`,
      ),
    );
    expect(said.ok).toBe(true);
  });

  it("refuses an unsent message that kept its words without a report", async () => {
    const session = requireDatabase();
    const said = await session.attempt(
      `insert into public.messages (conversation_id, sender_handle, body, created_at, unsent_at)
         values ('${DM}'::uuid, 'ken', 'still here', '${AT}', '${AT}');`,
    );
    expect(said.ok).toBe(false);
    expect(said.said).toMatch(/messages_unsent_empty_chk/);
  });

  it("keeps a reported message's words when it is unsent", async () => {
    const said = await requireDatabase().attempt(
      asServiceRole(`update public.messages set unsent_at = '${AT}' where id = '${REPORTED}'::uuid;`),
    );
    expect(said.ok).toBe(true);
    expect(count(`select body from public.messages where id = '${REPORTED}'::uuid;`)).toBe(
      "something nasty",
    );
  });

  it("still refuses a message that is nothing and was never unsent", async () => {
    const said = await requireDatabase().attempt(
      `insert into public.messages (conversation_id, sender_handle, body, created_at)
         values ('${DM}'::uuid, 'ken', '', '${AT}');`,
    );
    expect(said.ok).toBe(false);
  });

  it("keeps one delete mark per person per chat, in the handle alphabet", async () => {
    const session = requireDatabase();
    session.sql(
      asServiceRole(
        `insert into public.conversation_deletions (conversation_id, handle, deleted_at)
           values ('${DM}'::uuid, 'ken', '${AT}'), ('${OTHER_DM}'::uuid, 'ken', '${AT}')
           on conflict (conversation_id, handle) do update set deleted_at = excluded.deleted_at;`,
      ),
    );
    const twice = await session.attempt(
      `insert into public.conversation_deletions (conversation_id, handle) values ('${DM}'::uuid, 'ken');`,
    );
    expect(twice.ok).toBe(false);
    const shouted = await session.attempt(
      `insert into public.conversation_deletions (conversation_id, handle) values ('${DM}'::uuid, 'Ken');`,
    );
    expect(shouted.ok).toBe(false);
    session.sql(`delete from public.conversations where id = '${OTHER_DM}'::uuid;`);
    expect(count("select count(*)::int from public.conversation_deletions;")).toBe("1");
  });

  it("closes the delete marks to every browser role", async () => {
    const session = requireDatabase();
    for (const [role, sub] of [
      ["anon", null],
      ["authenticated", KEN],
    ] as const) {
      const read = await session.attempt(
        asBrowserRole(role, sub, "select count(*) from public.conversation_deletions;"),
      );
      expect(read.ok, role).toBe(false);
      expect(read.said, role).toMatch(/permission denied/);
      const write = await session.attempt(
        asBrowserRole(
          role,
          sub,
          `insert into public.conversation_deletions (conversation_id, handle) values ('${DM}'::uuid, 'sam');`,
        ),
      );
      expect(write.ok, role).toBe(false);
    }
  });

  it("ROLLBACK forgets every delete and removes what has nothing left in it", () => {
    const session = requireDatabase();
    session.applyFile(ROLLBACK);
    expect(count("select to_regclass('public.conversation_deletions') is null;")).toBe("t");
    expect(count(`select count(*)::int from public.messages where id = '${PLAIN}'::uuid;`)).toBe(
      "0",
    );
    expect(count(`select body from public.messages where id = '${REPORTED}'::uuid;`)).toBe(
      "something nasty",
    );
    expect(
      count(
        "select count(*)::int from information_schema.columns where table_name = 'messages' and column_name = 'unsent_at';",
      ),
    ).toBe("0");
  });

  it("is applied again cleanly after the rollback", () => {
    requireDatabase().applyFile(FORWARD);
    expect(count("select to_regclass('public.conversation_deletions') is not null;")).toBe("t");
  });
});
