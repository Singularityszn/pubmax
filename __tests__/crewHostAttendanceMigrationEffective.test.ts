// Migration 0247 on a real PostgreSQL replay, applied after 0245 and 0246 by the
// migration role of the permission replica. An authorised host marks an accepted
// participant of the same night. A correction names the revision it replaces. After
// the 12-hour close only an audited moderator who is not a host of that crew corrects
// it. Records and their corrections expire 30 days after the close.

import { execFile, execFileSync } from "node:child_process";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asServiceRole, postgresSkipReason } from "./helpers/postgres";
import { moderatorDuringInterruption, type StaffInterruption } from "./helpers/crewModeratorAuthorityHarness";
import {
  type Person,
  admit,
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
  leave,
  remove,
  request,
  rpc,
  state,
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
const receiptsAbout = (who: Person) =>
  db().sql(`select count(*) from public.private_social_crew_write_receipts where subject_user_id='${who.user}'`);
/** Time passes beyond the 30 days: the marks and the receipts about them expire. */
const expireNight = (crew: string) => db().sql(`update public.social_crew_attendance set expires_at=now()-interval '1 second'
  where crew_id='${crew}'; update public.private_social_crew_write_receipts set expires_at=now()-interval '1 second'
  where operation='attendance:${crew}'`);
const setRoleCall = (owner: Person, crew: string, who: Person, role: "cohost" | "member") =>
  `set_social_crew_role_atomic('${owner.account}','${crew}','${memberId(crew, who)}','${role}','${key()}','${DIGEST}')`;
let staffRoles = 0;
function staffRoleFor(who: Person) {
  const id = `a2478888-0000-4000-8000-${String(100 + ++staffRoles).padStart(12, "0")}`;
  db().sql(`insert into public.private_social_staff_roles(id,profile_id,display_name,role) values ('${id}','${who.profile}','Moderator ${staffRoles}','moderator')`);
  return id;
}
/** The runbook's operator query: the member's current unexpired revision and mark. */
const operatorMark = (crew: string, member: string) => db().sql(operatorQuery(crew, member));
const operatorQuery = (crew: string, member: string) => `select member.state||'|'||coalesce(mark.revision,0)||'|'||coalesce(mark.state,'none')
  from public.social_crew_members member
  left join lateral (
    select attendance.revision, attendance.state from public.social_crew_attendance attendance
    where attendance.crew_id = member.crew_id and attendance.subject_account_id = member.social_account_id
      and attendance.expires_at > now()
    order by attendance.revision desc limit 1
  ) mark on true
  where member.crew_id = '${crew}' and member.id = '${member}'`;

/** The guest reports the mark they read: the night and the revision. */
const reportCall = (who: Person, crew: string, revision: number) =>
  `report_social_crew_attendance('${who.account}','${who.profile}','${crew}',${revision})`;
const reportMark = (who: Person, crew: string, revision: number) => call(reportCall(who, crew, revision));
/** A statement on its own connection, and whether it has answered yet. */
function tracked(application: string, statement: string) {
  let settled = false;
  const answer = outcome(application, statement).finally(() => { settled = true; });
  return { answer, waitsOrAnswered: async () => settled || await waitsOnAnyLock(application) === "t" };
}
/** A night closed an hour ago: the host marked the guest, then a moderator changed it to revision 2. */
function correctedByModerator() {
  const host = person(), ana = person();
  const crew = tonight(host, [ana]);
  expect(attest(host, crew, ana, "attended", 0)).toMatchObject({ revision: 1 });
  startsIn(crew, "-13 hours");
  const author = staffRoleFor(person());
  expect(correct(crew, ana, "absent", 1, author)).toMatchObject({ ok: true, code: "corrected", revision: 2 });
  return { crew, ana, author };
}
/** The moderator's queue of open attendance reports, as that moderator may read it. */
const reportQueue = (staff = STAFF_ROLE) =>
  JSON.parse(db().sql(asServiceRole(`select public.read_social_crew_attendance_reports_admin('${staff}',50)::text`))) as Array<Record<string, unknown>>;
const reportRows = (crew: string) => db().sql(`select count(*) from public.social_crew_attendance_reports report
  join public.social_crew_attendance mark on mark.id=report.attendance_id where mark.crew_id='${crew}'`);
const handleOf = (who: Person) => db().sql(`select handle from public.profiles where id='${who.profile}'`);

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
    expect(attest(host, crew, cohost, "attended", 0)).toEqual(NOT_FOUND);
    expect(attest(cohost, crew, host, "attended", 0)).toEqual(NOT_FOUND);
    expect(attest(cohost, crew, cohost, "attended", 0)).toEqual(NOT_FOUND);
    expect(item(host, crew, cohost)).toBeUndefined();
    expect(item(cohost, crew, host)).toBeUndefined();
    expect(item(host, crew, ana)).toMatchObject({ revision: 1 });
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

  it.each<StaffInterruption>(["crew-wait", "revocation-commits", "revocation-rolls-back"])(
    "checks current moderator authority after %s", async (interruption) => {
      const host = person(), ana = person();
      const crew = tonight(host, [ana]);
      expect(attest(host, crew, ana, "attended", 0)).toMatchObject({ revision: 1 });
      const staff = staffRoleFor(person());
      const answer = await moderatorDuringInterruption(crew, staff, correctCall(crew, ana, "absent", 1, staff), interruption);
      if (interruption === "revocation-rolls-back") {
        expect(answer.ok).toBe(true);
        expect(item(host, crew, ana)).toMatchObject({ revision: 2, state: "absent" });
      } else {
        expect(answer).toMatchObject({ ok: false, said: expect.stringContaining("staff required") });
        expect(item(host, crew, ana)).toMatchObject({ revision: 1, state: "attended" });
      }
    },
  );

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
    expect(purge(1)).toMatchObject({ ok: true, deleted: 1 });
    expect(purge(5000)).toMatchObject({ ok: true, deleted: 1 });
    expect(purge(1000)).toMatchObject({ ok: true, deleted: 0 });
    expect(rows(crew)).toBe("1");
    db().sql(`insert into public.social_crew_attendance(crew_id,subject_account_id,subject_user_id,revision,state,actor_kind,attester_account_id,expires_at)
      select '${crew}','${bea.account}','${bea.user}',revision,'attended','host','${host.account}',now()-interval '1 minute'
      from generate_series(2,1201) revision`);
    expect(purge(5000)).toMatchObject({ ok: true, deleted: 1000 });
    expect(purge(5000)).toMatchObject({ ok: true, deleted: 200 });
    expect(rows(crew)).toBe("1");
  });

  it("a replayed key answers its stored mark only while that host may still mark that guest", () => {
    const host = person(), cohost = person(), ana = person(), bea = person(), cal = person(), dee = person(), eli = person();
    mutual(host, cohost);
    const crew = tonight(host, [cohost, ana, bea, cal, dee, eli]);
    makeCohost(crew, cohost);
    const used = { ana: key(), bea: key(), cal: key(), dee: key(), eli: key() };
    for (const [who, guest] of [["ana", ana], ["bea", bea], ["cal", cal], ["dee", dee]] as const) {
      expect(attest(host, crew, guest, "attended", 0, used[who])).toMatchObject({ ok: true, code: "attested", revision: 1 });
      expect(attest(host, crew, guest, "attended", 0, used[who])).toMatchObject({ ok: true, code: "replayed", revision: 1 });
    }
    expect(attest(cohost, crew, eli, "absent", 0, used.eli)).toMatchObject({ ok: true, code: "attested" });
    block(ana, host);
    expect(attest(host, crew, ana, "attended", 0, used.ana)).toEqual(NOT_FOUND);
    expect(remove(host, crew, bea)).toMatchObject({ ok: true });
    expect(attest(host, crew, bea, "attended", 0, used.bea)).toEqual(NOT_FOUND);
    expect(call(suspendCall(cal))).toMatchObject({ ok: true });
    expect(attest(host, crew, cal, "attended", 0, used.cal)).toEqual(NOT_FOUND);
    expect(call(setRoleCall(host, crew, cohost, "member"))).toMatchObject({ ok: true });
    expect(attest(cohost, crew, eli, "absent", 0, used.eli)).toEqual(NOT_FOUND);
    startsIn(crew, "-13 hours");
    expect(attest(host, crew, dee, "attended", 0, used.dee)).toMatchObject({ ok: true, code: "replayed", revision: 1 });
    expireNight(crew);
    expect(attest(host, crew, dee, "attended", 0, used.dee)).toEqual({ ok: false, code: "closed" });
  });

  it("a host marks guests only: a promotion that commits while the attestation waits is honoured", async () => {
    const host = person(), ana = person();
    mutual(host, ana);
    const crew = tonight(host, [ana]);
    const promotion = await holdRpc(setRoleCall(host, crew, ana, "cohost"));
    let pending: Promise<{ ok: boolean; said: string }>;
    try {
      expect(promotion.result).toMatchObject({ ok: true });
      pending = outcome("attendance_after_promotion", rpc(attestCall(host, crew, ana, "attended", 0)));
      await expect.poll(() => waitsOnAnyLock("attendance_after_promotion")).toBe("t");
    } finally { await promotion.finish(); }
    const answer = await pending!;
    expect(answer.ok, answer.said).toBe(true);
    expect(json(answer.said)).toEqual(NOT_FOUND);
    expect(rows(crew)).toBe("0");
  });

  it("a moderator who has ever been in that crew, in any role or state, never decides its disputes", () => {
    const host = person(), ana = person(), demoted = person(), plain = person(), departed = person(), rejoined = person();
    mutual(host, demoted);
    const crew = tonight(host, [ana, demoted, plain, departed, rejoined]);
    expect(call(setRoleCall(host, crew, demoted, "cohost"))).toMatchObject({ ok: true, code: "updated" });
    expect(call(setRoleCall(host, crew, demoted, "member"))).toMatchObject({ ok: true, code: "updated" });
    expect(leave(crew, departed)).toMatchObject({ ok: true });
    expect(leave(crew, rejoined)).toMatchObject({ ok: true });
    startsIn(crew, "1 day");
    admit(host, crew, rejoined);
    expect(state(crew, rejoined)).toBe("active");
    startsIn(crew, "-1 hour");
    expect(attest(host, crew, ana, "attended", 0)).toMatchObject({ revision: 1 });
    startsIn(crew, "-13 hours");
    for (const insider of [demoted, plain, departed, rejoined]) {
      expect(correct(crew, ana, "absent", 1, staffRoleFor(insider)), insider.handle).toEqual({ ok: false, code: "forbidden" });
    }
    expect(correct(crew, ana, "absent", 1, staffRoleFor(person()))).toMatchObject({ ok: true, code: "corrected", revision: 2 });
  });

  it("a moderator corrects a mark after a block and a removed guest's mark, and the removal stands", () => {
    const host = person(), ana = person(), bea = person();
    const crew = tonight(host, [ana, bea]);
    const anaMember = memberId(crew, ana), beaMember = memberId(crew, bea);
    expect(attest(host, crew, ana, "attended", 0)).toMatchObject({ revision: 1 });
    expect(attest(host, crew, bea, "attended", 0)).toMatchObject({ revision: 1 });
    block(ana, host);
    expect(read(host, crew)?.items.map((entry) => entry.memberId)).toEqual([beaMember]);
    expect(operatorMark(crew, anaMember)).toBe("active|1|attended");
    // The runbook's session: the queue as the service role, which has no table grant, the
    // direct read after a role reset, then the decision as the service role again.
    const queued = `set role service_role; select public.read_social_crew_attendance_reports_admin('${STAFF_ROLE}',50);`;
    expect(db().expectRefusal(`${queued} ${operatorQuery(crew, anaMember)}`)).toMatch(/permission denied for table social_crew_attendance/);
    const last = (said: string) => said.split("\n").at(-1) ?? "";
    expect(last(db().sql(`${queued} reset role; set role ${MIGRATOR}; ${operatorQuery(crew, anaMember)}`))).toBe("active|1|attended");
    expect(json(last(db().sql(`${queued} reset role; ${operatorQuery(crew, anaMember)}; set role service_role; select public.${correctCall(crew, ana, "absent", 1)}::text`))))
      .toMatchObject({ ok: true, code: "corrected", revision: 2 });
    expect(operatorMark(crew, anaMember)).toBe("active|2|absent");
    expect(remove(host, crew, bea)).toMatchObject({ ok: true });
    expect(operatorMark(crew, beaMember)).toBe("removed|1|attended");
    expect(correct(crew, bea, "absent", 1)).toMatchObject({ ok: true, code: "corrected", revision: 2 });
    expect(state(crew, bea)).toBe("removed");
    expect(operatorMark(crew, beaMember)).toBe("removed|2|absent");
    expireNight(crew);
    expect(operatorMark(crew, beaMember)).toBe("removed|0|none");
  });

  it("a guest reports the mark they read, and an independent moderator reads that night, revision and recorder", () => {
    const host = person(), ana = person();
    const first = tonight(host, [ana]);
    const second = tonight(host, [ana]);
    expect(attest(host, first, ana, "attended", 0)).toMatchObject({ revision: 1 });
    expect(attest(host, second, ana, "absent", 0)).toMatchObject({ revision: 1 });
    expect(reportMark(ana, second, 2)).toEqual({ ok: false, code: "stale" });
    expect(reportMark(host, second, 1)).toEqual(NOT_FOUND);
    expect(reportMark(ana, second, 1)).toEqual({ ok: true, code: "reported", revision: 1 });
    expect(reportMark(ana, second, 1)).toEqual({ ok: true, code: "reported", revision: 1 });
    expect(reportRows(second)).toBe("1");
    const ours = (staff?: string) => reportQueue(staff).filter((entry) => entry.crewId === first || entry.crewId === second);
    expect(ours()).toEqual([expect.objectContaining({
      crewId: second, memberId: memberId(second, ana), memberState: "active", subjectHandle: handleOf(ana),
      disputed: expect.objectContaining({ revision: 1, state: "absent", recordedBy: "host", hostHandle: handleOf(host), staffDisplayName: null }),
      current: { revision: 1, state: "absent" },
    })]);
    expect(Date.parse(String(ours()[0]?.nightStartsAt))).toBe(Date.parse(db().sql(`select to_char(plan.start_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      from public.social_crews crew join public.plans plan on plan.id=crew.plan_id where crew.id='${second}'`)));

    // The first night closes, and a moderator who was never in it changes the mark.
    startsIn(first, "-13 hours");
    const corrector = staffRoleFor(person());
    expect(correct(first, ana, "absent", 1, corrector)).toMatchObject({ ok: true, code: "corrected", revision: 2 });
    expect(read(ana, first)?.items).toEqual([expect.objectContaining({ revision: 2, recordedBy: "moderator" })]);
    expect(reportMark(ana, first, 2)).toEqual({ ok: true, code: "reported", revision: 2 });
    const independent = staffRoleFor(person());
    expect(ours(independent).map((entry) => entry.crewId).sort()).toEqual([first, second].sort());
    expect(ours(independent).find((entry) => entry.crewId === first)).toMatchObject({
      memberId: memberId(first, ana),
      disputed: { revision: 2, state: "absent", recordedBy: "moderator", hostHandle: null,
        staffDisplayName: expect.stringMatching(/^Moderator \d+$/), recordedAt: expect.any(String) },
      current: { revision: 2, state: "absent" },
    });
    // The moderator whose mark is disputed neither reads that report nor decides it.
    expect(ours(corrector).map((entry) => entry.crewId)).toEqual([second]);
    expect(correct(first, ana, "attended", 2, corrector)).toEqual({ ok: false, code: "forbidden" });
    // A host's moderator role and a guest's never read their own crew's reports.
    expect(ours(staffRoleFor(host))).toEqual([]);
    expect(ours(staffRoleFor(ana))).toEqual([]);

    // Deciding closes the report: a change, or keeping the mark as it is.
    expect(correct(first, ana, "attended", 2, independent)).toMatchObject({ ok: true, code: "corrected", revision: 3 });
    expect(correct(second, ana, "absent", 1, independent)).toMatchObject({ ok: true, code: "unchanged", revision: 1 });
    expect(ours(independent)).toEqual([]);
    expect(reportMark(ana, second, 1)).toEqual({ ok: true, code: "decided", revision: 1 });
    expect(ours(independent)).toEqual([]);
    // A report of that moderator's own change goes to yet another moderator.
    expect(reportMark(ana, first, 3)).toEqual({ ok: true, code: "reported", revision: 3 });
    expect(ours(independent)).toEqual([]);
    expect(ours(staffRoleFor(person()))).toEqual([expect.objectContaining({ crewId: first,
      disputed: expect.objectContaining({ revision: 3, recordedBy: "moderator" }) })]);
  });

  it("a report filed while its moderator decides waits, then stays open for another moderator", async () => {
    const { crew, ana, author } = correctedByModerator();
    // The decision reads the night's Plan right after its conflict check, so a lock on the
    // Plan table pauses it there, with the crew row held.
    const paused = await hold("lock table public.plans in access exclusive mode", "postgres");
    let decision: ReturnType<typeof tracked>, report: ReturnType<typeof tracked>;
    try {
      decision = tracked("attendance_decision_first", rpc(correctCall(crew, ana, "absent", 2, author)));
      await expect.poll(() => waitsOnAnyLock("attendance_decision_first")).toBe("t");
      report = tracked("attendance_report_second", rpc(reportCall(ana, crew, 2)));
      await expect.poll(report.waitsOrAnswered).toBe(true);
    } finally { await paused.finish(); }
    const decided = await decision!.answer, filed = await report!.answer;
    expect(decided.ok, decided.said).toBe(true);
    expect(json(decided.said)).toMatchObject({ ok: true, code: "unchanged", revision: 2 });
    expect(filed.ok, filed.said).toBe(true);
    expect(json(filed.said)).toEqual({ ok: true, code: "reported", revision: 2 });
    expect(reportQueue(staffRoleFor(person())).filter((entry) => entry.crewId === crew))
      .toEqual([expect.objectContaining({ disputed: expect.objectContaining({ revision: 2, recordedBy: "moderator" }) })]);
    expect(correct(crew, ana, "attended", 2, author)).toEqual({ ok: false, code: "forbidden" });
  });

  it("a decision that starts while its own mark's report is filed waits, then refuses", async () => {
    const { crew, ana, author } = correctedByModerator();
    const filing = await holdRpc(reportCall(ana, crew, 2));
    let decision: ReturnType<typeof tracked>;
    try {
      expect(filing.result).toEqual({ ok: true, code: "reported", revision: 2 });
      decision = tracked("attendance_decision_second", rpc(correctCall(crew, ana, "attended", 2, author)));
      await expect.poll(decision.waitsOrAnswered).toBe(true);
    } finally { await filing.finish(); }
    const answer = await decision!.answer;
    expect(answer.ok, answer.said).toBe(true);
    expect(json(answer.said)).toEqual({ ok: false, code: "forbidden" });
    expect(rows(crew, ana)).toBe("2");
    expect(reportQueue(staffRoleFor(person())).filter((entry) => entry.crewId === crew))
      .toEqual([expect.objectContaining({ disputed: expect.objectContaining({ revision: 2 }), current: { revision: 2, state: "absent" } })]);
  });

  it("a report goes with the mark: no queue entry after expiry, the cleanup or the guest's account deletion", () => {
    const host = person(), ana = person(), bea = person();
    const crew = tonight(host, [ana]);
    const other = tonight(host, [bea]);
    expect(attest(host, crew, ana, "attended", 0)).toMatchObject({ revision: 1 });
    expect(attest(host, other, bea, "attended", 0)).toMatchObject({ revision: 1 });
    expect(reportMark(ana, crew, 1)).toMatchObject({ ok: true, code: "reported" });
    expect(reportMark(bea, other, 1)).toMatchObject({ ok: true, code: "reported" });
    expect(exported(ana)).toEqual([expect.objectContaining({ revision: 1, reportedAt: expect.any(String) })]);
    const independent = staffRoleFor(person());
    const crews = () => reportQueue(independent).map((entry) => entry.crewId);
    expect(crews()).toEqual(expect.arrayContaining([crew, other]));
    expireNight(crew);
    expect(crews()).not.toContain(crew);
    expect(reportMark(ana, crew, 1)).toEqual(NOT_FOUND);
    expect(reportRows(crew)).toBe("1");
    expect(purge(1000)).toMatchObject({ ok: true });
    expect(reportRows(crew)).toBe("0");
    db().sql(deleteAccount(bea));
    expect(reportRows(other)).toBe("0");
    expect(crews()).not.toContain(other);
  });

  it("the export returns one record past the lane cap, so the account export can say it is truncated", () => {
    const host = person(), ana = person();
    const crew = tonight(host, [ana]);
    db().sql(`insert into public.social_crew_attendance(crew_id,subject_account_id,subject_user_id,revision,state,actor_kind,attester_account_id,expires_at)
      select '${crew}','${ana.account}','${ana.user}',revision,'attended','host','${host.account}',now()+interval '1 day'
      from generate_series(1,1201) revision`);
    expect(JSON.parse(db().sql(asServiceRole(`select jsonb_array_length(public.export_social_crew_attendance('${ana.user}',1001))::text`)))).toBe(1001);
  });

  it("the cleanup also deletes expired receipts about attendance, and leaves live ones", () => {
    const host = person(), ana = person(), bea = person();
    const crew = tonight(host, [ana]);
    const other = tonight(host, [bea]);
    expect(attest(host, crew, ana, "attended", 0)).toMatchObject({ revision: 1 });
    expect(attest(host, other, bea, "attended", 0)).toMatchObject({ revision: 1 });
    expect(receiptsAbout(ana)).toBe("1");
    expireNight(crew);
    expect(purge(1000)).toMatchObject({ ok: true, receipts: expect.any(Number) });
    expect(receiptsAbout(ana)).toBe("0");
    expect(receiptsAbout(bea)).toBe("1");
  });

  it("deleting the participant's account removes their records and the receipts about them in the same transaction", async () => {
    const host = person(), ana = person();
    const crew = tonight(host, [ana]);
    const used = key();
    const member = memberId(crew, ana);
    expect(attest(host, crew, ana, "attended", 0, used)).toMatchObject({ revision: 1 });
    expect(receiptsAbout(ana)).toBe("1");
    const held = await hold(deleteAccount(ana), "postgres");
    try {
      expect(await db().sqlAsync(`select count(*) from public.social_crew_attendance where crew_id='${crew}'`)).toBe("1");
      expect(await db().sqlAsync(`select count(*) from public.private_social_crew_write_receipts where subject_user_id='${ana.user}'`)).toBe("1");
    } finally { await held.finish(); }
    expect(rows(crew)).toBe("0");
    expect(receiptsAbout(ana)).toBe("0");
    expect(call(`attest_social_crew_attendance_atomic('${host.account}','${crew}','${member}','attended',0,'${used}','${DIGEST}')`)).toEqual(NOT_FOUND);
  });

  it("a replay of a guest whose account deletion is in flight waits, then discloses nothing", async () => {
    const host = person(), ana = person();
    const crew = tonight(host, [ana]);
    const used = key();
    const replay = attestCall(host, crew, ana, "attended", 0, used);
    expect(call(replay)).toMatchObject({ ok: true, code: "attested" });
    const deletion = await hold(deleteAccount(ana), "postgres");
    let pending: Promise<{ ok: boolean; said: string }>;
    try {
      pending = outcome("attendance_replay_after_deletion", rpc(replay));
      await expect.poll(() => waitsOnAnyLock("attendance_replay_after_deletion")).toBe("t");
    } finally { await deletion.finish(); }
    const answer = await pending!;
    expect(answer.ok, answer.said).toBe(true);
    expect(answer.said).not.toMatch(REFUSED_BY_LOCKS);
    expect(json(answer.said)).toEqual(NOT_FOUND);
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


  it("rollback stops while records exist, drops them only on the exact acknowledgement, and reapplying works", async () => {
    const host = person(), ana = person();
    const crew = tonight(host, [ana]);
    expect(attest(host, crew, ana, "attended", 0)).toMatchObject({ revision: 1 });
    expect(reportMark(ana, crew, 1)).toMatchObject({ ok: true, code: "reported" });
    const refused = await rollback();
    expect(refused.ok).toBe(false);
    expect(refused.said).toMatch(/would drop \d+ crew attendance records/);
    expect(await rollback("0:wrong")).toMatchObject({ ok: false });
    const count = db().sql("select count(*) from public.social_crew_attendance");
    const others = db().sql("select count(*) from public.private_social_crew_write_receipts where operation not like 'attendance:%'");
    expect(Number(db().sql("select count(*) from public.private_social_crew_write_receipts where operation like 'attendance:%'"))).toBeGreaterThan(0);
    expect(await rollback(count)).toMatchObject({ ok: true });
    expect(db().sql("select count(*) from public.private_social_crew_write_receipts where operation like 'attendance:%'")).toBe("0");
    expect(db().sql("select count(*) from public.private_social_crew_write_receipts where operation not like 'attendance:%'")).toBe(others);
    expect(db().sql(`select count(*) from information_schema.columns where table_name='private_social_crew_write_receipts'
      and column_name in ('subject_user_id','expires_at')`)).toBe("0");
    expect(db().sql("select to_regclass('public.social_crew_attendance') is null")).toBe("t");
    expect(db().sql("select to_regclass('public.social_crew_attendance_reports') is null")).toBe("t");
    expect(db().sql("select to_regprocedure('public.report_social_crew_attendance(uuid,uuid,uuid,integer)') is null")).toBe("t");
    expect(db().sql("select to_regprocedure('public.read_social_crew_attendance(uuid,uuid,uuid)') is null")).toBe("t");
    applyForward();
    expect(attest(host, crew, ana, "attended", 0)).toMatchObject({ ok: true, revision: 1 });
  });
});
