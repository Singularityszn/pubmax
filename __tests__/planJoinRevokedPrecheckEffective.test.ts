// Effective proof for 0136. This file APPLIES the migration to a real
// PostgreSQL 16 and drives the two account entry points, because
// "a revoked seat no longer blocks a join" is a claim about what the database
// does and only the database can answer it.
//
// The decisive step is the last one: the same calls are re-run against the
// ROLLBACK, and there they must refuse. Without that, a test proving the join
// succeeds proves only that some join succeeds, not that 0136 is what changed.
//
// Same host contract as the other effective migration proofs
// (occupancyMigrationEffective, openSocialCrewsMigration): a host with no
// PostgreSQL binaries skips loudly rather than passing quietly.

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
const FORWARD_NAME = "20260903090000_0136_plan_join_revoked_precheck.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20260903090000_0136_plan_join_revoked_precheck_rollback.sql",
);
// Supabase installs the `auth` schema and pgcrypto-in-`extensions` before any
// application migration runs, so the local cluster has to do the same or the
// very first migration referencing auth.users fails.
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

const HOST_USER = "00000000-0000-4000-8000-0000000000a1";
const RETURNING_USER = "00000000-0000-4000-8000-0000000000a2";
const PLAN = "00000000-0000-4000-8000-0000000000b1";
const REVOKED_SEAT = "00000000-0000-4000-8000-0000000000c1";
const HOST_SEAT = "00000000-0000-4000-8000-0000000000c2";

/** Ask the join boundary for a seat, as the returning account. */
function joinAs(db: PostgresSession, memberId: string, key: string): string {
  return db.sql(`select public.join_plan_account_idempotent_atomic(
    '${PLAN}'::uuid,
    '${memberId}'::uuid,
    'Returning drinker',
    md5('${key}-token')||md5('${key}-token-2'),
    now(),
    true,
    md5('${key}-idem')||md5('${key}-idem-2'),
    md5('${key}-req')||md5('${key}-req-2'),
    '${RETURNING_USER}'::uuid
  )`);
}

/** Ask the invite-redeem boundary for a seat, as the returning account. */
function redeemAs(db: PostgresSession, memberId: string, key: string): string {
  return db.sql(`select public.redeem_plan_invite_account_idempotent_atomic(
    '${PLAN}'::uuid,
    md5('${key}-invite')||md5('${key}-invite-2'),
    '${memberId}'::uuid,
    'Returning drinker',
    md5('${key}-mtoken')||md5('${key}-mtoken-2'),
    now(),
    md5('${key}-idem')||md5('${key}-idem-2'),
    md5('${key}-req')||md5('${key}-req-2'),
    '${RETURNING_USER}'::uuid
  )`);
}

let database: PostgresSession | null = null;

function requireDatabase(): PostgresSession {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}

/** A Plan whose only seat for the returning account has been REVOKED. */
function seedRevokedSeat(db: PostgresSession): void {
  db.sql(`delete from public.plan_crew_members where plan_id = '${PLAN}';
    delete from public.plan_stops where plan_id = '${PLAN}';
    delete from public.plan_invites where plan_id = '${PLAN}';
    delete from public.plans where id = '${PLAN}';`);
  db.sql(`insert into public.plans(id,title,start_time,owner_user_id,status)
      values('${PLAN}','Revoked seat night',now()+interval '1 day','${HOST_USER}','ready');
    insert into public.plan_stops(plan_id,venue_id,venue_name,position)
      values('${PLAN}','venue-angel-islington','The Angel',0);
    insert into public.plan_crew_members(
      id,plan_id,name,token_hash,status,user_id,joined_at,updated_at,can_collaborate,membership_revoked_at
    ) values(
      -- The HOST holds the first ACTIVE seat. Without it the returning
      -- drinker's new seat would BE the first active one, so claim_plan_membership
      -- would read it as the host seat and refuse because the Plan is owned by
      -- somebody else - a fixture artefact, not the behaviour under test.
      '${HOST_SEAT}','${PLAN}','Host',
      md5('host-seat')||md5('host-seat-2'),'in','${HOST_USER}',
      now()-interval '3 days',now()-interval '3 days',true,null
    ),(
      '${REVOKED_SEAT}','${PLAN}','Returning drinker',
      md5('revoked-seat')||md5('revoked-seat-2'),'in','${RETURNING_USER}',
      now()-interval '2 days',now()-interval '1 day',true,now()-interval '1 day'
    );`);
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startPostgres({ label: "plan-join-0135", database: "pubmax_plan_join_0135" });
  database.applyFile(SESSION_FIXTURE);
  for (const path of PREREQUISITES) database.applyFile(path);
  database.applyFile(FORWARD);
  // The plan owner and the returning drinker must exist as accounts before a
  // seat can reference them.
  database.sql(`insert into auth.users(id) values
    ('${HOST_USER}'),('${RETURNING_USER}')`);
}, 300_000);

afterAll(async () => {
  if (database) await database.stop();
  database = null;
});

describe.skipIf(skipReason !== null)("0136 applied to PostgreSQL", () => {
  it("lets an account whose only prior seat was revoked JOIN again", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();
    seedRevokedSeat(db);

    const outcome = joinAs(db, "00000000-0000-4000-8000-0000000000d1", "join-after-revoke");

    // The precheck is what this migration moves. `account_conflict` is the
    // refusal it used to give, and the one thing that must not come back.
    expect(outcome).not.toBe("account_conflict");
    expect(outcome).toBe("joined");
  }, 180_000);

  it("lets that same account REDEEM an invite again", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();
    seedRevokedSeat(db);
    db.sql(`insert into public.plan_invites(
      id, plan_id, created_by_member_id, token_hash, idempotency_key, created_at, expires_at
    )
      values(
        '00000000-0000-4000-8000-0000000000e1',
        '${PLAN}',
        '${HOST_SEAT}',
        md5('redeem-after-revoke-invite')||md5('redeem-after-revoke-invite-2'),
        'redeem-after-revoke-invite',
        now(),
        now()+interval '1 day'
      );`);

    const outcome = redeemAs(db, "00000000-0000-4000-8000-0000000000d2", "redeem-after-revoke");

    expect(outcome).toBe("joined");
    expect(
      db.sql("select case when redeemed_at is not null then 'redeemed' else 'not_redeemed' end from public.plan_invites where id = '00000000-0000-4000-8000-0000000000e1';"),
    ).toBe("redeemed");
    expect(
      db.sql(`select user_id::text || '|' || case when membership_revoked_at is null then 'active' else 'revoked' end
        from public.plan_crew_members where id = '00000000-0000-4000-8000-0000000000d2';`),
    ).toBe(`${RETURNING_USER}|active`);
  }, 180_000);

  it("still refuses an account holding an ACTIVE seat, which 0136 must not loosen", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();
    seedRevokedSeat(db);
    // Un-revoke the seat: now the account genuinely holds one.
    db.sql(`update public.plan_crew_members
      set membership_revoked_at = null where id = '${REVOKED_SEAT}'`);

    const outcome = joinAs(db, "00000000-0000-4000-8000-0000000000d3", "join-with-active");

    expect(outcome).toBe("account_conflict");
  }, 180_000);

  it("refuses again once the migration is rolled back, so 0136 is what changed it", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();
    db.applyFile(ROLLBACK);
    try {
      seedRevokedSeat(db);
      expect(joinAs(db, "00000000-0000-4000-8000-0000000000d4", "join-rolled-back")).toBe(
        "account_conflict",
      );
      expect(redeemAs(db, "00000000-0000-4000-8000-0000000000d5", "redeem-rolled-back")).toBe(
        "account_conflict",
      );
    } finally {
      db.applyFile(FORWARD);
    }
  }, 180_000);
});
