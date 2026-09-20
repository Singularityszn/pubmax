// Effective PostgreSQL proof for 0154 and 0155 (group threads, and the three
// new attachment kinds).
//
// THE CLAIMS UNDER TEST are the ones only a real database can answer, because
// they are constraints and a policy rather than code:
//
// 1. A GROUP ROW CAN EXIST AT ALL. 0019 made `handle_a` and `handle_b` NOT
//    NULL, so before 0154 there is no shape a group could take. After it, a
//    group row carries neither handle and a direct row still carries both —
//    which is the per-kind CHECK saying in SQL what
//    `docs/adr/0015-group-message-threads.md` says in words.
//
// 2. A DIRECT CONVERSATION DID NOT MOVE. Nothing is backfilled into the members
//    table, the unique pair still holds, and the participant predicate's direct
//    branch answers exactly as it did — so widening the lane cannot quietly
//    change who may read a 1:1.
//
// 3. THE GROUP BRANCH ADMITS A LIVE MEMBER AND NOBODY ELSE. A stranger, a
//    member who LEFT and the anon key are all refused, and the answer comes
//    from the same predicate 0148's channel policy reads, so a group thread's
//    realtime channel is admitted with no change to that policy.
//
// 4. EACH ATTACHMENT KIND OWNS ITS OWN COLUMNS. A contact row carrying a plan
//    id, a poll with one option and a photo smuggling a handle are each refused
//    by the shape CHECK rather than by the application.
//
// 5. AN ACCOUNT THAT LEAVES TAKES EVERY ATTACHMENT COLUMN WITH IT. Before 0155
//    the tombstone cleared the two columns it knew about; with three more, a
//    departing account would leave `kind` null beside a non-null contact handle
//    and the shape CHECK would fail the whole deletion.
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
const GROUPS_NAME = "20260917090000_0154_group_message_threads.sql";
const KINDS_NAME = "20260917091000_0155_message_attachment_kinds.sql";
const GROUPS = join(MIGRATIONS, GROUPS_NAME);
const KINDS = join(MIGRATIONS, KINDS_NAME);
const GROUPS_ROLLBACK = join(
  MIGRATIONS,
  "rollback/20260917090000_0154_group_message_threads_rollback.sql",
);
const KINDS_ROLLBACK = join(
  MIGRATIONS,
  "rollback/20260917091000_0155_message_attachment_kinds_rollback.sql",
);
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < GROUPS_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

let database: PostgresSession | null = null;

function requireDatabase(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}

// KEN opened the group. SAM and JEN are in it. ALI joined and left.
// MAL is the stranger who read a handle off the public directory.
const KEN = "77777777-0000-4000-8000-000000000001";
const SAM = "77777777-0000-4000-8000-000000000002";
const JEN = "77777777-0000-4000-8000-000000000003";
const ALI = "77777777-0000-4000-8000-000000000004";
const MAL = "77777777-0000-4000-8000-000000000005";

const KEN_PROFILE = "88888888-0000-4000-8000-000000000001";

const DM = "99999999-0000-4000-8000-000000000001";
const GROUP = "99999999-0000-4000-8000-000000000002";
const AT = "2026-09-17 11:00:00+01";

/** What Realtime does on a private-channel join, as the caller's own role. */
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

const threadTopic = (conversationId: string): string => `live:messages:${conversationId}`;

beforeAll(async () => {
  if (skipReason) return;
  database = await startPostgres({
    label: "group-threads",
    database: "pubmax_group_threads",
  });
  const session = requireDatabase();
  session.applyFile(SESSION_FIXTURE);
  for (const path of PREREQUISITES) session.applyFile(path);

  session.sql(
    [
      "insert into auth.users (id, created_at) values",
      `  ('${KEN}'::uuid, '${AT}'), ('${SAM}'::uuid, '${AT}'), ('${JEN}'::uuid, '${AT}'),`,
      `  ('${ALI}'::uuid, '${AT}'), ('${MAL}'::uuid, '${AT}');`,
      "insert into public.profiles (id, user_id, handle, created_at, updated_at) values",
      `  ('${KEN_PROFILE}'::uuid, '${KEN}'::uuid, 'ken', '${AT}', '${AT}'),`,
      `  ('88888888-0000-4000-8000-000000000002'::uuid, '${SAM}'::uuid, 'sam', '${AT}', '${AT}'),`,
      `  ('88888888-0000-4000-8000-000000000003'::uuid, '${JEN}'::uuid, 'jen', '${AT}', '${AT}'),`,
      `  ('88888888-0000-4000-8000-000000000004'::uuid, '${ALI}'::uuid, 'ali', '${AT}', '${AT}'),`,
      `  ('88888888-0000-4000-8000-000000000005'::uuid, '${MAL}'::uuid, 'mal', '${AT}', '${AT}');`,
      // Handles are stored in lexicographic order (0019), so ken < sam holds.
      "insert into public.conversations (id, handle_a, handle_b, created_at, last_message_at)",
      `  values ('${DM}'::uuid, 'ken', 'sam', '${AT}', '${AT}');`,
      "insert into realtime.messages (topic, extension, event, private, inserted_at)",
      `  values ('live', 'broadcast', 'message', true, '${AT}');`,
    ].join("\n"),
  );
}, 240_000);

afterAll(async () => {
  await database?.stop();
  database = null;
});

describe.skipIf(skipReason !== null)("0154 group message threads", () => {
  // ── the fault, on the tree as it stands ───────────────────────────────────
  it("BEFORE the migration there is no shape a group could take", async () => {
    const said = await requireDatabase().attempt(
      `insert into public.conversations (id, handle_a, handle_b, created_at, last_message_at)
         values ('${GROUP}'::uuid, null, null, '${AT}', '${AT}');`,
    );
    expect(said.ok).toBe(false);
    expect(said.said).toMatch(/null value in column "handle_a"|not-null/i);
  });

  // ── the migration ─────────────────────────────────────────────────────────
  it("applies cleanly and admits a group row with no pair", () => {
    const session = requireDatabase();
    session.applyFile(GROUPS);
    session.sql(
      [
        "insert into public.conversations (id, kind, title, created_by_handle, created_at, last_message_at)",
        `  values ('${GROUP}'::uuid, 'group', 'Friday session', 'ken', '${AT}', '${AT}');`,
        "insert into public.conversation_members (conversation_id, handle, role, joined_at) values",
        `  ('${GROUP}'::uuid, 'ken', 'owner', '${AT}'),`,
        `  ('${GROUP}'::uuid, 'sam', 'member', '${AT}'),`,
        `  ('${GROUP}'::uuid, 'jen', 'member', '${AT}'),`,
        `  ('${GROUP}'::uuid, 'ali', 'member', '${AT}');`,
      ].join("\n"),
    );
    expect(
      session.sql(`select kind from public.conversations where id = '${GROUP}'::uuid;`),
    ).toBe("group");
  });

  it("is idempotent, so a re-run of the apply list changes nothing", () => {
    const session = requireDatabase();
    session.applyFile(GROUPS);
    expect(
      session.sql(
        `select count(*)::int from public.conversation_members where conversation_id = '${GROUP}'::uuid;`,
      ),
    ).toBe("4");
  });

  it("holds a seat to the handle alphabet, so one person is one seat", async () => {
    const session = requireDatabase();
    // The primary key compares bytes, so a capitalised handle would be a SECOND
    // seat for the same person that the inbox lane (`handle = me`) then finds
    // only half of.
    const shouted = await session.attempt(
      `insert into public.conversation_members (conversation_id, handle, role, joined_at)
         values ('${GROUP}'::uuid, 'Ken', 'member', '${AT}');`,
    );
    expect(shouted.ok).toBe(false);
    const at = await session.attempt(
      `insert into public.conversation_members (conversation_id, handle, role, joined_at)
         values ('${GROUP}'::uuid, '@ken', 'member', '${AT}');`,
    );
    expect(at.ok).toBe(false);
  });

  it("keeps each kind to its OWN columns", async () => {
    const session = requireDatabase();
    // A direct row still needs both handles.
    const halfPair = await session.attempt(
      `insert into public.conversations (id, kind, handle_a, handle_b, created_at, last_message_at)
         values (gen_random_uuid(), 'direct', 'ken', null, '${AT}', '${AT}');`,
    );
    expect(halfPair.ok).toBe(false);
    // A group row may carry no handle at all.
    const groupWithPair = await session.attempt(
      `insert into public.conversations (id, kind, handle_a, handle_b, created_at, last_message_at)
         values (gen_random_uuid(), 'group', 'ken', 'sam', '${AT}', '${AT}');`,
    );
    expect(groupWithPair.ok).toBe(false);
    // A DM may not grow a title: a 1:1 is called by who it is with.
    const titledDm = await session.attempt(
      `update public.conversations set title = 'nope' where id = '${DM}'::uuid;`,
    );
    expect(titledDm.ok).toBe(false);
    // And the kind itself is a closed set.
    const invented = await session.attempt(
      `insert into public.conversations (id, kind, created_at, last_message_at)
         values (gen_random_uuid(), 'crew', '${AT}', '${AT}');`,
    );
    expect(invented.ok).toBe(false);
  });

  it("NOTHING was backfilled into the members table for a DM", () => {
    // ONE authority per kind is what stops the two drifting: a direct row's
    // membership is its own pair columns and is deliberately not mirrored.
    expect(
      requireDatabase().sql(
        `select count(*)::int from public.conversation_members where conversation_id = '${DM}'::uuid;`,
      ),
    ).toBe("0");
  });

  // ── THE FIX, measured through the predicate 0148's channel policy reads ───
  it("ADMITS every live member of a group to the thread channel", () => {
    expect(joinsTopic(threadTopic(GROUP), KEN)).toBe(1);
    expect(joinsTopic(threadTopic(GROUP), SAM)).toBe(1);
    expect(joinsTopic(threadTopic(GROUP), JEN)).toBe(1);
  });

  it("refuses a stranger and the anon key, exactly as it did for a DM", () => {
    expect(joinsTopic(threadTopic(GROUP), MAL)).toBe(0);
    expect(joinsTopic(threadTopic(GROUP), null)).toBe(0);
    expect(joinsTopic(threadTopic(GROUP), KEN, "anon")).toBe(0);
  });

  it("refuses somebody who LEFT, and keeps the words they wrote", () => {
    const session = requireDatabase();
    expect(joinsTopic(threadTopic(GROUP), ALI)).toBe(1);
    session.sql(
      [
        "insert into public.messages (id, conversation_id, sender_handle, body, created_at)",
        `  values (gen_random_uuid(), '${GROUP}'::uuid, 'ali', 'I am off', '${AT}');`,
        `update public.conversation_members set left_at = '${AT}'
           where conversation_id = '${GROUP}'::uuid and handle = 'ali';`,
      ].join("\n"),
    );
    expect(joinsTopic(threadTopic(GROUP), ALI)).toBe(0);
    expect(
      session.sql(
        `select count(*)::int from public.messages
           where conversation_id = '${GROUP}'::uuid and sender_handle = 'ali';`,
      ),
    ).toBe("1");
  });

  it("leaves the DIRECT branch answering exactly as it did", () => {
    expect(joinsTopic(threadTopic(DM), KEN)).toBe(1);
    expect(joinsTopic(threadTopic(DM), SAM)).toBe(1);
    expect(joinsTopic(threadTopic(DM), MAL)).toBe(0);
    expect(joinsTopic(threadTopic(DM), null)).toBe(0);
  });
});

describe.skipIf(skipReason !== null)("0155 contact, event and poll attachments", () => {
  const message = (columns: string, values: string): string =>
    `insert into public.messages (id, conversation_id, sender_handle, body, created_at${columns})
       values (gen_random_uuid(), '${GROUP}'::uuid, 'ken', '', '${AT}'${values});`;

  it("BEFORE the migration the set is closed at two", async () => {
    const said = await requireDatabase().attempt(
      message(", attachment_kind, attachment_venue_id", ", 'contact', 'venue-1'"),
    );
    expect(said.ok).toBe(false);
  });

  it("applies cleanly and admits each new kind with its OWN columns", () => {
    const session = requireDatabase();
    session.applyFile(KINDS);
    session.sql(message(", attachment_kind, attachment_contact_handle", ", 'contact', 'sam'"));
    session.sql(
      message(
        ", attachment_kind, attachment_plan_id",
        `, 'event', '${DM}'::uuid`,
      ),
    );
    session.sql(
      message(
        ", attachment_kind, attachment_poll_question, attachment_poll_options",
        `, 'poll', 'Where first?', '["The Blackfriar","The Harp"]'::jsonb`,
      ),
    );
    expect(
      session.sql(
        `select count(*)::int from public.messages
           where conversation_id = '${GROUP}'::uuid
             and attachment_kind in ('contact', 'event', 'poll');`,
      ),
    ).toBe("3");
  });

  it("is idempotent, so a re-run of the apply list changes nothing", () => {
    requireDatabase().applyFile(KINDS);
    expect(
      requireDatabase().sql(
        "select count(*)::int from pg_constraint where conname = 'messages_attachment_shape_chk';",
      ),
    ).toBe("1");
  });

  it("refuses a row that carries another kind's column", async () => {
    const session = requireDatabase();
    for (const [columns, values] of [
      [", attachment_kind, attachment_contact_handle, attachment_plan_id", `, 'contact', 'sam', '${DM}'::uuid`],
      [", attachment_kind, attachment_venue_id, attachment_contact_handle", ", 'venue', 'venue-1', 'sam'"],
      [", attachment_kind", ", 'contact'"],
      [", attachment_kind, attachment_contact_handle", ", 'contact', 'Not A Handle'"],
    ] as const) {
      const said = await session.attempt(message(columns, values));
      expect(said.ok, `${columns} ${values}`).toBe(false);
    }
  });

  it("holds a ballot to two options and no more than six", async () => {
    const session = requireDatabase();
    const one = await session.attempt(
      message(
        ", attachment_kind, attachment_poll_question, attachment_poll_options",
        `, 'poll', 'Only one?', '["The Harp"]'::jsonb`,
      ),
    );
    expect(one.ok).toBe(false);
    const seven = await session.attempt(
      message(
        ", attachment_kind, attachment_poll_question, attachment_poll_options",
        `, 'poll', 'Too many?', '["a","b","c","d","e","f","g"]'::jsonb`,
      ),
    );
    expect(seven.ok).toBe(false);
  });

  it("keeps ONE vote per person per poll, and a vote inside the ballot", async () => {
    const session = requireDatabase();
    const poll = session.sql(
      `select id from public.messages
         where conversation_id = '${GROUP}'::uuid and attachment_kind = 'poll' limit 1;`,
    );
    session.sql(
      `insert into public.message_poll_votes (message_id, voter_handle, option_index, created_at, updated_at)
         values ('${poll}'::uuid, 'sam', 0, '${AT}', '${AT}');`,
    );
    const twice = await session.attempt(
      `insert into public.message_poll_votes (message_id, voter_handle, option_index, created_at, updated_at)
         values ('${poll}'::uuid, 'sam', 1, '${AT}', '${AT}');`,
    );
    expect(twice.ok).toBe(false);
    // Re-answering REPLACES, which is what the primary key is for.
    session.sql(
      `insert into public.message_poll_votes (message_id, voter_handle, option_index, created_at, updated_at)
         values ('${poll}'::uuid, 'sam', 1, '${AT}', '${AT}')
         on conflict (message_id, voter_handle) do update set option_index = excluded.option_index;`,
    );
    expect(
      session.sql(
        `select count(*)::int from public.message_poll_votes where message_id = '${poll}'::uuid;`,
      ),
    ).toBe("1");
  });

  it("shows a vote to ITS OWN VOTER and to nobody else, the author included", () => {
    const session = requireDatabase();
    const readsVotes = (userId: string): string =>
      session.sql(
        [
          "begin;",
          `set local request.jwt.claims = '{"sub":"${userId}","role":"authenticated"}';`,
          "set local role authenticated;",
          "select count(*)::int from public.message_poll_votes;",
          "commit;",
        ].join("\n"),
      );
    // SAM cast the vote, so SAM may read it back.
    expect(readsVotes(SAM)).toBe("1");
    // KEN asked the question and is in the thread, and still reads NOTHING:
    // `lib/messagePoll.ts` rule 2 says no voter is named to anybody, and a
    // policy that admitted every participant would leave that rule standing in
    // TypeScript alone while one PostgREST request read the ballot by name.
    expect(readsVotes(KEN)).toBe("0");
    // JEN is in the thread and did not vote.
    expect(readsVotes(JEN)).toBe("0");
    // MAL was never in it.
    expect(readsVotes(MAL)).toBe("0");
  });

  it("refuses an attachment column on a row whose kind says there is none", async () => {
    const session = requireDatabase();
    // The shape CHECK's FIRST arm. Written with `=` it answers NULL on a null
    // kind, and a CHECK that evaluates to NULL passes — so a contact handle, a
    // plan id or a ballot could sit on a row every reader shows as plain words,
    // and the tombstone (which only visits rows whose kind is not null) would
    // never take it away.
    const smuggled = await session.attempt(
      message(", attachment_contact_handle", ", 'sam'"),
    );
    expect(smuggled.ok).toBe(false);
    const planned = await session.attempt(
      message(", attachment_plan_id", `, '${DM}'::uuid`),
    );
    expect(planned.ok).toBe(false);
    // And the same on the way out of a kind, which is what the 0155 rollback
    // does to every contact, event and poll row before dropping the columns.
    const stripped = await session.attempt(
      `update public.messages set attachment_kind = null
         where conversation_id = '${GROUP}'::uuid and attachment_kind = 'contact';`,
    );
    expect(stripped.ok).toBe(false);
  });

  it("takes EVERY attachment column with a departing account", () => {
    const session = requireDatabase();
    // The account that sent the contact, the plan and the poll leaves.
    session.sql(`delete from auth.users where id = '${KEN}'::uuid;`);
    expect(
      session.sql(
        `select count(*)::int from public.messages
           where conversation_id = '${GROUP}'::uuid and attachment_kind is not null;`,
      ),
    ).toBe("0");
    // The words stay, and a message that was ONLY an attachment says so rather
    // than becoming a blank bubble the content CHECK would refuse.
    expect(
      session.sql(
        `select count(*)::int from public.messages
           where conversation_id = '${GROUP}'::uuid and body = 'Attachment removed.';`,
      ),
    ).toBe("3");
    // Their seat ends with the account; the thread keeps their sentences.
    expect(
      session.sql(
        `select count(*)::int from public.conversation_members
           where conversation_id = '${GROUP}'::uuid and handle = 'ken' and left_at is not null;`,
      ),
    ).toBe("1");
  });
});

describe.skipIf(skipReason !== null)("the way back out", () => {
  it("0155 rolls back to the two-kind set and keeps the words", () => {
    const session = requireDatabase();
    // The tombstone above cleared every attachment KEN sent, so the rollback
    // would otherwise run over nothing. A live contact row from an account that
    // is still here is what the captain would actually be rolling back, and it
    // is the row the shape CHECK refuses to let the rollback half-clear.
    session.sql(
      `insert into public.messages (id, conversation_id, sender_handle, body, created_at, attachment_kind, attachment_contact_handle)
         values (gen_random_uuid(), '${GROUP}'::uuid, 'sam', '', '${AT}', 'contact', 'jen');`,
    );
    session.applyFile(KINDS_ROLLBACK);
    // The row that was ONLY an attachment keeps a line rather than a blank
    // bubble the content CHECK would refuse.
    expect(
      session.sql(
        `select count(*)::int from public.messages
           where conversation_id = '${GROUP}'::uuid and sender_handle = 'sam'
             and body = 'Attachment removed.';`,
      ),
    ).toBe("1");
    expect(
      session.sql(
        "select count(*)::int from information_schema.columns " +
          "where table_schema = 'public' and table_name = 'messages' " +
          "and column_name in ('attachment_contact_handle', 'attachment_plan_id', " +
          "'attachment_poll_question', 'attachment_poll_options');",
      ),
    ).toBe("0");
    expect(session.sql("select to_regclass('public.message_poll_votes')::text;")).toBe("");
    expect(
      session.sql(
        `select count(*)::int from public.messages where conversation_id = '${GROUP}'::uuid;`,
      ),
    ).toBe("5");
  });

  it("0154 rolls back to the pair, and says what it cost", () => {
    const session = requireDatabase();
    session.applyFile(GROUPS_ROLLBACK);
    // The group and every word in it went with it; the rollback's own header
    // says so out loud rather than leaving it to a cascade nobody reads.
    expect(session.sql("select to_regclass('public.conversation_members')::text;")).toBe("");
    expect(
      session.sql(
        `select count(*)::int from public.conversations where id = '${GROUP}'::uuid;`,
      ),
    ).toBe("0");
    // The DM is untouched, which is the whole point of one authority per kind.
    expect(
      session.sql(`select count(*)::int from public.conversations where id = '${DM}'::uuid;`),
    ).toBe("1");
    expect(joinsTopic(threadTopic(DM), SAM)).toBe(1);
    expect(joinsTopic(threadTopic(DM), MAL)).toBe(0);
  });
});
