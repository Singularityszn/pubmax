// Effective PostgreSQL proof for 0256 (a handle rename carries its inbox).
//
// THE FAULT. `rename_pubmaxx_handle` (last restated by 0177) wrote only
// `profiles` and `profile_handle_aliases`. Every messaging row names its
// person by handle text, and the app store reads them by the CURRENT handle
// (`lib/messagesStore.ts`, `lib/notificationsStore.ts`). So a rename emptied
// the account's inbox: its direct chats, group seats, chat deletions, poll
// votes, sent messages and notifications all stayed under the old name.
//
// THE PROOF. Apply every migration before 0256 and show a rename leaves each
// lane behind. Apply 0256 and show the rename moves every lane, keeps the
// direct pair in order, moves nobody else's rows, and refuses a handle that
// already has a conversation or a seat. Apply the rollback and show the old
// body is back.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20261122090000_0256_handle_rename_messaging.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(MIGRATIONS, "rollback/20261122090000_0256_handle_rename_messaging_rollback.sql");
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

const SAM = "25600000-0000-4000-8000-000000000001";
const ZED = "25600000-0000-4000-8000-000000000002";
const FAULT = "25600000-0000-4000-8000-000000000003";
const UNA = "25600000-0000-4000-8000-000000000004";
const KIM = "25600000-0000-4000-8000-000000000005";
const AFTER_ROLLBACK = "25600000-0000-4000-8000-000000000006";

type Result = { ok: boolean; code?: string; handle?: string };

let database: PostgresSession | null = null;

function db(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}

function claim(user: string, handle: string): Result {
  return JSON.parse(db().sql(`select public.claim_pubmaxx_handle('${user}', '${handle}')`)) as Result;
}

function rename(user: string, handle: string): Result {
  return JSON.parse(db().sql(`select public.rename_pubmaxx_handle('${user}', '${handle}')`)) as Result;
}

/** One value from a single-row, single-column query. */
function one(query: string): string {
  return db().sql(query);
}

/**
 * Gives `handle` the inbox a real account builds: a chat with `sam` (the
 * pair sorts `sam` first), a chat with `zed` (the handle sorts first), a group
 * it owns with both, a message in each, a chat it deleted, a poll vote and a
 * notification. Returns the conversation ids.
 */
function seedInbox(handle: string): { withSam: string; withZed: string; group: string } {
  const [a1, b1] = ["sam", handle].sort();
  const [a2, b2] = [handle, "zed"].sort();
  const withSam = one(
    `insert into public.conversations (handle_a, handle_b) values ('${a1}', '${b1}') returning id`,
  );
  const withZed = one(
    `insert into public.conversations (handle_a, handle_b) values ('${a2}', '${b2}') returning id`,
  );
  const group = one(
    `insert into public.conversations (kind, title, created_by_handle)
     values ('group', 'Friday', '${handle}') returning id`,
  );
  db().sql(`
    insert into public.conversation_members (conversation_id, handle, role) values
      ('${group}', '${handle}', 'owner'), ('${group}', 'sam', 'member'), ('${group}', 'zed', 'member');
    insert into public.messages (conversation_id, sender_handle, body) values
      ('${withSam}', '${handle}', 'pint at six?'),
      ('${withSam}', 'sam', 'go on then'),
      ('${withZed}', '${handle}', 'you in?'),
      ('${group}', '${handle}', 'who is out tonight');
    insert into public.conversation_deletions (conversation_id, handle) values ('${withZed}', '${handle}');
    insert into public.message_poll_votes (message_id, voter_handle, option_index)
      select id, '${handle}', 1 from public.messages
       where conversation_id = '${group}' and sender_handle = '${handle}';
    insert into public.notifications (recipient_handle, actor_handle, kind) values ('${handle}', 'sam', 'follow');
  `);
  return { withSam, withZed, group };
}

/** How many rows in each lane name `handle`, as `lane=count` pairs. */
function lanesNaming(handle: string): string {
  return one(`
    select concat_ws(',',
      'pairs=' || (select count(*) from public.conversations where '${handle}' in (handle_a, handle_b)),
      'seats=' || (select count(*) from public.conversation_members where handle = '${handle}'),
      'deletions=' || (select count(*) from public.conversation_deletions where handle = '${handle}'),
      'votes=' || (select count(*) from public.message_poll_votes where voter_handle = '${handle}'),
      'sent=' || (select count(*) from public.messages where sender_handle = '${handle}'),
      'notifications=' || (select count(*) from public.notifications where recipient_handle = '${handle}'))
  `);
}

const FULL_INBOX = "pairs=2,seats=1,deletions=1,votes=1,sent=3,notifications=1";
const EMPTY_INBOX = "pairs=0,seats=0,deletions=0,votes=0,sent=0,notifications=0";

function pairOf(conversationId: string): string {
  return one(`select handle_a || '|' || handle_b from public.conversations where id = '${conversationId}'`);
}

beforeAll(async () => {
  database = await startPostgres({ label: "handle-rename-messaging-0256" });
  database.applyFile(SESSION_FIXTURE);
  for (const migration of PREREQUISITES) database.applyFile(migration);
  for (const id of [SAM, ZED, FAULT, UNA, KIM, AFTER_ROLLBACK]) {
    database.sql(`insert into auth.users(id) values ('${id}');`);
  }
  for (const [user, handle] of [
    [SAM, "sam"],
    [ZED, "zed"],
    [FAULT, "fault_old"],
    [UNA, "una_old"],
    [KIM, "kim"],
    [AFTER_ROLLBACK, "rolled_old"],
  ] as const) {
    expect(claim(user, handle)).toMatchObject({ ok: true });
  }
}, 180_000);

afterAll(async () => database?.stop());

describe.skipIf(skipReason !== null)("0256 a handle rename carries its inbox", () => {
  it("reproduces the fault: before 0256 every messaging lane stays under the old handle", () => {
    seedInbox("fault_old");
    expect(rename(FAULT, "fault_new")).toMatchObject({ ok: true, handle: "fault_new" });
    expect(lanesNaming("fault_old")).toBe(FULL_INBOX);
    expect(lanesNaming("fault_new")).toBe(EMPTY_INBOX);
  });

  it("after 0256 the rename moves every lane to the new handle", () => {
    db().applyFile(FORWARD);
    const inbox = seedInbox("una_old");
    expect(rename(UNA, "nina")).toMatchObject({ ok: true, handle: "nina" });
    expect(lanesNaming("una_old")).toBe(EMPTY_INBOX);
    expect(lanesNaming("nina")).toBe(FULL_INBOX);
    // `conversations_pair_order_chk` holds: the pair with sam flips order, the
    // pair with zed keeps it, and both are still the same conversation.
    expect(pairOf(inbox.withSam)).toBe("nina|sam");
    expect(pairOf(inbox.withZed)).toBe("nina|zed");
    expect(one(`select role from public.conversation_members where conversation_id = '${inbox.group}' and handle = 'nina'`)).toBe(
      "owner",
    );
    // The message keeps its author identity.
    expect(
      one(`select count(*) from public.messages m join public.profiles p on p.id = m.sender_profile_id
           where m.sender_handle = 'nina' and p.user_id = '${UNA}'`),
    ).toBe("3");
  });

  it("after 0256 nobody else's rows move", () => {
    expect(one(`select count(*) from public.messages where sender_handle = 'sam'`)).toBe("2");
    expect(one(`select count(*) from public.conversation_members where handle in ('sam', 'zed')`)).toBe("4");
    expect(one(`select count(*) from public.notifications where actor_handle = 'sam'`)).toBe("2");
    // The fault account's earlier rename is not rewritten by somebody else's.
    expect(lanesNaming("fault_old")).toBe(FULL_INBOX);
  });

  it("after 0256 a handle that already names a conversation or a seat is taken", () => {
    seedInbox("kim");
    // A conversation row under a handle nobody claimed, left from before the
    // open route checked its recipient. Renaming onto it would collide with
    // kim's own pair with sam and merge two people's histories.
    const stale = one(`insert into public.conversations (handle_a, handle_b) values ('kit', 'sam') returning id`);
    expect(rename(KIM, "kit")).toMatchObject({ ok: false, code: "taken" });
    expect(lanesNaming("kim")).toBe(FULL_INBOX);
    expect(one(`select handle from public.profiles where user_id = '${KIM}'`)).toBe("kim");

    db().sql(`delete from public.conversations where id = '${stale}'`);
    const group = one(`insert into public.conversations (kind) values ('group') returning id`);
    db().sql(`insert into public.conversation_members (conversation_id, handle) values ('${group}', 'kit')`);
    expect(rename(KIM, "kit")).toMatchObject({ ok: false, code: "taken" });
    expect(lanesNaming("kim")).toBe(FULL_INBOX);
    expect(one(`select count(*) from public.profile_handle_aliases where handle = 'kit'`)).toBe("0");
  });

  it("refuses an in-flight open after its checked recipient renames", async () => {
    for (const migration of readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith(".sql") && name > FORWARD_NAME && name <= "20261124090000_0266_messaging_current_handle_guard.sql")
      .sort()) {
      db().applyFile(join(MIGRATIONS, migration));
    }
    const user = "25600000-0000-4000-8000-000000000007";
    db().sql(`insert into auth.users(id) values ('${user}')`);
    expect(claim(user, "race_old")).toMatchObject({ ok: true });
    expect(one(`select handle from public.profiles where handle = 'race_old'`)).toBe("race_old");
    expect(rename(user, "race_new")).toMatchObject({ ok: true });
    const result = await db().attempt(`set role service_role;
      insert into public.conversations (handle_a, handle_b) values ('race_old', 'sam')
      on conflict (handle_a, handle_b) do nothing`);
    expect(result.ok).toBe(false);
    expect(result.said).toContain("23514");
    expect(one(`select count(*) from public.conversations where 'race_old' in (handle_a, handle_b)`)).toBe("0");
  });

  it("guards every messaging lane and still lets a rename carry current writes", async () => {
    const inbox = seedInbox("race_new");
    const message = one(`select id from public.messages where conversation_id = '${inbox.group}' limit 1`);
    const writes = [
      `insert into public.conversation_members (conversation_id, handle) values ('${inbox.group}', 'race_old')`,
      `insert into public.conversation_deletions (conversation_id, handle) values ('${inbox.withSam}', 'race_old')`,
      `insert into public.message_poll_votes (message_id, voter_handle, option_index) values ('${message}', 'RACE_OLD', 0)`,
      `insert into public.messages (conversation_id, sender_handle, body) values ('${inbox.withSam}', 'race_old', 'late')`,
      `insert into public.notifications (recipient_handle, actor_handle, kind) values ('race_old', 'sam', 'follow')`,
      `update public.conversations set handle_a = 'race_old' where id = '${inbox.withSam}'`,
      `update public.conversation_members set handle = 'race_old' where conversation_id = '${inbox.group}' and handle = 'race_new'`,
      `update public.conversation_deletions set handle = 'race_old' where conversation_id = '${inbox.withZed}' and handle = 'race_new'`,
      `update public.message_poll_votes set voter_handle = 'race_old' where message_id = '${message}'`,
      `update public.messages set sender_handle = 'race_old' where id = '${message}'`,
      `update public.notifications set recipient_handle = 'race_old' where recipient_handle = 'race_new'`,
    ];
    for (const write of writes) {
      const result = await db().attempt(`set role service_role; ${write}`);
      expect(result.ok, write).toBe(false);
      expect(result.said, write).toContain("messaging_handle_retired");
    }
    expect(lanesNaming("race_old")).toBe(EMPTY_INBOX);
    db().sql(`update public.profiles set handle_changed_at = null where handle = 'race_new'`);
    expect(rename("25600000-0000-4000-8000-000000000007", "race_final")).toMatchObject({ ok: true });
    expect(lanesNaming("race_new")).toBe(EMPTY_INBOX);
    expect(lanesNaming("race_final")).toBe(FULL_INBOX);
  });

  it("holds the rename's profile lock until an earlier messaging write commits", async () => {
    const user = "25600000-0000-4000-8000-000000000008";
    db().sql(`insert into auth.users(id) values ('${user}')`);
    expect(claim(user, "writer_old")).toMatchObject({ ok: true });
    const writer = spawn(db().psql, [...db().databaseArgs, "-q", "-t", "-A"], { stdio: ["pipe", "pipe", "pipe"] });
    const exited = once(writer, "exit");
    try {
      const ready = Promise.race([
        once(writer.stdout, "data"),
        exited.then(() => { throw new Error("The messaging writer exited before its insert completed."); }),
      ]);
      writer.stdin.write(`begin; set role service_role;
        insert into public.conversations(handle_a, handle_b) values ('sam', 'writer_old');
        select 'writer_ready';\n`);
      const [output] = await ready;
      expect(String(output).trim()).toBe("writer_ready");
      const lock = await db().attempt(`select id from public.profiles where user_id = '${user}' for update nowait`);
      expect(lock.ok).toBe(false);
      expect(lock.said).toContain("55P03");
      writer.stdin.end("commit;\n");
      expect((await exited)[0]).toBe(0);
      expect(rename(user, "writer_new")).toMatchObject({ ok: true });
      expect(one(`select count(*) from public.conversations where 'writer_old' in (handle_a, handle_b)`)).toBe("0");
      expect(one(`select count(*) from public.conversations where 'writer_new' in (handle_a, handle_b)`)).toBe("1");
    } finally {
      writer.stdin.end();
      await exited;
    }
  });

  it("the rollback restores the old body and leaves every row alone", () => {
    db().applyFile(join(MIGRATIONS, "rollback/20261124090000_0266_messaging_current_handle_guard_rollback.sql"));
    expect(one(`insert into public.conversations(handle_a, handle_b) values ('race_old', 'sam') returning handle_a`)).toBe("race_old");
    db().applyFile(ROLLBACK);
    expect(lanesNaming("nina")).toBe(FULL_INBOX);
    seedInbox("rolled_old");
    expect(rename(AFTER_ROLLBACK, "rolled_new")).toMatchObject({ ok: true, handle: "rolled_new" });
    expect(lanesNaming("rolled_old")).toBe(FULL_INBOX);
    expect(lanesNaming("rolled_new")).toBe(EMPTY_INBOX);
  });
});
