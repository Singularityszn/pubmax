// `public.account_has_password`, proved on a cluster holding every migration.
//
// The sign-in surfaces (`lib/handlePasswordSignIn.ts`, `lib/passwordPrompt.ts`)
// ask the service-role client one question: does this account have a password?
// The answer must be a plain yes or no read off `auth.users`, never the hash,
// and no browser role may ask it, not even about its own account, because the
// answer for an arbitrary id would tell a stranger how an account signs in.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asBrowserRole,
  asServiceRole,
  postgresSkipReason,
  startMigratedPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const WITH_PASSWORD = "a0000000-0000-4000-8000-000000000001";
const NULL_PASSWORD = "b0000000-0000-4000-8000-000000000002";
const BLANK_PASSWORD = "c0000000-0000-4000-8000-000000000003";
const UNKNOWN = "d0000000-0000-4000-8000-0000000000ff";
const HASH = "$2a$10$abcdefghijklmnopqrstuuJ0r9Yq7a2l1oYb3hQ0tq6Qm3cZbQx1e";

let session: PostgresSession | null = null;

function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL password session did not start.");
  return session;
}

function hasPassword(userId: string | null): string {
  return `select public.account_has_password(${userId === null ? "null" : `'${userId}'`})`;
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startMigratedPostgres({
    label: "has-password",
    database: "pubmax_has_password",
  });
  db().sql(`
    insert into auth.users (id, encrypted_password) values
      ('${WITH_PASSWORD}', '${HASH}'),
      ('${NULL_PASSWORD}', null),
      ('${BLANK_PASSWORD}', '')
  `);
}, 180_000);

afterAll(async () => {
  await session?.stop();
});

describe.skipIf(skipReason !== null)("account_has_password", () => {
  it("answers true only for an account holding a non-empty password hash", () => {
    expect(db().sql(asServiceRole(hasPassword(WITH_PASSWORD)))).toBe("t");
    expect(db().sql(asServiceRole(hasPassword(NULL_PASSWORD)))).toBe("f");
    expect(db().sql(asServiceRole(hasPassword(BLANK_PASSWORD)))).toBe("f");
  });

  it("answers false, not an error, for an unknown or missing id", () => {
    expect(db().sql(asServiceRole(hasPassword(UNKNOWN)))).toBe("f");
    expect(db().sql(asServiceRole(hasPassword(null)))).toBe("f");
  });

  it("returns a boolean and nothing the hash could leak through", () => {
    expect(
      db().sql(`select pg_get_function_result('public.account_has_password(uuid)'::regprocedure)`),
    ).toBe("boolean");
  });

  it("refuses anon and a signed-in account, even asking about itself", async () => {
    for (const [role, sub, target] of [
      ["anon", null, WITH_PASSWORD],
      ["authenticated", WITH_PASSWORD, WITH_PASSWORD],
      ["authenticated", NULL_PASSWORD, WITH_PASSWORD],
    ] as const) {
      const answer = await db().attempt(asBrowserRole(role, sub, hasPassword(target)));
      expect(answer.ok, `${role} must not ask whether an account has a password`).toBe(false);
      expect(answer.said).toMatch(/permission denied for function account_has_password/);
    }
  });
});
