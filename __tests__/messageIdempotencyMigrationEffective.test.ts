// Effective PostgreSQL proof for 0149 (adversarial review F-25).
//
// THE CLAIM UNDER TEST is that one send attempt can only ever be one row. A
// connection reset after the row committed used to answer the browser as a
// failure, so the drinker sent the line again and the conversation held it
// twice. The browser now mints one uuid per attempt; this index is what makes
// the second arrival a conflict rather than a second message.
//
// The proof is the SERVER's, not the store's: it runs the two inserts against a
// real PostgreSQL 16 that holds every migration, so the guarantee is the table's
// and does not depend on the application winning a race with itself.
//
// Every timestamp is a literal, for the reason 0141's proof gives.

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
const FORWARD_NAME = "20260905190000_0149_message_client_idempotency.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20260905190000_0149_message_client_idempotency_rollback.sql",
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

const CONVERSATION = "22222222-0000-4000-8000-000000000001";
const OTHER_CONVERSATION = "22222222-0000-4000-8000-000000000002";
const KEY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const AT = "2026-09-05 22:40:00+01";

async function insertMessage(options: {
  conversationId: string;
  body: string;
  clientMessageId?: string | null;
}): Promise<{ ok: boolean; said: string }> {
  const columns = ["conversation_id", "sender_handle", "body", "created_at"];
  const values = [
    `'${options.conversationId}'::uuid`,
    "'ken'",
    `'${options.body}'`,
    `'${AT}'`,
  ];
  if (options.clientMessageId !== undefined) {
    columns.push("client_message_id");
    values.push(options.clientMessageId === null ? "null" : `'${options.clientMessageId}'::uuid`);
  }
  return requireDatabase().attempt(
    `insert into public.messages (${columns.join(", ")}) values (${values.join(", ")});`,
  );
}

function messageCount(conversationId: string): string {
  return requireDatabase().sql(
    `select count(*)::int from public.messages where conversation_id = '${conversationId}'::uuid;`,
  );
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startPostgres({ label: "message-idem", database: "pubmax_message_idempotency" });
  const session = requireDatabase();
  session.applyFile(SESSION_FIXTURE);
  for (const path of PREREQUISITES) session.applyFile(path);
  session.sql(
    [
      `insert into public.conversations (id, handle_a, handle_b, created_at, last_message_at)`,
      `  values ('${CONVERSATION}'::uuid, 'ken', 'sam', '${AT}', '${AT}'),`,
      `         ('${OTHER_CONVERSATION}'::uuid, 'jen', 'ken', '${AT}', '${AT}');`,
    ].join("\n"),
  );
}, 180_000);

afterAll(async () => {
  await database?.stop();
  database = null;
});

describe.skipIf(skipReason !== null || process.env.PUBMAX_MESSAGE_IDEMPOTENCY_NO_PG === "1")(
  "0149 message send idempotency",
  () => {
    it("BEFORE the migration the column is not there, and a repeat is a second message", async () => {
      const session = requireDatabase();
      expect(
        session.sql(
          "select count(*)::int from information_schema.columns " +
            "where table_schema = 'public' and table_name = 'messages' and column_name = 'client_message_id';",
        ),
      ).toBe("0");
      expect((await insertMessage({ conversationId: CONVERSATION, body: "twice over" })).ok).toBe(true);
      expect((await insertMessage({ conversationId: CONVERSATION, body: "twice over" })).ok).toBe(true);
      expect(messageCount(CONVERSATION)).toBe("2");
    });

    it("applies over the rows already there, leaving every one of them alone", () => {
      const session = requireDatabase();
      session.applyFile(FORWARD);

      expect(messageCount(CONVERSATION)).toBe("2");
      // Every pre-0149 row carries NULL, which the partial index never matches.
      expect(
        session.sql(
          "select count(*)::int from public.messages where client_message_id is null;",
        ),
      ).toBe("2");
      expect(
        session.sql(
          "select indexdef from pg_indexes " +
            "where indexname = 'messages_conversation_client_message_id_idx';",
        ),
      ).toContain("WHERE (client_message_id IS NOT NULL)");
    });

    it("is idempotent, so a re-run of the apply list changes nothing", () => {
      const session = requireDatabase();
      session.applyFile(FORWARD);
      expect(
        session.sql(
          "select count(*)::int from pg_indexes " +
            "where indexname = 'messages_conversation_client_message_id_idx';",
        ),
      ).toBe("1");
    });

    // ── THE FINDING ─────────────────────────────────────────────────────────
    it("REFUSES the same attempt arriving twice, at the table", async () => {
      expect((await insertMessage({ conversationId: CONVERSATION, body: "one round", clientMessageId: KEY })).ok).toBe(true);
      const replay = await insertMessage({
        conversationId: CONVERSATION,
        body: "one round",
        clientMessageId: KEY,
      });

      expect(replay.ok).toBe(false);
      expect(replay.said).toContain("messages_conversation_client_message_id_idx");
      expect(replay.said).toContain("23505");
      expect(messageCount(CONVERSATION)).toBe("3");
    });

    it("still takes TWO deliberate sends, because each carries its own key", async () => {
      const second = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
      expect((await insertMessage({ conversationId: CONVERSATION, body: "and another", clientMessageId: second })).ok).toBe(true);
      expect(messageCount(CONVERSATION)).toBe("4");
    });

    it("scopes the key to ONE conversation, so two threads may reuse a client's id", async () => {
      expect((await insertMessage({ conversationId: OTHER_CONVERSATION, body: "elsewhere", clientMessageId: KEY })).ok).toBe(true);
      expect(messageCount(OTHER_CONVERSATION)).toBe("1");
    });

    it("never treats two UNKEYED rows as one, so a legacy lane is untouched", async () => {
      expect((await insertMessage({ conversationId: OTHER_CONVERSATION, body: "plain", clientMessageId: null })).ok).toBe(true);
      expect((await insertMessage({ conversationId: OTHER_CONVERSATION, body: "plain", clientMessageId: null })).ok).toBe(true);
      expect(messageCount(OTHER_CONVERSATION)).toBe("3");
    });

    it("the ROLLBACK gives the column back and keeps every message", () => {
      const session = requireDatabase();
      const before = messageCount(CONVERSATION);
      session.applyFile(ROLLBACK);

      expect(
        session.sql(
          "select count(*)::int from information_schema.columns " +
            "where table_schema = 'public' and table_name = 'messages' and column_name = 'client_message_id';",
        ),
      ).toBe("0");
      expect(
        session.sql(
          "select count(*)::int from pg_indexes " +
            "where indexname = 'messages_conversation_client_message_id_idx';",
        ),
      ).toBe("0");
      expect(messageCount(CONVERSATION)).toBe(before);
    });
  },
);
