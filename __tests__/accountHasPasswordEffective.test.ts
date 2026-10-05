// `public.account_has_password`, proved on a cluster holding every migration.
//
// The sign-in surfaces (`lib/handlePasswordSignIn.ts`, `lib/passwordPrompt.ts`)
// ask the service-role client one question: does this account have a password?
// The answer must be a plain yes or no, never the hash, and no browser role may
// ask it, not even about its own account, because the answer for an arbitrary
// id would tell a stranger how an account signs in.
//
// Since 0173 the answer is "a password its OWNER set". GoTrue writes a random
// hash into `auth.users.encrypted_password` when an email-link sign-up creates
// the account, so a non-empty hash alone answered true for every email sign-up
// and the account hub asked them for a current password they never had.

import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asBrowserRole,
  asServiceRole,
  postgresSkipReason,
  startMigratedPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20261005120000_0173_account_password_set.sql",
);
const ROLLBACK = join(
  process.cwd(),
  "supabase/migrations/rollback/20261005120000_0173_account_password_set_rollback.sql",
);

const EMAIL_SIGNUP = "a0000000-0000-4000-8000-000000000001";
const OWNER_SET = "b0000000-0000-4000-8000-000000000002";
const NULL_PASSWORD = "c0000000-0000-4000-8000-000000000003";
const BLANK_PASSWORD = "d0000000-0000-4000-8000-000000000004";
const AUDITED_OWNER = "e0000000-0000-4000-8000-000000000005";
const AUDITED_CLEARED = "f0000000-0000-4000-8000-000000000006";
const LINK_ONLY = "a1000000-0000-4000-8000-000000000007";
const DEPARTING = "b1000000-0000-4000-8000-000000000008";
const UNKNOWN = "d0000000-0000-4000-8000-0000000000ff";
const RANDOM_HASH = "$2a$10$randomrandomrandomrandomuJ0r9Yq7a2l1oYb3hQ0tq6Qm3cZbQx1e";
const CHOSEN_HASH = "$2a$10$chosenchosenchosenchosenuJ0r9Yq7a2l1oYb3hQ0tq6Qm3cZbQx1e";

let session: PostgresSession | null = null;

function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL password session did not start.");
  return session;
}

function hasPassword(userId: string | null): string {
  return asServiceRole(
    `select public.account_has_password(${userId === null ? "null" : `'${userId}'`})`,
  );
}

function auditEntry(id: string, actorId: string, action: string): string {
  return `('${id}', json_build_object('action', '${action}', 'actor_id', '${actorId}', 'log_type', 'user'))`;
}

/** GoTrue's email-link sign-up: the account arrives holding a random hash. */
function signUpByEmailLink(userId: string): void {
  db().sql(`insert into auth.users (id, encrypted_password) values ('${userId}', '${RANDOM_HASH}')`);
}

/** `updateUser({ password })` from the owner's session: GoTrue rewrites the hash. */
function ownerSetsPassword(userId: string, hash = CHOSEN_HASH): void {
  db().sql(`update auth.users set encrypted_password = '${hash}' where id = '${userId}'`);
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startMigratedPostgres({
    label: "has-password",
    database: "pubmax_has_password",
  });
}, 180_000);

afterAll(async () => {
  await session?.stop();
});

describe.skipIf(skipReason !== null)("account_has_password", () => {
  it("answers false for an email-link sign-up, whose hash its owner never chose", () => {
    signUpByEmailLink(EMAIL_SIGNUP);
    expect(db().sql(hasPassword(EMAIL_SIGNUP))).toBe("f");

    // Signing in by link again, or any other change to the row, sets nothing.
    db().sql(`update auth.users set banned_until = null where id = '${EMAIL_SIGNUP}'`);
    db().sql(
      `update auth.users set encrypted_password = encrypted_password where id = '${EMAIL_SIGNUP}'`,
    );
    expect(db().sql(hasPassword(EMAIL_SIGNUP))).toBe("f");
  });

  it("answers true once the owner sets a password, and stays true across a change", () => {
    signUpByEmailLink(OWNER_SET);
    ownerSetsPassword(OWNER_SET);
    expect(db().sql(hasPassword(OWNER_SET))).toBe("t");

    ownerSetsPassword(OWNER_SET, `${CHOSEN_HASH}2`);
    expect(db().sql(hasPassword(OWNER_SET))).toBe("t");
  });

  it("answers false when the hash is gone, whatever was recorded", () => {
    db().sql(`
      insert into auth.users (id, encrypted_password) values
        ('${NULL_PASSWORD}', null),
        ('${BLANK_PASSWORD}', '')
    `);
    expect(db().sql(hasPassword(NULL_PASSWORD))).toBe("f");
    expect(db().sql(hasPassword(BLANK_PASSWORD))).toBe("f");

    ownerSetsPassword(BLANK_PASSWORD);
    db().sql(`update auth.users set encrypted_password = '' where id = '${BLANK_PASSWORD}'`);
    expect(db().sql(hasPassword(BLANK_PASSWORD))).toBe("f");
  });

  it("answers false, not an error, for an unknown or missing id", () => {
    expect(db().sql(hasPassword(UNKNOWN))).toBe("f");
    expect(db().sql(hasPassword(null))).toBe("f");
  });

  it("keeps nothing about a deleted account", () => {
    signUpByEmailLink(DEPARTING);
    ownerSetsPassword(DEPARTING);
    db().sql(`delete from auth.users where id = '${DEPARTING}'`);
    expect(
      db().sql(
        `select count(*) from pubmax_private.account_password_set where user_id = '${DEPARTING}'`,
      ),
    ).toBe("0");
  });

  it("backfills owners GoTrue logged setting a password, and only them", () => {
    db().sql(`
      insert into auth.users (id, encrypted_password) values
        ('${AUDITED_OWNER}', '${CHOSEN_HASH}'),
        ('${AUDITED_CLEARED}', ''),
        ('${LINK_ONLY}', '${RANDOM_HASH}')
    `);
    db().sql(`
      insert into auth.audit_log_entries (id, payload) values
        ${auditEntry("01000000-0000-4000-8000-000000000001", AUDITED_OWNER, "user_signedup")},
        ${auditEntry("01000000-0000-4000-8000-000000000002", AUDITED_OWNER, "user_updated_password")},
        ${auditEntry("01000000-0000-4000-8000-000000000003", AUDITED_CLEARED, "user_updated_password")},
        ${auditEntry("01000000-0000-4000-8000-000000000004", LINK_ONLY, "user_signedup")},
        ${auditEntry("01000000-0000-4000-8000-000000000005", LINK_ONLY, "login")},
        ${auditEntry("01000000-0000-4000-8000-000000000006", LINK_ONLY, "user_recovery_requested")}
    `);
    // A captain may apply it twice, and the second run must change nothing else.
    db().applyFile(MIGRATION);

    expect(db().sql(hasPassword(AUDITED_OWNER))).toBe("t");
    expect(db().sql(hasPassword(AUDITED_CLEARED))).toBe("f");
    expect(db().sql(hasPassword(LINK_ONLY))).toBe("f");
    expect(db().sql(hasPassword(OWNER_SET))).toBe("t");
    expect(db().sql(hasPassword(EMAIL_SIGNUP))).toBe("f");
  });

  it("returns a boolean and nothing the hash could leak through", () => {
    expect(
      db().sql(`select pg_get_function_result('public.account_has_password(uuid)'::regprocedure)`),
    ).toBe("boolean");
  });

  it("refuses anon and a signed-in account, even asking about itself", async () => {
    for (const [role, sub, target] of [
      ["anon", null, OWNER_SET],
      ["authenticated", OWNER_SET, OWNER_SET],
      ["authenticated", EMAIL_SIGNUP, OWNER_SET],
    ] as const) {
      const statement = `select public.account_has_password('${target}')`;
      const answer = await db().attempt(asBrowserRole(role, sub, statement));
      expect(answer.ok, `${role} must not ask whether an account has a password`).toBe(false);
      expect(answer.said).toMatch(/permission denied for function account_has_password/);
    }
  });

  it("lets no browser role read or write the record of who set a password", async () => {
    for (const [role, sub] of [
      ["anon", null],
      ["authenticated", EMAIL_SIGNUP],
    ] as const) {
      for (const statement of [
        "select user_id from pubmax_private.account_password_set",
        `insert into pubmax_private.account_password_set (user_id) values ('${EMAIL_SIGNUP}')`,
        `delete from pubmax_private.account_password_set where user_id = '${OWNER_SET}'`,
      ]) {
        const answer = await db().attempt(asBrowserRole(role, sub, statement));
        expect(answer.ok, `${role} must not touch the password record: ${statement}`).toBe(false);
        expect(answer.said).toMatch(/permission denied/);
      }
    }
    expect(db().sql(hasPassword(EMAIL_SIGNUP))).toBe("f");
    expect(db().sql(hasPassword(OWNER_SET))).toBe("t");
  });

  it("rolls back to the hash-only read, and a re-apply rebuilds the owners", () => {
    db().applyFile(ROLLBACK);
    expect(db().sql(`select to_regclass('pubmax_private.account_password_set') is null`)).toBe("t");
    expect(
      db().sql(
        `select count(*) from pg_trigger where tgname = 'account_password_set_on_auth_user_update'`,
      ),
    ).toBe("0");
    // The fault is back: the email-link sign-up reads as holding a password.
    expect(db().sql(hasPassword(EMAIL_SIGNUP))).toBe("t");

    db().applyFile(MIGRATION);
    expect(db().sql(hasPassword(EMAIL_SIGNUP))).toBe("f");
    expect(db().sql(hasPassword(AUDITED_OWNER))).toBe("t");
  });
});
