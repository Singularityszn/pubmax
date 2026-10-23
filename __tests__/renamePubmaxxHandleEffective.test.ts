// `public.rename_pubmaxx_handle`, proved on a cluster holding every migration.
//
// A handle is how people find and trust an account, so the rename is where
// impersonation would get in. The service-role store
// (`lib/identityHandleStore.ts`) hands the RPC the verified caller's user id and
// the wanted handle; the RPC owns the rules: the format, the reserved names,
// one rename per 30 days, and no handle anybody has ever held, current or
// retired, in any letter case. Two accounts racing for one handle get one
// winner. Only the caller's own profile moves, and no browser role may call it.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asBrowserRole,
  asServiceRole,
  postgresSkipReason,
  startMigratedPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "b0000000-0000-4000-8000-000000000002";
const CAROL = "c0000000-0000-4000-8000-000000000003";
const DAVE = "d0000000-0000-4000-8000-000000000004";
const NO_PROFILE = "e0000000-0000-4000-8000-000000000005";
const ALICE_PROFILE = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const BOB_PROFILE = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";
const CAROL_PROFILE = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const DAVE_PROFILE = "d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4";

let session: PostgresSession | null = null;

function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL handle session did not start.");
  return session;
}

function rename(userId: string | null, handle: string): string {
  const user = userId === null ? "null" : `'${userId}'`;
  return `select public.rename_pubmaxx_handle(${user}, '${handle.replaceAll("'", "''")}')::text`;
}

/** The RPC's answer, parsed. */
function renameAs(userId: string | null, handle: string): Record<string, unknown> {
  return JSON.parse(db().sql(asServiceRole(rename(userId, handle)))) as Record<string, unknown>;
}

function handleOf(profileId: string): string {
  return db().sql(`select handle from public.profiles where id = '${profileId}'`);
}

/** Every alias a profile has held, oldest first: `handle:current`. */
function aliasesOf(profileId: string): string {
  return db().sql(`
    select string_agg(handle || ':' || is_current, ',' order by claimed_at, is_current)
    from public.profile_handle_aliases where profile_id = '${profileId}'
  `);
}

/** Lets a profile rename again, as if its last rename were 31 days ago. */
function endCooldown(profileId: string): void {
  db().sql(`
    update public.profiles set handle_changed_at = now() - interval '31 days'
    where id = '${profileId}'
  `);
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startMigratedPostgres({
    label: "handle-rename",
    database: "pubmax_handle_rename",
  });
  db().sql(`
    insert into auth.users (id) values ('${ALICE}'), ('${BOB}'), ('${CAROL}'), ('${DAVE}'), ('${NO_PROFILE}');
    insert into public.profiles (id, user_id, handle) values
      ('${ALICE_PROFILE}', '${ALICE}', 'alice'),
      ('${BOB_PROFILE}', '${BOB}', 'bob'),
      ('${CAROL_PROFILE}', '${CAROL}', 'carol'),
      ('${DAVE_PROFILE}', '${DAVE}', 'dave');
    insert into public.profile_handle_aliases (profile_id, handle, is_current, claimed_at) values
      ('${ALICE_PROFILE}', 'alice', true, now() - interval '1 day'),
      ('${BOB_PROFILE}', 'bob', true, now() - interval '1 day'),
      ('${CAROL_PROFILE}', 'carol', true, now() - interval '1 day'),
      ('${DAVE_PROFILE}', 'dave', true, now() - interval '1 day');
  `);
}, 180_000);

afterAll(async () => {
  await session?.stop();
});

describe.skipIf(skipReason !== null)("rename_pubmaxx_handle", () => {
  it("refuses a handle outside the format, and a missing user", () => {
    for (const handle of ["ab", "has space", "dot.name", "x".repeat(31), "émile"]) {
      expect(renameAs(ALICE, handle).code, handle).toBe("invalid");
    }
    expect(renameAs(null, "valid_name").code).toBe("invalid");
    expect(handleOf(ALICE_PROFILE)).toBe("alice");
  });

  it("refuses the reserved names in any letter case", () => {
    for (const handle of ["admin", "Support", "PUBMAXX", "pubmaxxing_staff", "pubmaxx_official", "pubmaxxersafety"]) {
      expect(renameAs(ALICE, handle).code, handle).toBe("reserved");
    }
    expect(handleOf(ALICE_PROFILE)).toBe("alice");
  });

  it("answers not_found for an account that never claimed a handle", () => {
    expect(renameAs(NO_PROFILE, "fresh_name").code).toBe("not_found");
    expect(db().sql(`select count(*) from public.profile_handle_aliases where handle = 'fresh_name'`)).toBe(
      "0",
    );
  });

  it("renames the caller's own profile, trimmed and lowercased, and retires the old alias", () => {
    expect(renameAs(ALICE, "  Alice_Two ")).toEqual({
      ok: true,
      profile_id: ALICE_PROFILE,
      previous_handle: "alice",
      handle: "alice_two",
    });
    expect(handleOf(ALICE_PROFILE)).toBe("alice_two");
    expect(aliasesOf(ALICE_PROFILE)).toBe("alice:false,alice_two:true");
    expect(
      db().sql(`
        select retired_at is not null from public.profile_handle_aliases
        where profile_id = '${ALICE_PROFILE}' and handle = 'alice'
      `),
    ).toBe("t");
    // Nobody else moved.
    expect(handleOf(BOB_PROFILE)).toBe("bob");
    expect(aliasesOf(BOB_PROFILE)).toBe("bob:true");
  });

  it("answers ok without a write when the handle is already the caller's", () => {
    const before = db().sql(`select handle_changed_at from public.profiles where id = '${ALICE_PROFILE}'`);
    expect(renameAs(ALICE, "ALICE_TWO")).toMatchObject({ ok: true, handle: "alice_two" });
    expect(db().sql(`select handle_changed_at from public.profiles where id = '${ALICE_PROFILE}'`)).toBe(before);
  });

  it("holds a second rename inside 30 days and names when it opens", () => {
    const answer = renameAs(ALICE, "alice_three");
    expect(answer.code).toBe("cooldown");
    expect(typeof answer.retry_at).toBe("string");
    expect(handleOf(ALICE_PROFILE)).toBe("alice_two");
  });

  it("refuses another account's current handle and a retired one, in any letter case", () => {
    expect(renameAs(BOB, "Alice_Two").code).toBe("taken");
    // `alice` is retired, not free: no account inherits a handle somebody held.
    expect(renameAs(BOB, "ALICE").code).toBe("taken");
    expect(handleOf(BOB_PROFILE)).toBe("bob");
    expect(handleOf(ALICE_PROFILE)).toBe("alice_two");
    expect(aliasesOf(BOB_PROFILE)).toBe("bob:true");
  });

  it("keeps a retired handle taken even for its old owner once the cooldown ends", () => {
    endCooldown(ALICE_PROFILE);
    // A retired alias is taken for everybody, its old owner included.
    expect(renameAs(ALICE, "alice").code).toBe("taken");
    expect(handleOf(ALICE_PROFILE)).toBe("alice_two");
  });

  it("gives one winner when two accounts race for one handle", async () => {
    const answers = await db().concurrentResults([
      asServiceRole(rename(CAROL, "contested")),
      asServiceRole(rename(DAVE, "contested")),
    ]);
    const codes = answers.map((raw) => {
      const answer = JSON.parse(raw) as { ok: boolean; code?: string };
      return answer.ok ? "ok" : answer.code;
    });
    expect([...codes].sort()).toEqual(["ok", "taken"]);
    expect(db().sql(`select count(*) from public.profiles where lower(handle) = 'contested'`)).toBe("1");
    expect(
      db().sql(`select count(*) from public.profile_handle_aliases where lower(handle) = 'contested'`),
    ).toBe("1");
  });

  it("refuses anon and a signed-in account, even renaming itself", async () => {
    for (const [role, sub, target] of [
      ["anon", null, BOB],
      ["authenticated", BOB, BOB],
      ["authenticated", BOB, ALICE],
    ] as const) {
      const answer = await db().attempt(asBrowserRole(role, sub, rename(target, "browser_rename")));
      expect(answer.ok, `${role} must not rename a handle itself`).toBe(false);
      expect(answer.said).toMatch(/permission denied for function rename_pubmaxx_handle/);
    }
    expect(handleOf(BOB_PROFILE)).toBe("bob");
    expect(handleOf(ALICE_PROFILE)).toBe("alice_two");
  });
});
