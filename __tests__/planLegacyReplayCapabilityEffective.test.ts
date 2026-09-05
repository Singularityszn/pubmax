// Effective PostgreSQL proof for 0137. The migration changes only the two
// private 0075 helpers behind the public join and invite wrappers. A member
// can therefore move from an anonymous idempotency key K, to account U, and
// then to recovered capability R. An old K request must conflict while R is
// current; rolling back must deliberately restore the old replay behaviour.

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
const FORWARD_NAME = "20260903130000_0137_plan_legacy_replay_capability.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20260903130000_0137_plan_legacy_replay_capability_rollback.sql",
);
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

const HOST_USER = "00000000-0000-4000-8000-0000000000a1";
const ACCOUNT_USER = "00000000-0000-4000-8000-0000000000a2";
const JOIN_PLAN = "00000000-0000-4000-8000-0000000000b1";
const INVITE_PLAN = "00000000-0000-4000-8000-0000000000b2";
const REVOKED_JOIN_PLAN = "00000000-0000-4000-8000-0000000000b3";
const REVOKED_INVITE_PLAN = "00000000-0000-4000-8000-0000000000b4";
const JOIN_HOST_MEMBER = "00000000-0000-4000-8000-0000000000c1";
const JOIN_MEMBER = "00000000-0000-4000-8000-0000000000c2";
const INVITE_HOST_MEMBER = "00000000-0000-4000-8000-0000000000c3";
const INVITE_MEMBER = "00000000-0000-4000-8000-0000000000c4";
const REVOKED_JOIN_HOST_MEMBER = "00000000-0000-4000-8000-0000000000c5";
const REVOKED_JOIN_MEMBER = "00000000-0000-4000-8000-0000000000c6";
const REVOKED_INVITE_HOST_MEMBER = "00000000-0000-4000-8000-0000000000c7";
const REVOKED_INVITE_MEMBER = "00000000-0000-4000-8000-0000000000c8";
const INVITE_ID = "00000000-0000-4000-8000-0000000000d1";
const REVOKED_INVITE_ID = "00000000-0000-4000-8000-0000000000d2";
const WHEN = "2026-09-03 12:00:00+00";

let database: PostgresSession | null = null;

function requireDatabase(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}

function joinPlan(
  db: PostgresSession,
  planId: string,
  memberId: string,
  token: string,
  key: string,
  request: string,
): string {
  return db.sql(`select public.join_plan_idempotent_atomic(
    '${planId}'::uuid,
    '${memberId}'::uuid,
    'Replay guest',
    repeat('${token}', 64),
    '${WHEN}'::timestamptz,
    true,
    repeat('${key}', 64),
    repeat('${request}', 64)
  )`);
}

function redeem(
  db: PostgresSession,
  planId: string,
  memberId: string,
  inviteToken: string,
  memberToken: string,
  key: string,
  request: string,
): string {
  return db.sql(`select public.redeem_plan_invite_idempotent_atomic(
    '${planId}'::uuid,
    repeat('${inviteToken}', 64),
    '${memberId}'::uuid,
    'Replay guest',
    repeat('${memberToken}', 64),
    '${WHEN}'::timestamptz,
    repeat('${key}', 64),
    repeat('${request}', 64)
  )`);
}

function seed(db: PostgresSession): void {
  db.sql(`
    insert into public.plans (id, title, start_time, owner_user_id, status)
    values
      ('${JOIN_PLAN}', 'Join replay', '${WHEN}'::timestamptz + interval '1 day', '${HOST_USER}', 'ready'),
      ('${INVITE_PLAN}', 'Invite replay', '${WHEN}'::timestamptz + interval '1 day', '${HOST_USER}', 'ready'),
      ('${REVOKED_JOIN_PLAN}', 'Revoked join', '${WHEN}'::timestamptz + interval '1 day', '${HOST_USER}', 'ready'),
      ('${REVOKED_INVITE_PLAN}', 'Revoked invite', '${WHEN}'::timestamptz + interval '1 day', '${HOST_USER}', 'ready');

    insert into public.plan_crew_members
      (id, plan_id, name, token_hash, status, joined_at, updated_at, can_collaborate, user_id, membership_revoked_at, join_key_hash, join_request_hash)
    values
      ('${JOIN_HOST_MEMBER}', '${JOIN_PLAN}', 'Host', repeat('1', 64), 'in', '${WHEN}', '${WHEN}', true, '${HOST_USER}', null, null, null),
      ('${INVITE_HOST_MEMBER}', '${INVITE_PLAN}', 'Host', repeat('2', 64), 'in', '${WHEN}', '${WHEN}', true, '${HOST_USER}', null, null, null),
      ('${REVOKED_JOIN_HOST_MEMBER}', '${REVOKED_JOIN_PLAN}', 'Host', repeat('3', 64), 'in', '${WHEN}', '${WHEN}', true, '${HOST_USER}', null, null, null),
      ('${REVOKED_INVITE_HOST_MEMBER}', '${REVOKED_INVITE_PLAN}', 'Host', repeat('4', 64), 'in', '${WHEN}', '${WHEN}', true, '${HOST_USER}', null, null, null),
      ('${REVOKED_JOIN_MEMBER}', '${REVOKED_JOIN_PLAN}', 'Replay guest', repeat('5', 64), 'in', '${WHEN}', '${WHEN}', true, null, '${WHEN}'::timestamptz - interval '1 minute', repeat('0', 64), repeat('1', 64)),
      ('${REVOKED_INVITE_MEMBER}', '${REVOKED_INVITE_PLAN}', 'Replay guest', repeat('6', 64), 'in', '${WHEN}', '${WHEN}', true, null, '${WHEN}'::timestamptz - interval '1 minute', repeat('2', 64), repeat('3', 64));

    insert into public.plan_invites
      (id, plan_id, created_by_member_id, token_hash, idempotency_key, created_at, expires_at)
    values
      ('${INVITE_ID}', '${INVITE_PLAN}', '${INVITE_HOST_MEMBER}', repeat('7', 64), 'invite-replay-key', '${WHEN}', '${WHEN}'::timestamptz + interval '1 day'),
      ('${REVOKED_INVITE_ID}', '${REVOKED_INVITE_PLAN}', '${REVOKED_INVITE_HOST_MEMBER}', repeat('8', 64), 'revoked-invite-key', '${WHEN}', '${WHEN}'::timestamptz + interval '1 day');
  `);
}

beforeAll(async () => {
  if (skipReason) return;
  try {
    database = await startPostgres({ label: "plan-replay", database: "pubmax_plan_replay" });
    database.applyFile(SESSION_FIXTURE);
    for (const path of PREREQUISITES) database.applyFile(path);
    database.sql(`insert into auth.users(id) values ('${HOST_USER}'), ('${ACCOUNT_USER}')`);
    database.applyFile(FORWARD);
  } catch (error) {
    if (database) await database.stop();
    database = null;
    throw error;
  }
}, 300_000);

afterAll(async () => {
  if (database) await database.stop();
  database = null;
});

describe.skipIf(skipReason !== null)("0137 applied to PostgreSQL", () => {
  it("fences stale K after U recovery to R without changing invite redemption", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();
    seed(db);

    expect(joinPlan(db, JOIN_PLAN, JOIN_MEMBER, "a", "b", "c")).toBe("joined");
    expect(
      db.sql(
        `select public.claim_plan_membership('${JOIN_PLAN}'::uuid, '${JOIN_MEMBER}'::uuid, '${ACCOUNT_USER}'::uuid)`,
      ),
    ).toBe("claimed");
    expect(
      db.sql(
        `select public.recover_plan_account_membership_atomic('${JOIN_PLAN}'::uuid, '${ACCOUNT_USER}'::uuid, repeat('d', 64), repeat('e', 64), repeat('f', 64), '${WHEN}'::timestamptz + interval '5 minutes')`,
      ),
    ).toBe("recovered");

    expect(joinPlan(db, JOIN_PLAN, JOIN_MEMBER, "a", "b", "c")).toBe("conflict");
    expect(
      db.sql(
        `select token_hash = repeat('d', 64) and recovery_key_hash = repeat('e', 64) and recovery_request_hash = repeat('f', 64) from public.plan_crew_members where id = '${JOIN_MEMBER}'::uuid`,
      ),
    ).toBe("t");
    expect(joinPlan(db, JOIN_PLAN, JOIN_MEMBER, "d", "b", "c")).toBe("replayed");

    expect(redeem(db, INVITE_PLAN, INVITE_MEMBER, "7", "b", "b", "c")).toBe("joined");
    expect(
      db.sql(
        `select public.claim_plan_membership('${INVITE_PLAN}'::uuid, '${INVITE_MEMBER}'::uuid, '${ACCOUNT_USER}'::uuid)`,
      ),
    ).toBe("claimed");
    expect(
      db.sql(
        `select public.recover_plan_account_membership_atomic('${INVITE_PLAN}'::uuid, '${ACCOUNT_USER}'::uuid, repeat('9', 64), repeat('0', 64), repeat('1', 64), '${WHEN}'::timestamptz + interval '5 minutes')`,
      ),
    ).toBe("recovered");
    const redeemedAt = db.sql(
      `select redeemed_at::text from public.plan_invites where id = '${INVITE_ID}'::uuid`,
    );

    expect(redeem(db, INVITE_PLAN, INVITE_MEMBER, "7", "b", "b", "c")).toBe("conflict");
    expect(
      db.sql(
        `select token_hash = repeat('9', 64) and recovery_key_hash = repeat('0', 64) and recovery_request_hash = repeat('1', 64) from public.plan_crew_members where id = '${INVITE_MEMBER}'::uuid`,
      ),
    ).toBe("t");
    expect(
      db.sql(`select redeemed_at::text from public.plan_invites where id = '${INVITE_ID}'::uuid`),
    ).toBe(redeemedAt);
    expect(redeem(db, INVITE_PLAN, INVITE_MEMBER, "7", "9", "b", "c")).toBe("replayed");
    expect(
      db.sql(`select redeemed_at::text from public.plan_invites where id = '${INVITE_ID}'::uuid`),
    ).toBe(redeemedAt);

    expect(joinPlan(db, REVOKED_JOIN_PLAN, REVOKED_JOIN_MEMBER, "c", "0", "1")).toBe("joined");
    expect(
      db.sql(
        `select membership_revoked_at is null and token_hash = repeat('c', 64) from public.plan_crew_members where id = '${REVOKED_JOIN_MEMBER}'::uuid`,
      ),
    ).toBe("t");
    expect(
      redeem(db, REVOKED_INVITE_PLAN, REVOKED_INVITE_MEMBER, "8", "f", "2", "3"),
    ).toBe("joined");
    expect(
      db.sql(
        `select membership_revoked_at is null and token_hash = repeat('f', 64) from public.plan_crew_members where id = '${REVOKED_INVITE_MEMBER}'::uuid`,
      ),
    ).toBe("t");
  }, 180_000);

  it("keeps service-only wrappers and makes rollback restore stale replay", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();

    expect(
      db.sql(
        `select has_function_privilege('anon', 'public.join_plan_idempotent_atomic(uuid,uuid,text,text,timestamptz,boolean,text,text)', 'execute')::text || '|' || has_function_privilege('service_role', 'public.join_plan_idempotent_atomic(uuid,uuid,text,text,timestamptz,boolean,text,text)', 'execute')::text`,
      ),
    ).toBe("false|true");
    expect(
      db.sql(
        `select has_function_privilege('anon', 'public.redeem_plan_invite_idempotent_atomic(uuid,text,uuid,text,text,timestamptz,text,text)', 'execute')::text || '|' || has_function_privilege('service_role', 'public.redeem_plan_invite_idempotent_atomic(uuid,text,uuid,text,text,timestamptz,text,text)', 'execute')::text`,
      ),
    ).toBe("false|true");

    const dbBeforeRollback = db.sql(
      `select token_hash from public.plan_crew_members where id = '${JOIN_MEMBER}'::uuid`,
    );
    const redeemedAt = db.sql(
      `select redeemed_at::text from public.plan_invites where id = '${INVITE_ID}'::uuid`,
    );
    db.applyFile(ROLLBACK);

    expect(joinPlan(db, JOIN_PLAN, JOIN_MEMBER, "a", "b", "c")).toBe("replayed");
    expect(
      db.sql(`select token_hash from public.plan_crew_members where id = '${JOIN_MEMBER}'::uuid`),
    ).toBe(dbBeforeRollback);
    expect(redeem(db, INVITE_PLAN, INVITE_MEMBER, "7", "b", "b", "c")).toBe("replayed");
    expect(
      db.sql(`select redeemed_at::text from public.plan_invites where id = '${INVITE_ID}'::uuid`),
    ).toBe(redeemedAt);
  }, 180_000);
});
