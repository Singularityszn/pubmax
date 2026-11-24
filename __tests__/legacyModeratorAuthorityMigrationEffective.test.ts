import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresPoll } from "./helpers/postgresPoll";
import { postgresSkipReason } from "./helpers/postgres";
import {
  MIGRATOR, bootCrewAdmissionDatabase, call, correctCall, corrections, crewWith,
  db, deleteAccount, hold, json, key, memberId, outcome, ownership,
  person, remove, rpc, state, stopCrewAdmissionDatabase, waitsOnLockHeldBy,
} from "./helpers/crewAdmissionHarness";

const directory = join(process.cwd(), "supabase/migrations");
const forward = "20261120110000_0253_legacy_moderator_authority.sql";
const rollback = `rollback/${forward.replace(/\.sql$/, "_rollback.sql")}`;
const skipReason = postgresSkipReason();
type Writer = "correction" | "suspension";
type Interruption = "account-wait" | "revocation-commits" | "revocation-rolls-back";

function apply(file: string) {
  execFileSync(db().psql, [...db().databaseArgs, "-X", "-q", "-c", `set role ${MIGRATOR}`, "-f", join(directory, file)],
    { stdio: ["ignore", "pipe", "pipe"] });
}

beforeAll(async () => {
  if (skipReason) return;
  await bootCrewAdmissionDatabase("legacy-moderator-authority-0253", "after");
  if (existsSync(join(directory, forward))) apply(forward);
}, 600_000);
afterAll(async () => { await stopCrewAdmissionDatabase(); });

function fixture(writer: Writer) {
  const moderator = person(), host = person(), subject = person();
  const staff = randomUUID();
  db().sql(`insert into public.private_social_staff_roles(id,profile_id,display_name,role)
    values ('${staff}','${moderator.profile}','Independent moderator','moderator')`);
  const crew = crewWith(host, [subject]);
  if (writer === "correction") remove(host, crew, subject);
  const statement = writer === "correction" ? correctCall(crew, memberId(crew, subject), staff)
    : `set_social_account_suspension_admin('${staff}','${subject.profile}','suspend','Independent safety review',null)`;
  return { staff, subject, crew, statement };
}

function auditCount(writer: Writer, crew: string, account: string) {
  return writer === "correction" ? corrections(crew)
    : db().sql(`select count(*) from public.social_account_moderation_audit where social_account_id='${account}'`);
}

async function interrupted(writer: Writer, interruption: Interruption) {
  const f = fixture(writer);
  const waiter = `legacy_staff_waiter_${key()}`, holder = `legacy_staff_holder_${key()}`;
  const revoke = `update public.private_social_staff_roles set active=false,revoked_at=now() where id='${f.staff}'`;
  const barrier = interruption === "account-wait"
    ? `select public._lock_social_participant_accounts(array['${f.subject.account}']::uuid[])` : revoke;
  const held = await hold(`set local application_name='${holder}'; ${barrier}`, "postgres",
    interruption === "revocation-rolls-back" ? "rollback" : "commit");
  const pending = outcome(waiter, rpc(f.statement));
  try {
    await postgresPoll(() => waitsOnLockHeldBy(waiter, holder)).toBe("t");
    if (interruption === "account-wait") db().sql(revoke);
  } finally {
    try { await held.finish(); } finally { await pending; }
  }
  return { ...f, result: await pending };
}

describe.skipIf(skipReason !== null)("0253: current authority for legacy moderator writes", () => {
  for (const writer of ["correction", "suspension"] as const) {
    it(`${writer} refuses authority revoked before the call`, () => {
      const f = fixture(writer);
      db().sql(`update public.private_social_staff_roles set active=false,revoked_at=now() where id='${f.staff}'`);
      expect(() => call(f.statement)).toThrow(/staff required/);
      expect(auditCount(writer, f.crew, f.subject.account)).toBe("0");
      expect(writer === "correction" ? state(f.crew, f.subject) : ownership(f.subject))
        .toBe(writer === "correction" ? "removed" : "active");
    });

    it.each(["account-wait", "revocation-commits", "revocation-rolls-back"] as const)(
      `${writer} rechecks authority through %s`, async (interruption) => {
        const { subject, crew, result } = await interrupted(writer, interruption);
        const allowed = interruption === "revocation-rolls-back";
        expect(result.ok, result.said).toBe(allowed);
        if (allowed) expect(json(result.said)).toMatchObject({ ok: true, code: writer === "correction" ? "corrected" : "suspended" });
        else expect(result.said).toContain("staff required");
        expect(writer === "correction" ? state(crew, subject) : ownership(subject))
          .toBe(writer === "correction" ? allowed ? "left" : "removed" : allowed ? "suspended" : "active");
        expect(auditCount(writer, crew, subject.account)).toBe(allowed ? "1" : "0");
      },
    );

    it.each(["writer-first", "deletion-first"] as const)(`${writer} serialises subject deletion, %s`, async (order) => {
      const f = fixture(writer);
      const holder = `legacy_delete_holder_${key()}`, waiter = `legacy_delete_waiter_${key()}`;
      const held = await hold(`set local application_name='${holder}'; ${order === "writer-first" ? rpc(f.statement) : deleteAccount(f.subject)}`,
        order === "writer-first" ? "service_role" : "postgres");
      const pending = order === "writer-first" ? outcome(waiter, deleteAccount(f.subject), "postgres")
        : outcome(waiter, rpc(f.statement));
      try {
        if (order === "writer-first") expect(json(held.said)).toMatchObject({ ok: true });
        await postgresPoll(() => waitsOnLockHeldBy(waiter, holder)).toBe("t");
      } finally {
        try { await held.finish(); } finally { await pending; }
      }
      const result = await pending;
      expect(result.ok, result.said).toBe(true);
      if (order === "deletion-first") expect(json(result.said)).toMatchObject({ ok: false, code: "gone" });
      expect(db().sql(`select count(*) from auth.users where id='${f.subject.user}'`)).toBe("0");
      if (writer === "correction") expect(corrections(f.crew)).toBe("0");
    });
  }

  it("rollback restores the predecessor and reapplication restores the authority fence", async () => {
    apply(rollback);
    try {
      const old = await interrupted("correction", "account-wait");
      expect(old.result.ok, old.result.said).toBe(true);
      expect(state(old.crew, old.subject)).toBe("left");
      expect(corrections(old.crew)).toBe("1");
    } finally { apply(forward); }
    const fixed = await interrupted("correction", "account-wait");
    expect(fixed.result.ok).toBe(false);
    expect(fixed.result.said).toContain("staff required");
    expect(corrections(fixed.crew)).toBe("0");
  });
});
