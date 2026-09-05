// Effective PostgreSQL proof for 0148 (adversarial review F-1).
//
// THE CLAIM UNDER TEST is not "the SQL parses". It is that a real server
// holding every migration before this one lets ANY authenticated account read
// the messaging channels, that 0148 narrows that to the account which owns the
// handle and the participants of the conversation, and that the rollback gives
// the policy back without leaving a half-installed one behind.
//
// WHY THIS IS THE RIGHT PLACE TO PROVE IT. Supabase Realtime authorises a
// PRIVATE channel by running the caller's own JWT against the RLS policies on
// `realtime.messages`, with `realtime.topic()` naming the channel. Nothing
// about that check is in our code - it is the policy, the helper and the
// caller's role - so a browser test would prove the client flag and nothing
// about who is actually let in. This runs the same predicate, as the same
// role, over the same rows, on a real PostgreSQL 16.
//
// `realtime.messages` and `realtime.topic()` come from
// scripts/rls/session-fixture.sql, which stands in for the platform exactly as
// it already does for auth.users and storage.objects.
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

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20260905180000_0148_messaging_realtime_authorization.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20260905180000_0148_messaging_realtime_authorization_rollback.sql",
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

// Three accounts. Ken and Sam share a conversation; Mallory is the stranger
// holding nothing but a public key and a handle she read off the directory.
const KEN = "11111111-0000-4000-8000-000000000001";
const SAM = "11111111-0000-4000-8000-000000000002";
const MALLORY = "11111111-0000-4000-8000-000000000003";
const CONVERSATION = "22222222-0000-4000-8000-000000000001";
const OTHER_CONVERSATION = "22222222-0000-4000-8000-000000000002";
const AT = "2026-09-05 22:40:00+01";

/**
 * What Realtime does on a private-channel join, run as the caller's own role:
 * name the topic, name the JWT, and see whether the broadcast row is readable.
 * Answers the number of rows the role can see - 1 is admitted, 0 is refused.
 */
function joinsTopic(topic: string, userId: string | null, role = "authenticated"): number {
  const claims =
    userId === null
      ? "set local request.jwt.claims = '{}';"
      : `set local request.jwt.claims = '{"sub":"${userId}","role":"${role}"}';`;
  const said = requireDatabase().sql(
    [
      "begin;",
      `set local realtime.topic = '${topic}';`,
      claims,
      `set local role ${role};`,
      "select count(*)::int from realtime.messages where extension = 'broadcast';",
      "commit;",
    ].join("\n"),
  );
  const digits = said
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line));
  return Number(digits[digits.length - 1] ?? "-1");
}

function inboxTopic(handle: string): string {
  return `live:inbox:${handle}`;
}

function threadTopic(conversationId: string): string {
  return `live:messages:${conversationId}`;
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startPostgres({ label: "dm-realtime", database: "pubmax_dm_realtime" });
  const session = requireDatabase();
  session.applyFile(SESSION_FIXTURE);
  for (const path of PREREQUISITES) session.applyFile(path);

  // Three accounts, two of them in one conversation.
  session.sql(
    [
      `insert into auth.users (id, created_at) values`,
      `  ('${KEN}'::uuid, '${AT}'), ('${SAM}'::uuid, '${AT}'), ('${MALLORY}'::uuid, '${AT}');`,
      `insert into public.profiles (user_id, handle, created_at, updated_at) values`,
      `  ('${KEN}'::uuid, 'ken', '${AT}', '${AT}'),`,
      `  ('${SAM}'::uuid, 'sam', '${AT}', '${AT}'),`,
      `  ('${MALLORY}'::uuid, 'mallory', '${AT}', '${AT}');`,
      `insert into public.conversations (id, handle_a, handle_b, created_at, last_message_at)`,
      `  values ('${CONVERSATION}'::uuid, 'ken', 'sam', '${AT}', '${AT}'),`,
      `         ('${OTHER_CONVERSATION}'::uuid, 'jen', 'mallory', '${AT}', '${AT}');`,
      // ONE broadcast row stands in for the signal on the wire. Its topic never
      // matters: the policy reads realtime.topic(), which is what Realtime sets.
      `insert into realtime.messages (topic, extension, event, private, inserted_at)`,
      `  values ('live', 'broadcast', 'message', true, '${AT}');`,
    ].join("\n"),
  );
}, 180_000);

afterAll(async () => {
  await database?.stop();
  database = null;
});

describe.skipIf(skipReason !== null || process.env.PUBMAX_MESSAGING_REALTIME_NO_PG === "1")(
  "0148 messaging realtime authorization",
  () => {
    it("BEFORE the migration there is no policy for these channels at all", () => {
      const session = requireDatabase();
      expect(
        session.sql(
          "select count(*)::int from pg_policies where schemaname = 'realtime' and tablename = 'messages';",
        ),
      ).toBe("0");
      // The helper the policy will read does not exist yet either.
      expect(
        session.sql(
          "select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace " +
            "where n.nspname = 'pubmax_private' and p.proname = 'rls_may_read_messaging_topic';",
        ),
      ).toBe("0");
    });

    it("applies cleanly and installs ONE policy plus the predicate it reads", () => {
      const session = requireDatabase();
      session.applyFile(FORWARD);

      expect(
        session.sql(
          "select policyname from pg_policies where schemaname = 'realtime' and tablename = 'messages';",
        ),
      ).toBe("pubmax_messaging_topics_read");
      expect(
        session.sql(
          "select cmd from pg_policies where policyname = 'pubmax_messaging_topics_read';",
        ),
      ).toBe("SELECT");
      // In pubmax_private, where the policies read it - never a copy in public,
      // which is the hole 0144 was.
      expect(
        session.sql(
          "select n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace " +
            "where p.proname = 'rls_may_read_messaging_topic';",
        ),
      ).toBe("pubmax_private");
    });

    it("is idempotent, so a re-run of the apply list changes nothing", () => {
      const session = requireDatabase();
      session.applyFile(FORWARD);
      expect(
        session.sql(
          "select count(*)::int from pg_policies where schemaname = 'realtime' and tablename = 'messages';",
        ),
      ).toBe("1");
    });

    // ── THE FINDING ─────────────────────────────────────────────────────────
    it("REFUSES a stranger the inbox channel of a handle they merely read off the directory", () => {
      expect(joinsTopic(inboxTopic("ken"), MALLORY)).toBe(0);
      expect(joinsTopic(inboxTopic("sam"), MALLORY)).toBe(0);
    });

    it("admits an account to its OWN inbox channel", () => {
      expect(joinsTopic(inboxTopic("ken"), KEN)).toBe(1);
      expect(joinsTopic(inboxTopic("sam"), SAM)).toBe(1);
    });

    it("refuses the anon role every channel, however it names the topic", () => {
      expect(joinsTopic(inboxTopic("ken"), KEN, "anon")).toBe(0);
      expect(joinsTopic(inboxTopic("ken"), null, "anon")).toBe(0);
      expect(joinsTopic(threadTopic(CONVERSATION), KEN, "anon")).toBe(0);
    });

    it("refuses an authenticated caller with no account behind the JWT", () => {
      expect(joinsTopic(inboxTopic("ken"), null)).toBe(0);
      expect(joinsTopic(inboxTopic("ken"), "33333333-0000-4000-8000-000000000009")).toBe(0);
    });

    it("admits BOTH participants to a conversation's thread channel, and nobody else", () => {
      expect(joinsTopic(threadTopic(CONVERSATION), KEN)).toBe(1);
      expect(joinsTopic(threadTopic(CONVERSATION), SAM)).toBe(1);
      expect(joinsTopic(threadTopic(CONVERSATION), MALLORY)).toBe(0);
    });

    it("does not leak one conversation's channel to a member of another", () => {
      expect(joinsTopic(threadTopic(OTHER_CONVERSATION), MALLORY)).toBe(1);
      expect(joinsTopic(threadTopic(OTHER_CONVERSATION), KEN)).toBe(0);
    });

    it("answers false, never an error, for a topic that is not one of ours", async () => {
      const session = requireDatabase();
      for (const topic of [
        "live:messages:not-a-uuid",
        "live:messages:",
        "live:inbox:",
        "live:inbox",
        "some:other:channel",
        "",
      ]) {
        const outcome = await session.attempt(
          [
            "begin;",
            `set local realtime.topic = '${topic}';`,
            `set local request.jwt.claims = '{"sub":"${KEN}","role":"authenticated"}';`,
            "set local role authenticated;",
            "select count(*) from realtime.messages;",
            "commit;",
          ].join("\n"),
        );
        expect({ topic, ok: outcome.ok }).toEqual({ topic, ok: true });
        expect(joinsTopic(topic, KEN)).toBe(0);
      }
    });

    it("a handle a stranger claims but does not own buys nothing", () => {
      // The predicate reads the profile row, not the topic text.
      expect(joinsTopic(inboxTopic("KEN"), MALLORY)).toBe(0);
      expect(joinsTopic(inboxTopic("ken "), MALLORY)).toBe(0);
    });

    it("still admits the owner after a handle RENAME through the alias table", () => {
      const session = requireDatabase();
      const aliasTable = session.sql(
        "select to_regclass('public.profile_handle_aliases')::text;",
      );
      if (aliasTable !== "public.profile_handle_aliases") return;
      session.sql(
        `insert into public.profile_handle_aliases (profile_id, handle) ` +
          `select id, 'ken_old' from public.profiles where user_id = '${KEN}'::uuid;`,
      );
      expect(joinsTopic(inboxTopic("ken_old"), KEN)).toBe(1);
      expect(joinsTopic(inboxTopic("ken_old"), MALLORY)).toBe(0);
    });

    it("never grants a browser role EXECUTE on the predicate outside the policy", () => {
      const session = requireDatabase();
      expect(
        session.sql(
          "select has_function_privilege('anon', 'pubmax_private.rls_may_read_messaging_topic(text)', 'execute');",
        ),
      ).toBe("f");
      expect(
        session.sql(
          "select has_function_privilege('authenticated', 'pubmax_private.rls_may_read_messaging_topic(text)', 'execute');",
        ),
      ).toBe("t");
    });

    it("the ROLLBACK takes the policy and the predicate away together", () => {
      const session = requireDatabase();
      session.applyFile(ROLLBACK);
      expect(
        session.sql(
          "select count(*)::int from pg_policies where schemaname = 'realtime' and tablename = 'messages';",
        ),
      ).toBe("0");
      expect(
        session.sql(
          "select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace " +
            "where n.nspname = 'pubmax_private' and p.proname = 'rls_may_read_messaging_topic';",
        ),
      ).toBe("0");
      // With RLS on and no policy, every private join is refused. That is the
      // SAFE failure the rollback file warns about: polling, never a public
      // channel.
      expect(joinsTopic(inboxTopic("ken"), KEN)).toBe(0);
    });
  },
);
