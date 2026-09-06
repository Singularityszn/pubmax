// Effective PostgreSQL proof for 0152 (messaging channel ownership).
//
// THE CLAIM UNDER TEST. 0148 admits an account to `live:inbox:<handle>` and
// `live:messages:<conversation>` through ONE question, `rls_owns_handle`, and
// that question rested on ONE column: `public.profiles.user_id`. A profile the
// identity store already binds to an account, but which nothing stamped, was
// refused BOTH channels - the account's own inbox and its own thread. 0152
// gives the question a second authority, `public.private_social_accounts`,
// backfills the stamp where that authority resolves one, and repairs the stamp
// on the claim path. What must survive all of that is the F-1 boundary: a
// stranger, an unowned handle and the anon key are still refused.
//
// WHY IT IS PROVED HERE. Nothing about a Realtime channel join is in our code -
// it is the policy, the helper and the caller's own role. A browser test would
// prove the client flag and nothing about who is let in. This runs the same
// predicate, as the same role, over the same rows, on a real PostgreSQL 16,
// with `realtime.messages` and `realtime.topic()` from
// scripts/rls/session-fixture.sql standing in for the platform exactly as they
// do for `auth.users` and `storage.objects`.
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
const FORWARD_NAME = "20260906110000_0152_messaging_channel_ownership.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20260906110000_0152_messaging_channel_ownership_rollback.sql",
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

// SAM is the ordinary case: a claimed handle, stamped from its first instant.
// UNA is the finding: her profile row carries NO user_id, and the identity
// store is the only place that says the row is hers.
// MAL is the stranger who read a handle off the public directory.
// GHOST left: her social row still names her and her profile is tombstoned.
// DOUBLE already owns a profile of his own, so a second row the identity store
// names for him is an inconsistent pair that may never speak.
const SAM = "44444444-0000-4000-8000-000000000001";
const UNA = "44444444-0000-4000-8000-000000000002";
const MAL = "44444444-0000-4000-8000-000000000003";
const GHOST = "44444444-0000-4000-8000-000000000004";
const DOUBLE = "44444444-0000-4000-8000-000000000005";

const UNA_PROFILE = "55555555-0000-4000-8000-000000000002";
const GHOST_PROFILE = "55555555-0000-4000-8000-000000000004";
const DOUBLE_SPARE_PROFILE = "55555555-0000-4000-8000-000000000006";

// sam and una share a thread. mal is in one of her own with a handle nobody owns.
const THREAD = "66666666-0000-4000-8000-000000000001";
const OTHER_THREAD = "66666666-0000-4000-8000-000000000002";
const AT = "2026-09-06 11:00:00+01";

/**
 * What Realtime does on a private-channel join, run as the caller's own role:
 * name the topic, name the JWT, and see whether the broadcast row is readable.
 * 1 is admitted, 0 is refused.
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

/** The stamp on one profile, or the word `null` when it has none. */
function stampFor(profileId: string): string {
  return requireDatabase().sql(
    `select coalesce(user_id::text, 'null') from public.profiles where id = '${profileId}'::uuid;`,
  );
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startPostgres({
    label: "dm-ownership",
    database: "pubmax_dm_ownership",
  });
  const session = requireDatabase();
  session.applyFile(SESSION_FIXTURE);
  for (const path of PREREQUISITES) session.applyFile(path);

  session.sql(
    [
      `insert into auth.users (id, created_at) values`,
      `  ('${SAM}'::uuid, '${AT}'), ('${UNA}'::uuid, '${AT}'), ('${MAL}'::uuid, '${AT}'),`,
      `  ('${GHOST}'::uuid, '${AT}'), ('${DOUBLE}'::uuid, '${AT}');`,
      // sam, mal and double carry the ordinary stamp. una and ghost do not.
      `insert into public.profiles (id, user_id, handle, created_at, updated_at) values`,
      `  ('55555555-0000-4000-8000-000000000001'::uuid, '${SAM}'::uuid, 'sam', '${AT}', '${AT}'),`,
      `  ('${UNA_PROFILE}'::uuid, null, 'una', '${AT}', '${AT}'),`,
      `  ('55555555-0000-4000-8000-000000000003'::uuid, '${MAL}'::uuid, 'mal', '${AT}', '${AT}'),`,
      `  ('${GHOST_PROFILE}'::uuid, null, 'ghost', '${AT}', '${AT}'),`,
      `  ('55555555-0000-4000-8000-000000000005'::uuid, '${DOUBLE}'::uuid, 'double', '${AT}', '${AT}'),`,
      `  ('${DOUBLE_SPARE_PROFILE}'::uuid, null, 'spare', '${AT}', '${AT}');`,
      // The departed account's profile is tombstoned, exactly as the trigger
      // leaves one: the stamp gone, the row and the handle kept.
      `update public.profiles set tombstoned_at = '${AT}' where id = '${GHOST_PROFILE}'::uuid;`,
      // The identity store: one row binding an account to a profile. una's is
      // the row the finding is about; ghost's outlived her; double's names a
      // second profile for an account that already owns one.
      `insert into public.private_social_accounts (clerk_user_id, supabase_user_id, profile_id) values`,
      `  ('supabase:${UNA}', '${UNA}'::uuid, '${UNA_PROFILE}'::uuid),`,
      `  ('supabase:${GHOST}', '${GHOST}'::uuid, '${GHOST_PROFILE}'::uuid),`,
      `  ('supabase:${DOUBLE}', '${DOUBLE}'::uuid, '${DOUBLE_SPARE_PROFILE}'::uuid);`,
      // Handles are stored in lexicographic order (0019), so sam < una holds.
      `insert into public.conversations (id, handle_a, handle_b, created_at, last_message_at)`,
      `  values ('${THREAD}'::uuid, 'sam', 'una', '${AT}', '${AT}'),`,
      `         ('${OTHER_THREAD}'::uuid, 'jen', 'mal', '${AT}', '${AT}');`,
      // ONE broadcast row stands in for the signal on the wire. Its own topic
      // never matters: the policy reads realtime.topic(), which Realtime sets.
      `insert into realtime.messages (topic, extension, event, private, inserted_at)`,
      `  values ('live', 'broadcast', 'message', true, '${AT}');`,
    ].join("\n"),
  );
}, 180_000);

afterAll(async () => {
  await database?.stop();
  database = null;
});

describe.skipIf(skipReason !== null)("0152 messaging channel ownership", () => {
  // ── the fault, on the tree as it stands ───────────────────────────────────
  it("BEFORE the migration an account the identity store names is refused BOTH its channels", () => {
    // The stamp is the only thing missing. Nothing else about una is unusual:
    // she has a handle, a live profile row and a conversation she opened.
    expect(stampFor(UNA_PROFILE)).toBe("null");
    expect(joinsTopic(inboxTopic("una"), UNA)).toBe(0);
    expect(joinsTopic(threadTopic(THREAD), UNA)).toBe(0);
    // And the stamped account beside her is admitted, so the lane itself works.
    expect(joinsTopic(inboxTopic("sam"), SAM)).toBe(1);
    expect(joinsTopic(threadTopic(THREAD), SAM)).toBe(1);
  });

  it("BEFORE the migration she cannot even re-claim the handle she already holds", () => {
    const said = requireDatabase().sql(
      `select public.claim_pubmaxx_handle('${UNA}'::uuid, 'una')->>'code';`,
    );
    expect(said).toBe("taken");
  });

  // ── the migration ─────────────────────────────────────────────────────────
  it("applies cleanly and stamps exactly the rows the identity store resolves", () => {
    const session = requireDatabase();
    session.applyFile(FORWARD);

    // una's row is stamped, because her account owns no other profile.
    expect(stampFor(UNA_PROFILE)).toBe(UNA);
    // The departed account's row is NOT: a tombstone is not an owner.
    expect(stampFor(GHOST_PROFILE)).toBe("null");
    // Nor is the second row of an account that already holds one; the partial
    // unique index on `user_id` says the same thing, and the predicate says it
    // before the index has to.
    expect(stampFor(DOUBLE_SPARE_PROFILE)).toBe("null");
  });

  it("is idempotent, so a re-run of the apply list changes nothing", () => {
    const session = requireDatabase();
    session.applyFile(FORWARD);
    expect(stampFor(UNA_PROFILE)).toBe(UNA);
    expect(stampFor(GHOST_PROFILE)).toBe("null");
    expect(
      session.sql(
        "select count(*)::int from pg_policies " +
          "where schemaname = 'realtime' and tablename = 'messages';",
      ),
    ).toBe("1");
  });

  // ── THE FIX ───────────────────────────────────────────────────────────────
  it("ADMITS the owner to her own inbox AND her own thread channel", () => {
    expect(joinsTopic(inboxTopic("una"), UNA)).toBe(1);
    expect(joinsTopic(threadTopic(THREAD), UNA)).toBe(1);
  });

  it("leaves the already-stamped account exactly as it was", () => {
    expect(joinsTopic(inboxTopic("sam"), SAM)).toBe(1);
    expect(joinsTopic(threadTopic(THREAD), SAM)).toBe(1);
  });

  it("still admits the owner after a rename, through the alias table", () => {
    const session = requireDatabase();
    session.sql(
      `insert into public.profile_handle_aliases (profile_id, handle) ` +
        `values ('${UNA_PROFILE}'::uuid, 'una_old') on conflict do nothing;`,
    );
    expect(joinsTopic(inboxTopic("una_old"), UNA)).toBe(1);
  });

  // ── THE BOUNDARY, WHICH MAY NOT MOVE ──────────────────────────────────────
  it("REFUSES a stranger every channel of an account they merely named", () => {
    expect(joinsTopic(inboxTopic("una"), MAL)).toBe(0);
    expect(joinsTopic(inboxTopic("sam"), MAL)).toBe(0);
    expect(joinsTopic(threadTopic(THREAD), MAL)).toBe(0);
    // Case and padding are not a way around the row read.
    expect(joinsTopic(inboxTopic("UNA"), MAL)).toBe(0);
    expect(joinsTopic(inboxTopic("una "), MAL)).toBe(0);
  });

  it("refuses the anon role every channel, however it names the topic", () => {
    expect(joinsTopic(inboxTopic("una"), UNA, "anon")).toBe(0);
    expect(joinsTopic(threadTopic(THREAD), UNA, "anon")).toBe(0);
    expect(joinsTopic(inboxTopic("una"), null, "anon")).toBe(0);
  });

  it("refuses an authenticated caller with no account behind the JWT", () => {
    expect(joinsTopic(inboxTopic("una"), null)).toBe(0);
    expect(joinsTopic(inboxTopic("una"), "77777777-0000-4000-8000-000000000009")).toBe(0);
  });

  it("gives a departed account nothing, though its identity row still names it", () => {
    expect(joinsTopic(inboxTopic("ghost"), GHOST)).toBe(0);
    expect(joinsTopic(threadTopic(THREAD), GHOST)).toBe(0);
  });

  it("gives an account that already owns a profile nothing on a second one", () => {
    expect(joinsTopic(inboxTopic("spare"), DOUBLE)).toBe(0);
    // Its own handle is unaffected.
    expect(joinsTopic(inboxTopic("double"), DOUBLE)).toBe(1);
  });

  it("leaves an unowned handle unreachable by everybody", () => {
    // `jen` has no profile row at all: nobody may hold her inbox or her thread.
    for (const uid of [SAM, UNA, MAL, DOUBLE]) {
      expect(joinsTopic(inboxTopic("jen"), uid)).toBe(0);
    }
    expect(joinsTopic(threadTopic(OTHER_THREAD), UNA)).toBe(0);
    expect(joinsTopic(threadTopic(OTHER_THREAD), SAM)).toBe(0);
    // mal really is in that one, so the thread branch still works both ways.
    expect(joinsTopic(threadTopic(OTHER_THREAD), MAL)).toBe(1);
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
          `set local request.jwt.claims = '{"sub":"${UNA}","role":"authenticated"}';`,
          "set local role authenticated;",
          "select count(*) from realtime.messages;",
          "commit;",
        ].join("\n"),
      );
      expect({ topic, ok: outcome.ok }).toEqual({ topic, ok: true });
      expect(joinsTopic(topic, UNA)).toBe(0);
    }
  });

  // ── the helper stays where the policies read it ───────────────────────────
  it("redefines the helper in pubmax_private, never a copy in public", () => {
    const session = requireDatabase();
    expect(
      session.sql(
        "select string_agg(n.nspname, ',' order by n.nspname) " +
          "from pg_proc p join pg_namespace n on n.oid = p.pronamespace " +
          "where p.proname = 'rls_owns_handle';",
      ),
    ).toBe("pubmax_private");
  });

  it("keeps the conversation helper delegating rather than growing a second copy", () => {
    const session = requireDatabase();
    const body = session.sql(
      "select pg_get_functiondef(p.oid) " +
        "from pg_proc p join pg_namespace n on n.oid = p.pronamespace " +
        "where n.nspname = 'pubmax_private' " +
        "  and p.proname = 'rls_is_conversation_participant';",
    );
    expect(body).toContain("rls_owns_handle(c.handle_a)");
    expect(body).toContain("rls_owns_handle(c.handle_b)");
    // One place decides what owning a handle means.
    expect(body).not.toContain("private_social_accounts");
  });

  // ── the claim path repairs its own stamp ──────────────────────────────────
  it("lets an account whose stamp was missing re-claim its own handle", () => {
    const session = requireDatabase();
    // Take the stamp off again, exactly as a deletion's ON DELETE SET NULL
    // would, and leave the identity store's row naming her.
    session.sql(
      `update public.profiles set user_id = null where id = '${UNA_PROFILE}'::uuid;`,
    );
    expect(stampFor(UNA_PROFILE)).toBe("null");

    const said = session.sql(
      `select public.claim_pubmaxx_handle('${UNA}'::uuid, 'una')->>'ok';`,
    );
    expect(said).toBe("true");
    expect(stampFor(UNA_PROFILE)).toBe(UNA);
  });

  it("still refuses a claim on a handle the caller does not own", () => {
    const session = requireDatabase();
    expect(
      session.sql(`select public.claim_pubmaxx_handle('${MAL}'::uuid, 'una')->>'code';`),
    ).toBe("already_has_handle");
    // An account with no profile at all may not inherit somebody else's row.
    expect(
      session.sql(
        `select public.claim_pubmaxx_handle('77777777-0000-4000-8000-000000000009'::uuid, 'una')` +
          `->>'code';`,
      ),
    ).toBe("taken");
  });

  // ── the way back out ──────────────────────────────────────────────────────
  it("rolls back to the single-column helper, and says what that costs", () => {
    const session = requireDatabase();
    session.applyFile(ROLLBACK);

    // The stamp the backfill wrote is NOT reversed, so una keeps her channels.
    expect(stampFor(UNA_PROFILE)).toBe(UNA);
    expect(joinsTopic(inboxTopic("una"), UNA)).toBe(1);
    expect(joinsTopic(threadTopic(THREAD), UNA)).toBe(1);

    // The second authority is gone: a row the backfill could not stamp is
    // refused again, which is the pre-0152 behaviour and fails closed.
    expect(joinsTopic(inboxTopic("spare"), DOUBLE)).toBe(0);
    expect(
      session.sql(
        "select pg_get_functiondef(p.oid) like '%private_social_accounts%' " +
          "from pg_proc p join pg_namespace n on n.oid = p.pronamespace " +
          "where n.nspname = 'pubmax_private' and p.proname = 'rls_owns_handle';",
      ),
    ).toBe("f");

    // And the boundary is exactly where it was.
    expect(joinsTopic(inboxTopic("una"), MAL)).toBe(0);
    expect(joinsTopic(inboxTopic("una"), UNA, "anon")).toBe(0);
  });

  it("rolls the claim path back to refusing the repair", () => {
    const session = requireDatabase();
    session.sql(
      `update public.profiles set user_id = null where id = '${UNA_PROFILE}'::uuid;`,
    );
    expect(
      session.sql(`select public.claim_pubmaxx_handle('${UNA}'::uuid, 'una')->>'code';`),
    ).toBe("taken");
    // Nothing was lost by the refusal: the row and the handle are still there.
    expect(
      session.sql(`select handle from public.profiles where id = '${UNA_PROFILE}'::uuid;`),
    ).toBe("una");
  });
});
