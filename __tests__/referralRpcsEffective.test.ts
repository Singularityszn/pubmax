// The referral RPCs, proved on a cluster holding every migration:
// `get_or_create_referral_invite_code`, `claim_referral_code`,
// `qualify_referral_from_contribution` and `erase_referral_account`.
//
// The service-role store (`lib/referralStore.ts`) calls all four. The rules
// they own: one invite code per inviter, however many requests race for it; a
// code is claimed only by an account created inside the sign-in attempt that
// carried it, never by an old account, by the inviter, round a circle, or by an
// account another inviter already holds; a referral qualifies once, on the
// invitee's first accepted contribution; milestones 1, 3 and 5 are recorded for
// the inviter as a mark and nothing else; the ledger is append-only; and
// erasure removes every trace of an account and keeps it from coming back. No
// browser role may call any of them or read what they write.

import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asBrowserRole,
  asServiceRole,
  postgresSkipReason,
  startMigratedPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

const NOW = "2026-10-05 12:00:00+00";
const ATTEMPT_STARTED = "2026-10-05 11:55:00+00";
const CREATED_IN_ATTEMPT = "2026-10-05 11:56:00+00";

const INVITER = "a0000000-0000-4000-8000-000000000001";
const OTHER_INVITER = "b0000000-0000-4000-8000-000000000002";
const INVITEE_1 = "c0000000-0000-4000-8000-000000000001";
const INVITEE_2 = "c0000000-0000-4000-8000-000000000002";
const INVITEE_3 = "c0000000-0000-4000-8000-000000000003";
const INVITEE_4 = "c0000000-0000-4000-8000-000000000004";
const INVITEE_5 = "c0000000-0000-4000-8000-000000000005";
const OLD_ACCOUNT = "d0000000-0000-4000-8000-000000000001";
const ERASED = "e0000000-0000-4000-8000-000000000001";
const ERASED_INVITER = "e0000000-0000-4000-8000-000000000002";
const ERASED_INVITEE = "e0000000-0000-4000-8000-000000000003";
const RACER = "f0000000-0000-4000-8000-000000000001";
const MISSING = "f0000000-0000-4000-8000-0000000000ff";

let session: PostgresSession | null = null;

function db(): PostgresSession {
  if (!session) throw new Error("PostgreSQL referral session did not start.");
  return session;
}

function tokenFor(label: string): string {
  return `invite-token-${label}`.padEnd(24, "x");
}

function hashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function uuid(value: string | null): string {
  return value === null ? "null" : `'${value}'::uuid`;
}

function inviteCode(inviter: string | null, token: string): string {
  return `select public.get_or_create_referral_invite_code(${uuid(inviter)}, '${hashOf(token)}', '${token}', timestamptz '${NOW}')::text`;
}

function claim(
  token: string,
  invitee: string | null,
  attemptStarted: string | null = ATTEMPT_STARTED,
): string {
  const started = attemptStarted === null ? "null" : `timestamptz '${attemptStarted}'`;
  return `select public.claim_referral_code('${hashOf(token)}', ${uuid(invitee)}, ${started}, timestamptz '${NOW}')::text`;
}

function qualify(invitee: string | null, kind: string, contributionId: string, acceptedAt = NOW): string {
  return `select public.qualify_referral_from_contribution(${uuid(invitee)}, '${kind}', '${contributionId}', timestamptz '${acceptedAt}')::text`;
}

function erase(userId: string | null): string {
  return `select public.erase_referral_account(${uuid(userId)})`;
}

function answer(statement: string): Record<string, unknown> {
  return JSON.parse(db().sql(asServiceRole(statement))) as Record<string, unknown>;
}

function count(statement: string): number {
  return Number(db().sql(statement));
}

function milestonesOf(beneficiary: string): string {
  return db().sql(`
    select coalesce(string_agg(milestone::text || ':' || qualified_count_at_event, ',' order by milestone), '')
    from public.referral_milestone_ledger where beneficiary_user_id = '${beneficiary}'
  `);
}

function traces(userId: string): string {
  return db().sql(`
    select
      (select count(*) from public.referral_invite_codes where inviter_user_id = '${userId}') || '|' ||
      (select count(*) from public.referral_edges where inviter_user_id = '${userId}' or invitee_user_id = '${userId}') || '|' ||
      (select count(*) from public.referral_milestone_ledger where beneficiary_user_id = '${userId}')
  `);
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startMigratedPostgres({
    label: "referral-rpcs",
    database: "pubmax_referral_rpcs",
  });
  const fresh = [INVITER, OTHER_INVITER, INVITEE_1, INVITEE_2, INVITEE_3, INVITEE_4, INVITEE_5, ERASED, ERASED_INVITER, ERASED_INVITEE, RACER];
  db().sql(`
    insert into auth.users (id, created_at) values
      ${fresh.map((id) => `('${id}', timestamptz '${CREATED_IN_ATTEMPT}')`).join(",\n      ")},
      ('${OLD_ACCOUNT}', timestamptz '2026-01-01 00:00:00+00');
  `);
}, 180_000);

afterAll(async () => {
  await session?.stop();
});

describe.skipIf(skipReason !== null)("get_or_create_referral_invite_code", () => {
  it("refuses a missing inviter", () => {
    expect(answer(inviteCode(null, tokenFor("nobody")))).toEqual({ ok: false, reason: "invalid_user" });
  });

  it("mints one code per inviter and answers that code to every later call", () => {
    expect(answer(inviteCode(INVITER, tokenFor("inviter")))).toEqual({ ok: true, code: tokenFor("inviter") });
    expect(answer(inviteCode(INVITER, tokenFor("inviter-again")))).toEqual({
      ok: true,
      code: tokenFor("inviter"),
    });
    expect(count(`select count(*) from public.referral_invite_codes where inviter_user_id = '${INVITER}'`)).toBe(1);
  });

  it("mints one code when first requests race", async () => {
    const answers = await db().concurrentResults(
      Array.from({ length: 6 }, (_, index) =>
        asServiceRole(inviteCode(RACER, tokenFor(`racer-${index}`))),
      ),
    );
    const codes = new Set(answers.map((raw) => (JSON.parse(raw) as { code: string }).code));
    expect(codes.size).toBe(1);
    expect(count(`select count(*) from public.referral_invite_codes where inviter_user_id = '${RACER}'`)).toBe(1);
  });
});

describe.skipIf(skipReason !== null)("claim_referral_code", () => {
  it("refuses a missing invitee, and an account not created inside the attempt", () => {
    const code = tokenFor("inviter");
    expect(answer(claim(code, null))).toEqual({ ok: false, reason: "storage" });
    expect(answer(claim(code, MISSING)).reason).toBe("account_not_new");
    expect(answer(claim(code, OLD_ACCOUNT)).reason).toBe("account_not_new");
    // An attempt with no start, one from the future, or one over an hour old.
    expect(answer(claim(code, INVITEE_1, null)).reason).toBe("account_not_new");
    expect(answer(claim(code, INVITEE_1, "2026-10-05 12:01:00+00")).reason).toBe("account_not_new");
    expect(answer(claim(code, INVITEE_1, "2026-10-05 11:00:00+00")).reason).toBe("account_not_new");
    // An account created before its attempt started is not new to that attempt.
    expect(answer(claim(code, INVITEE_1, "2026-10-05 11:57:00+00")).reason).toBe("account_not_new");
    expect(count(`select count(*) from public.referral_edges`)).toBe(0);
  });

  it("answers unknown for a code nobody minted", () => {
    expect(answer(claim(tokenFor("never-minted"), INVITEE_1))).toEqual({ ok: false, reason: "unknown" });
  });

  it("refuses the inviter's own code", () => {
    expect(answer(claim(tokenFor("inviter"), INVITER))).toEqual({ ok: false, reason: "self" });
  });

  it("records a new account once, and holds it to its first inviter", () => {
    const recorded = answer(claim(tokenFor("inviter"), INVITEE_1));
    expect(recorded).toMatchObject({ ok: true, status: "recorded" });
    expect(answer(claim(tokenFor("inviter"), INVITEE_1))).toEqual({
      ok: true,
      status: "existing",
      edge_id: recorded.edge_id,
    });

    expect(answer(inviteCode(OTHER_INVITER, tokenFor("other")))).toMatchObject({ ok: true });
    expect(answer(claim(tokenFor("other"), INVITEE_1))).toEqual({ ok: false, reason: "already_attributed" });
    expect(count(`select count(*) from public.referral_edges where invitee_user_id = '${INVITEE_1}'`)).toBe(1);
  });

  it("refuses a circle", () => {
    // OTHER_INVITER is invited by INVITEE_2, who then tries OTHER_INVITER's code.
    expect(answer(inviteCode(INVITEE_2, tokenFor("invitee-1")))).toMatchObject({ ok: true });
    expect(answer(claim(tokenFor("invitee-1"), OTHER_INVITER))).toMatchObject({ ok: true, status: "recorded" });
    expect(answer(claim(tokenFor("other"), INVITEE_2))).toEqual({ ok: false, reason: "circular" });
  });
});

describe.skipIf(skipReason !== null)("qualify_referral_from_contribution", () => {
  it("refuses a missing invitee, an unknown contribution kind and an account with no inviter", () => {
    expect(answer(qualify(null, "community_price", "p-0"))).toEqual({ ok: false, reason: "storage" });
    expect(answer(qualify(INVITEE_1, "follow", "p-0"))).toEqual({ ok: false, reason: "storage" });
    expect(answer(qualify(INVITEE_3, "community_price", "p-0"))).toEqual({ ok: false, reason: "no_edge" });
  });

  it("qualifies once and records milestone 1 for the inviter as a permanent mark", () => {
    expect(answer(qualify(INVITEE_1, "community_price", "price-1", "2026-10-05 12:01:00+00"))).toEqual({
      ok: true,
      status: "qualified",
    });
    expect(answer(qualify(INVITEE_1, "visit_report", "report-1"))).toEqual({ ok: true, status: "existing" });
    expect(milestonesOf(INVITER)).toBe("1:1");
    expect(
      db().sql(`
        select event_type || '|' || permanent || '|' || reason_code
        from public.referral_milestone_ledger where beneficiary_user_id = '${INVITER}'
      `),
    ).toBe("milestone_earned|true|qualified_referrals");
    // The invitee earns nothing for being invited.
    expect(milestonesOf(INVITEE_1)).toBe("");
  });

  it("records milestones 3 and 5 as qualified referrals reach them, and nothing between", () => {
    for (const [index, invitee] of [INVITEE_3, INVITEE_4, INVITEE_5, RACER].entries()) {
      expect(answer(claim(tokenFor("inviter"), invitee))).toMatchObject({ ok: true, status: "recorded" });
      expect(
        answer(qualify(invitee, "visit_report", `report-${invitee}`, `2026-10-05 12:0${index + 2}:00+00`)),
      ).toMatchObject({ ok: true, status: "qualified" });
      if (index === 1) expect(milestonesOf(INVITER), "three qualified").toBe("1:1,3:3");
    }
    expect(milestonesOf(INVITER)).toBe("1:1,3:3,5:5");
    // Each inviter's marks are their own: OTHER_INVITER qualifying marks INVITEE_2 alone.
    expect(answer(qualify(OTHER_INVITER, "recommendation", "rec-1"))).toMatchObject({ status: "qualified" });
    expect(milestonesOf(INVITEE_2)).toBe("1:1");
    expect(milestonesOf(INVITER)).toBe("1:1,3:3,5:5");
  });

  it("keeps the edges, qualifications and ledger append-only", async () => {
    for (const statement of [
      `update public.referral_edges set attributed_at = now()`,
      `delete from public.referral_qualification_events`,
      `update public.referral_milestone_ledger set milestone = 5`,
      `delete from public.referral_milestone_ledger`,
    ]) {
      const refused = await db().attempt(statement);
      expect(refused.ok, statement).toBe(false);
      expect(refused.said).toMatch(/is append-only/);
    }
    expect(milestonesOf(INVITER)).toBe("1:1,3:3,5:5");
  });
});

describe.skipIf(skipReason !== null)("erase_referral_account", () => {
  it("does nothing for a missing id", () => {
    const before = count(`select count(*) from public.referral_erasure_blocks`);
    db().sql(asServiceRole(erase(null)));
    expect(count(`select count(*) from public.referral_erasure_blocks`)).toBe(before);
  });

  it("removes every trace of an erased inviter and the marks their invitee earned them", () => {
    expect(answer(inviteCode(ERASED_INVITER, tokenFor("erased-inviter")))).toMatchObject({ ok: true });
    expect(answer(claim(tokenFor("erased-inviter"), ERASED_INVITEE))).toMatchObject({ status: "recorded" });
    expect(answer(qualify(ERASED_INVITEE, "community_price", "erased-price"))).toMatchObject({ status: "qualified" });
    expect(traces(ERASED_INVITER)).toBe("1|1|1");

    db().sql(asServiceRole(erase(ERASED_INVITER)));
    expect(traces(ERASED_INVITER)).toBe("0|0|0");
    expect(traces(ERASED_INVITEE)).toBe("0|0|0");
    expect(count(`select count(*) from public.referral_qualification_events where contribution_id = 'erased-price'`)).toBe(0);
    expect(
      db().sql(
        `select count(*) from public.referral_erasure_blocks where user_id_hash = '${hashOf(ERASED_INVITER)}'`,
      ),
    ).toBe("1");
    // No other inviter lost a mark.
    expect(milestonesOf(INVITER)).toBe("1:1,3:3,5:5");
  });

  it("keeps an erased account from minting, being claimed or qualifying again", () => {
    db().sql(asServiceRole(erase(ERASED)));
    expect(answer(inviteCode(ERASED, tokenFor("erased")))).toEqual({ ok: false, reason: "deleted_identity" });
    expect(answer(claim(tokenFor("inviter"), ERASED))).toEqual({ ok: false, reason: "deleted_identity" });
    expect(answer(qualify(ERASED, "community_price", "erased-again"))).toEqual({
      ok: false,
      reason: "deleted_identity",
    });
    expect(answer(inviteCode(ERASED_INVITER, tokenFor("erased-inviter-2")))).toEqual({
      ok: false,
      reason: "deleted_identity",
    });
    expect(traces(ERASED)).toBe("0|0|0");
  });
});

describe.skipIf(skipReason !== null)("the referral RPCs and the browser roles", () => {
  it("refuses anon and a signed-in account on every function, and nothing moves", async () => {
    const before = db().sql(`
      select (select count(*) from public.referral_invite_codes) || '|' ||
             (select count(*) from public.referral_edges) || '|' ||
             (select count(*) from public.referral_erasure_blocks)
    `);
    for (const [role, sub] of [
      ["anon", null],
      ["authenticated", INVITEE_5],
    ] as const) {
      for (const [name, statement] of [
        ["get_or_create_referral_invite_code", inviteCode(INVITEE_5, tokenFor("browser"))],
        ["claim_referral_code", claim(tokenFor("inviter"), INVITEE_5)],
        ["qualify_referral_from_contribution", qualify(INVITEE_5, "community_price", "browser")],
        ["erase_referral_account", erase(INVITER)],
      ] as const) {
        const refused = await db().attempt(asBrowserRole(role, sub, statement));
        expect(refused.ok, `${role} must not call ${name}`).toBe(false);
        expect(refused.said).toMatch(new RegExp(`permission denied for function ${name}`));
      }
      for (const table of [
        "referral_invite_codes",
        "referral_edges",
        "referral_qualification_events",
        "referral_milestone_ledger",
        "referral_erasure_blocks",
      ]) {
        const read = await db().attempt(asBrowserRole(role, sub, `select count(*) from public.${table}`));
        expect(read.ok, `${role} must not read ${table}`).toBe(false);
        expect(read.said).toMatch(/permission denied for table/);
      }
    }
    expect(
      db().sql(`
        select (select count(*) from public.referral_invite_codes) || '|' ||
               (select count(*) from public.referral_edges) || '|' ||
               (select count(*) from public.referral_erasure_blocks)
      `),
    ).toBe(before);
    expect(milestonesOf(INVITER)).toBe("1:1,3:3,5:5");
  });
});
