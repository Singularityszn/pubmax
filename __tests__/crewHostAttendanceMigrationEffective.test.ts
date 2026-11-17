// Migration 0247 on a real PostgreSQL replay, applied after 0245 and 0246 by the
// migration role of the permission replica. An authorised host marks an accepted
// participant of the same night. A correction names the revision it replaces. After
// the 12-hour close only an audited moderator who is not a host of that crew corrects
// it. Records and their corrections expire 30 days after the close.

import { execFile, execFileSync } from "node:child_process";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asServiceRole, postgresSkipReason } from "./helpers/postgres";
import {
  type Person,
  DIGEST,
  MIGRATOR,
  NOT_FOUND,
  REFUSED_BY_LOCKS,
  STAFF_ROLE,
  block,
  blockCall,
  bootCrewAdmissionDatabase,
  call,
  crewWith,
  db,
  deleteAccount,
  hold,
  holdRpc,
  json,
  key,
  makeCohost,
  memberId,
  mutual,
  outcome,
  person,
  remove,
  request,
  rpc,
  stopCrewAdmissionDatabase,
  suspendCall,
  waitsOnAccountLock,
  waitsOnAnyLock,
} from "./helpers/crewAdmissionHarness";

const FORWARD = "20261117150000_0247_crew_host_attendance.sql";
const ROLLBACK = `rollback/${FORWARD.replace(/\.sql$/, "_rollback.sql")}`;
const directory = join(process.cwd(), "supabase/migrations");
const SECOND_STAFF = "a2478888-0000-4000-8000-000000000047";

const skipReason = postgresSkipReason();
let moderator: Person;
beforeAll(async () => {
  if (skipReason) return;
  moderator = await bootCrewAdmissionDatabase("crew-attendance-0247", "after");
  applyForward();
}, 600_000);
afterAll(async () => { await stopCrewAdmissionDatabase(); });

function applyForward() {
  execFileSync(db().psql, [...db().databaseArgs, "-X", "-q", "-c", `set role ${MIGRATOR}`, "-f", join(directory, FORWARD)],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
function rollback(acknowledgement?: string) {
  const args = [...db().databaseArgs, "-X", "-q", "-c", `set role ${MIGRATOR}`];
  if (acknowledgement !== undefined) args.push("-c", `set pubmax.crew_attendance_discarded = '${acknowledgement}'`);
  args.push("-f", join(directory, ROLLBACK));
  return new Promise<{ ok: boolean; said: string }>((resolve) => {
    execFile(db().psql, args, { encoding: "utf8" }, (error, _stdout, stderr) => resolve({ ok: !error, said: String(stderr ?? "") }));
  });
}

type Mark = "attended" | "absent";
const attestCall = (actor: Person, crew: string, subject: Person, mark: Mark, expected: number, idempotencyKey = key()) =>
  `attest_social_crew_attendance_atomic('${actor.account}','${crew}','${memberId(crew, subject)}','${mark}',${expected},'${idempotencyKey}','${DIGEST}')`;
const attest = (actor: Person, crew: string, subject: Person, mark: Mark, expected: number, idempotencyKey?: string) =>
  call(attestCall(actor, crew, subject, mark, expected, idempotencyKey));
const correctCall = (crew: string, subject: Person, mark: Mark, expected: number, staff = STAFF_ROLE, reason = "Host marked the wrong person") =>
  `correct_social_crew_attendance_admin('${staff}','${crew}','${memberId(crew, subject)}','${mark}',${expected},'${reason}')`;
const correct = (crew: string, subject: Person, mark: Mark, expected: number, staff?: string, reason?: string) =>
  call(correctCall(crew, subject, mark, expected, staff, reason));
const read = (viewer: Person, crew: string) =>
  json(db().sql(asServiceRole(`select coalesce(public.read_social_crew_attendance('${viewer.account}','${viewer.profile}','${crew}')::text,'null')`))) as
    null | { canAttest: boolean; open: boolean; opensAt: string; closesAt: string; items: Array<Record<string, unknown>> };
const exported = (who: Person) =>
  JSON.parse(db().sql(asServiceRole(`select public.export_social_crew_attendance('${who.user}',100)::text`))) as Array<Record<string, unknown>>;
const purge = (limit: number) => call(`purge_expired_social_crew_attendance(${limit})`);
const rows = (crew: string, who?: Person) => db().sql(`select count(*) from public.social_crew_attendance
  where crew_id='${crew}'${who ? ` and subject_account_id='${who.account}'` : ""}`);
/** Moves the night's start relative to now. Admission ran first, while the night was ahead. */
const startsIn = (crew: string, interval: string) => db().sql(`update public.plans set start_time=now()+interval '${interval}'
  where id=(select plan_id from public.social_crews where id='${crew}')`);
/** A night that started an hour ago, with these accepted guests. */
function tonight(host: Person, guests: Person[]) {
  const crew = crewWith(host, guests);
  startsIn(crew, "-1 hour");
  return crew;
}
const item = (viewer: Person, crew: string, subject: Person) =>
  read(viewer, crew)?.items.find((entry) => entry.memberId === memberId(crew, subject));

describe.skipIf(skipReason !== null)("0247: host attendance attestation", () => {
  it("a host marks an accepted participant of the same night, and both read the same revision", () => {
    const host = person(), ana = person(), bea = person();
    const crew = tonight(host, [ana, bea]);
    expect(attest(host, crew, ana, "attended", 0)).toMatchObject({ ok: true, code: "attested", revision: 1, state: "attended" });
    expect(item(host, crew, ana)).toMatchObject({ state: "attended", revision: 1, recordedBy: "host" });
    expect(item(host, crew, bea)).toMatchObject({ state: null, revision: 0, recordedBy: null });
    expect(read(host, crew)).toMatchObject({ canAttest: true, open: true });
    const own = read(ana, crew);
    expect(own).toMatchObject({ canAttest: false });
    expect(own?.items).toEqual([expect.objectContaining({ memberId: memberId(crew, ana), state: "attended", revision: 1 })]);
    expect(read(bea, crew)?.items).toEqual([]);
    expect(db().sql(`select count(*) from information_schema.columns where table_name='social_crew_attendance'
      and column_name ~ '(lat|lng|lon|coord|location|venue|purchase|price|receipt|photo|point)'`)).toBe("0");
  });

  it("a correction before the close must name the current revision, and keeps the history", () => {
    const host = person(), ana = person();
    const crew = tonight(host, [ana]);
    expect(attest(host, crew, ana, "attended", 0)).toMatchObject({ ok: true, revision: 1 });
    expect(attest(host, crew, ana, "absent", 0)).toEqual({ ok: false, code: "stale" });
    expect(attest(host, crew, ana, "attended", 1)).toMatchObject({ ok: true, code: "unchanged", revision: 1 });
    expect(attest(host, crew, ana, "absent", 1)).toMatchObject({ ok: true, code: "attested", revision: 2, state: "absent" });
    expect(rows(crew, ana)).toBe("2");
    expect(item(host, crew, ana)).toMatchObject({ state: "absent", revision: 2 });
  });

  it("a replayed key returns its stored answer, and a changed payload under that key is refused", () => {
    const host = person(), ana = person();
    const crew = tonight(host, [ana]);
    const reused = key();
    expect(attest(host, crew, ana, "attended", 0, reused)).toMatchObject({ ok: true, code: "attested", revision: 1 });
    expect(attest(host, crew, ana, "attended", 0, reused)).toMatchObject({ ok: true, code: "replayed", revision: 1 });
    expect(call(`attest_social_crew_attendance_atomic('${host.account}','${crew}','${memberId(crew, ana)}','attended',0,'${reused}','${"b".repeat(64)}')`))
      .toEqual({ ok: false, code: "idempotency_conflict" });
    expect(rows(crew, ana)).toBe("1");
  });

  it("only an owner or a co-host marks, only accepted participants, never themselves and never a private crew", () => {
    const host = person(), cohost = person(), ana = person(), bea = person(), pat = person(), stranger = person();
    mutual(host, cohost);
    const crew = tonight(host, [cohost, ana, bea]);
    makeCohost(crew, cohost);
    expect(attest(cohost, crew, ana, "attended", 0)).toMatchObject({ ok: true, revision: 1 });
    expect(attest(ana, crew, bea, "attended", 0)).toEqual(NOT_FOUND);
    expect(attest(host, crew, host, "attended", 0)).toEqual(NOT_FOUND);
    startsIn(crew, "1 day");
    expect(request(pat, crew)).toMatchObject({ ok: true, code: "requested" });
    startsIn(crew, "-1 hour");
    const pending = db().sql(`select coalesce((select id::text from public.social_crew_members where crew_id='${crew}' and social_account_id='${pat.account}'),'none')`);
    expect(pending).toBe("none");
    expect(call(`attest_social_crew_attendance_atomic('${host.account}','${crew}','a2479999-0000-4000-8000-000000000001','attended',0,'${key()}','${DIGEST}')`)).toEqual(NOT_FOUND);
    expect(read(stranger, crew)).toBeNull();
    expect(remove(host, crew, bea)).toMatchObject({ ok: true });
    expect(attest(host, crew, bea, "attended", 0)).toEqual(NOT_FOUND);
    db().sql(`update public.social_crews set visibility='private' where id='${crew}'`);
    expect(attest(host, crew, ana, "absent", 1)).toEqual(NOT_FOUND);
    expect(read(host, crew)).toBeNull();
  });

  it("refuses before the night opens, after the 12-hour close and on a cancelled night", () => {
    const host = person(), ana = person();
    const crew = crewWith(host, [ana]);
    startsIn(crew, "2 days");
    expect(attest(host, crew, ana, "attended", 0)).toEqual({ ok: false, code: "not_open" });
    startsIn(crew, "-11 hours 59 minutes");
    expect(attest(host, crew, ana, "attended", 0)).toMatchObject({ ok: true, revision: 1 });
    startsIn(crew, "-12 hours");
    expect(attest(host, crew, ana, "absent", 1)).toEqual({ ok: false, code: "closed" });
    expect(read(host, crew)).toMatchObject({ open: false });
    const other = tonight(host, [ana]);
    db().sql(`update public.plans set status='abandoned' where id=(select plan_id from public.social_crews where id='${other}')`);
    expect(attest(host, other, ana, "attended", 0)).toEqual({ ok: false, code: "closed" });
    expect(rows(other)).toBe("0");
  });

  it("a block either way, a suspended participant and a suspended host are refused without a reason", () => {
    const host = person(), ana = person(), bea = person(), sue = person();
    const crew = tonight(host, [ana, bea, sue]);
    block(ana, host);
    expect(attest(host, crew, ana, "attended", 0)).toEqual(NOT_FOUND);
    expect(item(host, crew, ana)).toBeUndefined();
    block(host, bea);
    expect(attest(host, crew, bea, "attended", 0)).toEqual(NOT_FOUND);
    expect(call(suspendCall(sue))).toMatchObject({ ok: true, code: "suspended" });
    expect(attest(host, crew, sue, "attended", 0)).toEqual(NOT_FOUND);
    const other = person(), cal = person();
    const second = tonight(other, [cal]);
    expect(call(suspendCall(other))).toMatchObject({ ok: true });
    expect(attest(other, second, cal, "attended", 0)).toMatchObject({ ok: false });
    expect(rows(crew)).toBe("0");
    expect(rows(second)).toBe("0");
  });

  it("after the close only an audited moderator corrects, never a host of that crew, and the record says so", () => {
    const host = person(), cohost = person(), ana = person();
    mutual(host, cohost);
    const crew = tonight(host, [cohost, ana]);
    makeCohost(crew, cohost);
    expect(attest(host, crew, ana, "attended", 0)).toMatchObject({ revision: 1 });
    startsIn(crew, "-13 hours");
    expect(attest(host, crew, ana, "absent", 1)).toEqual({ ok: false, code: "closed" });
    expect(correct(crew, ana, "absent", 1, STAFF_ROLE, "no")).toEqual({ ok: false, code: "invalid" });
    expect(correct(crew, ana, "absent", 0)).toEqual({ ok: false, code: "stale" });
    expect(() => correct(crew, ana, "absent", 1, "a2479999-0000-4000-8000-000000000000")).toThrow(/staff required/);
    db().sql(`insert into public.private_social_staff_roles(id,profile_id,display_name,role) values ('${SECOND_STAFF}','${cohost.profile}','Cohost moderator','moderator')`);
    expect(correct(crew, ana, "absent", 1, SECOND_STAFF)).toEqual({ ok: false, code: "forbidden" });
    const done = correct(crew, ana, "absent", 1);
    expect(done).toMatchObject({ ok: true, code: "corrected", revision: 2, state: "absent" });
    expect(item(host, crew, ana)).toMatchObject({ state: "absent", revision: 2, recordedBy: "moderator" });
    expect(db().sql(`select actor_kind||'|'||staff_role_id||'|'||staff_display_name||'|'||reason from public.social_crew_attendance
      where id='${String(done.auditId)}'`)).toBe(`moderator|${STAFF_ROLE}|Moderator|Host marked the wrong person`);
    expect(correct(crew, ana, "absent", 2)).toMatchObject({ ok: true, code: "unchanged", revision: 2 });
  });

  it("a moderator who is the participant cannot correct their own record", () => {
    const host = person(), ana = person();
    const crew = tonight(host, [ana, moderator]);
    expect(attest(host, crew, moderator, "absent", 0)).toMatchObject({ revision: 1 });
    expect(correct(crew, moderator, "attended", 1)).toEqual({ ok: false, code: "forbidden" });
    expect(attest(host, crew, ana, "attended", 0)).toMatchObject({ revision: 1 });
  });

  it("records and corrections expire 30 days after the close: reads deny them before any sweep", () => {
    const host = person(), ana = person();
    const crew = tonight(host, [ana]);
    expect(attest(host, crew, ana, "attended", 0)).toMatchObject({ revision: 1 });
    expect(db().sql(`select (expires_at = plan.start_time + interval '12 hours' + interval '30 days')::text
      from public.social_crew_attendance attendance join public.social_crews crew on crew.id=attendance.crew_id
      join public.plans plan on plan.id=crew.plan_id where attendance.crew_id='${crew}'`)).toBe("true");
    expect(exported(ana)).toHaveLength(1);
    startsIn(crew, "-30 days -12 hours");
    db().sql(`update public.social_crew_attendance set expires_at=now()-interval '1 second' where crew_id='${crew}'`);
    expect(item(host, crew, ana)).toMatchObject({ state: null, revision: 0 });
    expect(read(ana, crew)?.items).toEqual([]);
    expect(exported(ana)).toEqual([]);
    expect(correct(crew, ana, "absent", 1)).toEqual({ ok: false, code: "expired" });
    expect(rows(crew)).toBe("1");
  });

  it("the cleanup deletes only expired rows, in bounded batches of at most 1,000", () => {
    db().sql("delete from public.social_crew_attendance");
    const host = person(), ana = person(), bea = person();
    const crew = tonight(host, [ana, bea]);
    expect(attest(host, crew, ana, "attended", 0)).toMatchObject({ revision: 1 });
    expect(attest(host, crew, ana, "absent", 1)).toMatchObject({ revision: 2 });
    expect(attest(host, crew, bea, "attended", 0)).toMatchObject({ revision: 1 });
    db().sql(`update public.social_crew_attendance set expires_at=now()-interval '1 minute' where subject_account_id='${ana.account}'`);
    expect(purge(1)).toEqual({ ok: true, deleted: 1 });
    expect(purge(5000)).toEqual({ ok: true, deleted: 1 });
    expect(purge(1000)).toEqual({ ok: true, deleted: 0 });
    expect(rows(crew)).toBe("1");
    db().sql(`insert into public.social_crew_attendance(crew_id,subject_account_id,subject_user_id,revision,state,actor_kind,attester_account_id,expires_at)
      select '${crew}','${bea.account}','${bea.user}',revision,'attended','host','${host.account}',now()-interval '1 minute'
      from generate_series(2,1201) revision`);
    expect(purge(5000)).toEqual({ ok: true, deleted: 1000 });
    expect(purge(5000)).toEqual({ ok: true, deleted: 200 });
    expect(rows(crew)).toBe("1");
  });

  it("deleting the participant's account removes their records in the same transaction", async () => {
    const host = person(), ana = person();
    const crew = tonight(host, [ana]);
    expect(attest(host, crew, ana, "attended", 0)).toMatchObject({ revision: 1 });
    const held = await hold(deleteAccount(ana), "postgres");
    try {
      expect(await db().sqlAsync(`select count(*) from public.social_crew_attendance where crew_id='${crew}'`)).toBe("1");
    } finally { await held.finish(); }
    expect(rows(crew)).toBe("0");
  });

  it("two corrections from the same revision: the second waits and then answers stale", async () => {
    const host = person(), cohost = person(), ana = person();
    mutual(host, cohost);
    const crew = tonight(host, [cohost, ana]);
    makeCohost(crew, cohost);
    expect(attest(host, crew, ana, "attended", 0)).toMatchObject({ revision: 1 });
    const first = await holdRpc(attestCall(host, crew, ana, "absent", 1));
    let second: Promise<{ ok: boolean; said: string }>;
    try {
      expect(first.result).toMatchObject({ ok: true, revision: 2 });
      second = outcome("attendance_second_correction", rpc(attestCall(cohost, crew, ana, "attended", 1)));
      await expect.poll(() => waitsOnAnyLock("attendance_second_correction")).toBe("t");
    } finally { await first.finish(); }
    const answer = await second!;
    expect(answer.ok, answer.said).toBe(true);
    expect(json(answer.said)).toEqual({ ok: false, code: "stale" });
    expect(rows(crew, ana)).toBe("2");
  });

  it("a block that commits while the attestation waits on the account locks is honoured", async () => {
    const host = person(), ana = person();
    const crew = tonight(host, [ana]);
    const blocked = await hold(rpc(blockCall(ana, host)));
    let pending: Promise<{ ok: boolean; said: string }>;
    try {
      pending = outcome("attendance_after_block", rpc(attestCall(host, crew, ana, "attended", 0)));
      await expect.poll(() => waitsOnAccountLock("attendance_after_block")).toBe("t");
    } finally { await blocked.finish(); }
    const answer = await pending!;
    expect(answer.ok, answer.said).toBe(true);
    expect(json(answer.said)).toEqual(NOT_FOUND);
    expect(rows(crew)).toBe("0");
  });

  it("a suspension waits for an attestation in flight, and later marks are refused", async () => {
    const host = person(), ana = person(), bea = person();
    const crew = tonight(host, [ana, bea]);
    const marked = await holdRpc(attestCall(host, crew, ana, "attended", 0));
    let suspension: Promise<{ ok: boolean; said: string }>;
    try {
      expect(marked.result).toMatchObject({ ok: true, revision: 1 });
      suspension = outcome("attendance_suspension", rpc(suspendCall(ana)));
      await expect.poll(() => waitsOnAccountLock("attendance_suspension")).toBe("t");
    } finally { await marked.finish(); }
    const answer = await suspension!;
    expect(answer.ok, answer.said).toBe(true);
    expect(attest(host, crew, ana, "absent", 1)).toEqual(NOT_FOUND);
  });

  it("a removal in flight makes the attestation wait on the crew, then refuse", async () => {
    const host = person(), ana = person();
    const crew = tonight(host, [ana]);
    const removal = await holdRpc(`remove_social_crew_member_atomic('${host.account}','${crew}','${memberId(crew, ana)}','${key()}','${DIGEST}')`);
    let pending: Promise<{ ok: boolean; said: string }>;
    try {
      expect(removal.result).toMatchObject({ ok: true });
      pending = outcome("attendance_after_removal", rpc(attestCall(host, crew, ana, "attended", 0)));
      await expect.poll(() => waitsOnAnyLock("attendance_after_removal")).toBe("t");
    } finally { await removal.finish(); }
    const answer = await pending!;
    expect(answer.ok, answer.said).toBe(true);
    expect(json(answer.said)).toEqual(NOT_FOUND);
  });

  it("an account deletion in flight and an attestation of that person finish without a deadlock", async () => {
    const host = person(), ana = person();
    const crew = tonight(host, [ana]);
    const deletion = await hold(deleteAccount(ana), "postgres");
    let pending: Promise<{ ok: boolean; said: string }>;
    try {
      pending = outcome("attendance_after_deletion", rpc(attestCall(host, crew, ana, "attended", 0)));
      await expect.poll(() => waitsOnAnyLock("attendance_after_deletion")).toBe("t");
    } finally { await deletion.finish(); }
    const answer = await pending!;
    expect(answer.ok, answer.said).toBe(true);
    expect(answer.said).not.toMatch(REFUSED_BY_LOCKS);
    expect(json(answer.said)).toEqual(NOT_FOUND);
    expect(rows(crew)).toBe("0");
  });

  it("only the service role calls the four entry points, and no browser role reads the table", () => {
    const entries = [
      "public.attest_social_crew_attendance_atomic(uuid,uuid,uuid,text,integer,text,text)",
      "public.correct_social_crew_attendance_admin(uuid,uuid,uuid,text,integer,text)",
      "public.read_social_crew_attendance(uuid,uuid,uuid)",
      "public.export_social_crew_attendance(uuid,integer)",
      "public.purge_expired_social_crew_attendance(integer)",
    ];
    for (const entry of entries) {
      for (const role of ["anon", "authenticated"]) {
        expect(db().sql(`select has_function_privilege('${role}','${entry}','execute')`), `${role} ${entry}`).toBe("f");
      }
      expect(db().sql(`select has_function_privilege('service_role','${entry}','execute')`), entry).toBe("t");
    }
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(db().sql(`select has_table_privilege('${role}','public.social_crew_attendance','select,insert,update,delete')`), role).toBe("f");
    }
    expect(db().sql("select relrowsecurity::text from pg_class where oid='public.social_crew_attendance'::regclass")).toBe("true");
  });

  it("rollback stops while records exist, drops them only on the exact acknowledgement, and reapplying works", async () => {
    const host = person(), ana = person();
    const crew = tonight(host, [ana]);
    expect(attest(host, crew, ana, "attended", 0)).toMatchObject({ revision: 1 });
    const refused = await rollback();
    expect(refused.ok).toBe(false);
    expect(refused.said).toMatch(/would drop \d+ crew attendance records/);
    expect(await rollback("0:wrong")).toMatchObject({ ok: false });
    const count = db().sql("select count(*) from public.social_crew_attendance");
    expect(await rollback(count)).toMatchObject({ ok: true });
    expect(db().sql("select to_regclass('public.social_crew_attendance') is null")).toBe("t");
    expect(db().sql("select to_regprocedure('public.read_social_crew_attendance(uuid,uuid,uuid)') is null")).toBe("t");
    applyForward();
    expect(attest(host, crew, ana, "attended", 0)).toMatchObject({ ok: true, revision: 1 });
  });
});
