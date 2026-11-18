// Migration 0248 on a real PostgreSQL replay, applied after 0245, 0246 and 0247 by the
// migration role of the permission replica. A block between two accepted members of
// one crew opens one private moderator case. The night continues and both keep their
// places. Only a moderator with no tie to that crew or its two people reads or decides
// the case, and only while it is still live.

import { execFile, execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asServiceRole, postgresSkipReason } from "./helpers/postgres";
import {
  type Person,
  DIGEST,
  MIGRATOR,
  NOT_FOUND,
  NO_CREW,
  REFUSED_BY_LOCKS,
  STAFF_ROLE,
  answerInvitation,
  block,
  blockCall,
  bootCrewAdmissionDatabase,
  call,
  crewWith,
  db,
  decide,
  decideCall,
  deleteAccount,
  hold,
  holdRpc,
  invite,
  key,
  leave,
  leaveCall,
  makeCohost,
  memberId,
  mutual,
  outcome,
  person,
  request,
  revision,
  ROLLBACK_0245_ONLY,
  rollbackOutcome,
  rpc,
  seats,
  state,
  stopCrewAdmissionDatabase,
  suspendCall,
  waiting,
  waitingRpcResult,
  waitsOnAccountLock,
  waitsOnAnyLock,
} from "./helpers/crewAdmissionHarness";

const directory = join(process.cwd(), "supabase/migrations");
/** 0247, then this slice's migration, in label order. */
const LATER = readdirSync(directory).filter((file) => /_024[78]_.*\.sql$/.test(file)).sort();
const FORWARD = "20261117160000_0248_crew_block_cases.sql";
const ROLLBACK = `rollback/${FORWARD.replace(/\.sql$/, "_rollback.sql")}`;

const skipReason = postgresSkipReason();
beforeAll(async () => {
  if (skipReason) return;
  await bootCrewAdmissionDatabase("crew-block-case-0248", "after");
  applyAsMigrator(LATER);
}, 600_000);
afterAll(async () => { await stopCrewAdmissionDatabase(); });

function applyAsMigrator(files: readonly string[]) {
  execFileSync(db().psql, [...db().databaseArgs, "-X", "-q", "-c", `set role ${MIGRATOR}`,
    ...files.flatMap((file) => ["-f", join(directory, file)])], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
function rollback(acknowledgement?: string, application = "rollback_0248") {
  const args = [...db().databaseArgs, "-X", "-q", "-c", `set application_name = '${application}'`, "-c", `set role ${MIGRATOR}`];
  if (acknowledgement !== undefined) args.push("-c", `set pubmax.crew_block_cases_discarded = '${acknowledgement}'`);
  args.push("-f", join(directory, ROLLBACK));
  return new Promise<{ ok: boolean; said: string }>((resolve) => {
    execFile(db().psql, args, { encoding: "utf8" }, (error, _stdout, stderr) => resolve({ ok: !error, said: String(stderr ?? "") }));
  });
}
/** A connection that waits on a lock, or a promise that has already settled. */
function settles<T>(pending: Promise<T>) {
  let settled = false;
  void pending.then(() => { settled = true; }, () => { settled = true; });
  return (application: string) => async () => settled || (await waitsOnAnyLock(application)) === "t";
}

type Party = { memberId: string; handle: string; role: string; joinedAt: string; blocksOther: boolean };
type BlockCase = { caseId: string; crewId: string; openedAt: string; nightStartsAt: string; expiresAt: string; people: [Party, Party] };
/** Who blocks whom now, as "blocker>blocked" handles. */
const directions = ({ people: [first, second] }: BlockCase) => [
  ...(first.blocksOther ? [`${first.handle}>${second.handle}`] : []),
  ...(second.blocksOther ? [`${second.handle}>${first.handle}`] : []),
].sort();
const arrow = (from: Person, to: Person) => `${from.handle}>${to.handle}`;
const unblock = (blocker: Person, blocked: Person) =>
  call(`set_social_block('${blocker.profile}','${blocked.profile}',false)`);
const queueCall = (staff = STAFF_ROLE) => `read_social_crew_block_cases_admin('${staff}',50)`;
const queue = (staff = STAFF_ROLE) => JSON.parse(db().sql(asServiceRole(rpc(queueCall(staff))))) as BlockCase[];
const casesIn = (crew: string, staff?: string) => queue(staff).filter((entry) => entry.crewId === crew);
const onlyCase = (crew: string) => {
  const [only, ...more] = casesIn(crew);
  expect(more).toEqual([]);
  if (!only) throw new Error("The crew has no open case.");
  return only.caseId;
};
type Decision = "kept" | "removed" | "paused";
const decideCaseCall = (caseId: string, decision: Decision, member: string | null = null, staff = STAFF_ROLE,
  reason = "Reviewed before the night") =>
  `decide_social_crew_block_case_admin('${staff}','${caseId}','${decision}',${member ? `'${member}'` : "null"},'${reason}')`;
const decideCase = (caseId: string, decision: Decision, member?: string | null, staff?: string, reason?: string) =>
  call(decideCaseCall(caseId, decision, member ?? null, staff, reason));
const purge = (limit: number) => call(`purge_expired_social_crew_block_cases(${limit})`);
const caseRows = (crew: string) => db().sql(`select count(*) from public.social_crew_block_cases where crew_id='${crew}'`);
const openRows = (crew: string) =>
  db().sql(`select count(*) from public.social_crew_block_cases where crew_id='${crew}' and decided_at is null`);
const allRows = () => db().sql("select count(*) from public.social_crew_block_cases");
const seatOpen = (crew: string, who: Person) => db().sql(`select (seat.membership_revoked_at is null)::text
  from public.social_crew_members member join public.plan_crew_members seat on seat.id=member.plan_member_id
  where member.crew_id='${crew}' and member.social_account_id='${who.account}'`);
const planOf = (crew: string) => db().sql(`select plan_id from public.social_crews where id='${crew}'`);
const planStatus = (crew: string) => db().sql(`select status from public.plans where id='${planOf(crew)}'`);
const startsIn = (crew: string, interval: string) =>
  db().sql(`update public.plans set start_time=now()+interval '${interval}' where id='${planOf(crew)}'`);
const operatorDelete = (plan: string) => `select id from public.social_crews where plan_id='${plan}' for update;
  select id from public.plans where id='${plan}' for update;
  delete from public.plans where id='${plan}'`;
const acceptInvitationCall = (who: Person, crew: string, invitation: string) =>
  `accept_social_crew_invitation_atomic('${who.account}','${crew}','${invitation}','accepted','${key()}','${DIGEST}')`;
let staffRoles = 0;
function staffRoleFor(who: Person) {
  const id = `a2488888-0000-4000-8000-${String(100 + ++staffRoles).padStart(12, "0")}`;
  db().sql(`insert into public.private_social_staff_roles(id,profile_id,display_name,role) values ('${id}','${who.profile}','Moderator ${staffRoles}','moderator')`);
  return id;
}
/** A crew with its host and two accepted guests, and Ana's block of Bea after both were accepted. */
function blockedPair() {
  const host = person(), ana = person(), bea = person();
  const crew = crewWith(host, [ana, bea]);
  expect(block(ana, bea)).toBe(true);
  return { host, ana, bea, crew };
}

describe.skipIf(skipReason !== null)("0248: a block between accepted members opens a private moderator case", () => {
  it("opens one case, and the night, both places, both seats and the roster revision stay as they were", () => {
    const host = person(), ana = person(), bea = person();
    const crew = crewWith(host, [ana, bea]);
    const before = revision(crew);
    expect(block(ana, bea)).toBe(true);
    for (const who of [ana, bea]) {
      expect(state(crew, who)).toBe("active");
      expect(seats(crew, who)).toBe("1|1");
      expect(seatOpen(crew, who)).toBe("true");
    }
    expect(revision(crew)).toBe(before);
    expect(planStatus(crew)).toBe("ready");
    expect(casesIn(crew)).toEqual([expect.objectContaining({
      crewId: crew,
      people: [
        expect.objectContaining({ memberId: memberId(crew, ana), handle: ana.handle, role: "member", blocksOther: true }),
        expect.objectContaining({ memberId: memberId(crew, bea), handle: bea.handle, role: "member", blocksOther: false }),
      ],
    })]);
  });

  it("the queue says who blocks whom now: after Ana blocks Bea, Bea blocks Ana and Ana unblocks, only Bea blocks", () => {
    const { ana, bea, crew } = blockedPair();
    expect(block(bea, ana)).toBe(true);
    expect(casesIn(crew).map(directions)).toEqual([[arrow(ana, bea), arrow(bea, ana)].sort()]);
    expect(unblock(ana, bea)).toBe(true);
    const [entry, ...more] = casesIn(crew);
    expect(more).toEqual([]);
    expect(entry?.people.map((party) => party.handle)).toEqual([ana.handle, bea.handle]);
    expect(entry && directions(entry)).toEqual([arrow(bea, ana)]);
  });

  it("the same block again, the reverse block and a moved block keep one open case per crew, and each shared crew gets its own", () => {
    const host = person(), other = person(), ana = person(), bea = person(), cal = person(), dee = person();
    const crew = crewWith(host, [ana, bea]);
    const second = crewWith(other, [ana, bea, cal]);
    block(ana, bea);
    block(ana, bea);
    block(bea, ana);
    block(cal, dee);
    db().sql(`update public.social_blocks set blocked_profile_id='${ana.profile}'
      where blocker_profile_id='${cal.profile}' and blocked_profile_id='${dee.profile}'`);
    expect(openRows(crew)).toBe("1");
    expect(openRows(second)).toBe("2");
    expect(casesIn(second).map(directions).sort())
      .toEqual([[arrow(ana, bea), arrow(bea, ana)].sort(), [arrow(cal, ana)]].sort());
  });

  it("opens no case for a block with someone outside the crew or still pending, or on a cancelled or closed night", () => {
    const host = person(), ana = person(), bea = person(), xav = person(), out = person();
    const crew = crewWith(host, [ana, bea]);
    expect(request(xav, crew)).toMatchObject({ ok: true, code: "requested" });
    block(ana, xav);
    block(out, ana);
    expect(caseRows(crew)).toBe("0");
    const cal = person(), dee = person();
    const cancelled = crewWith(host, [cal, dee]);
    db().sql(`update public.plans set status='abandoned' where id='${planOf(cancelled)}'`);
    block(cal, dee);
    expect(caseRows(cancelled)).toBe("0");
    const eve = person(), fay = person();
    const closed = crewWith(host, [eve, fay]);
    startsIn(closed, "-13 hours");
    block(eve, fay);
    expect(caseRows(closed)).toBe("0");
  });

  it("a later candidate blocked either way with an accepted member is refused neutrally on every path, also on a fresh key while pending", () => {
    const host = person(), ana = person(), xav = person(), yan = person(), zed = person();
    mutual(host, yan);
    mutual(host, zed);
    const crew = crewWith(host, [ana]);
    const asked = request(xav, crew).request_id as string;
    const pending = invite(host, crew, zed).invitation_id as string;
    block(xav, ana);
    block(ana, zed);
    block(ana, yan);
    expect(request(xav, crew)).toEqual(NOT_FOUND);
    expect(decide(host, crew, asked)).toEqual(NOT_FOUND);
    expect(invite(host, crew, yan)).toEqual(NOT_FOUND);
    expect(answerInvitation(zed, crew, pending, "accepted")).toEqual(NOT_FOUND);
    for (const who of [xav, yan, zed]) expect(state(crew, who)).toBe("none");
    expect(caseRows(crew)).toBe("0");
  });

  it("the blocker's Leave releases only their own place and seat, the case leaves the queue, and the earlier member keeps priority", () => {
    const { ana, bea, crew } = blockedPair();
    onlyCase(crew);
    expect(leave(crew, ana)).toMatchObject({ ok: true, code: "left" });
    expect(state(crew, ana)).toBe("left");
    expect(seatOpen(crew, ana)).toBe("false");
    expect(state(crew, bea)).toBe("active");
    expect(seatOpen(crew, bea)).toBe("true");
    expect(casesIn(crew)).toEqual([]);
    expect(request(ana, crew)).toEqual(NOT_FOUND);
  });

  it("only a moderator with no place, request, invitation or block tied to that crew or its two people reads or decides its case", () => {
    const host = person(), cohost = person(), ana = person(), bea = person(), former = person();
    const candidate = person(), invitee = person(), blocksAna = person(), blockedByBea = person();
    mutual(host, cohost);
    mutual(host, invitee);
    const crew = crewWith(host, [cohost, ana, bea, former]);
    makeCohost(crew, cohost);
    leave(crew, former);
    expect(request(candidate, crew)).toMatchObject({ ok: true, code: "requested" });
    expect(invite(host, crew, invitee)).toMatchObject({ ok: true });
    block(ana, bea);
    block(blocksAna, ana);
    block(bea, blockedByBea);
    const caseId = onlyCase(crew);
    for (const insider of [host, cohost, ana, bea, former, candidate, invitee, blocksAna, blockedByBea]) {
      const staff = staffRoleFor(insider);
      expect(casesIn(crew, staff)).toEqual([]);
      expect(decideCase(caseId, "kept", null, staff)).toEqual({ ok: false, code: "forbidden" });
    }
    expect(openRows(crew)).toBe("1");
    expect(casesIn(crew)).toHaveLength(1);
  });

  it("a moderator keeps both places with a reason, a replay answers unchanged, and bad input changes nothing", () => {
    const { ana, bea, crew } = blockedPair();
    const caseId = onlyCase(crew);
    expect(decideCase(caseId, "kept", null, STAFF_ROLE, "x")).toEqual({ ok: false, code: "invalid" });
    expect(decideCase(caseId, "paused")).toEqual({ ok: false, code: "invalid" });
    expect(decideCase(caseId, "kept", memberId(crew, bea))).toEqual({ ok: false, code: "invalid" });
    expect(decideCase(caseId, "removed")).toEqual({ ok: false, code: "invalid" });
    expect(decideCase(NO_CREW, "kept")).toEqual(NOT_FOUND);
    expect(() => decideCase(caseId, "kept", null, NO_CREW)).toThrow(/staff required/);
    expect(() => queue(NO_CREW)).toThrow(/staff required/);
    expect(openRows(crew)).toBe("1");
    expect(decideCase(caseId, "kept")).toEqual({ ok: true, code: "decided", decision: "kept" });
    expect(decideCase(caseId, "kept")).toEqual({ ok: true, code: "unchanged", decision: "kept" });
    expect(decideCase(caseId, "removed", memberId(crew, bea))).toEqual({ ok: false, code: "already_decided", decision: "kept" });
    expect(state(crew, ana)).toBe("active");
    expect(state(crew, bea)).toBe("active");
    expect(casesIn(crew)).toEqual([]);
    expect(leave(crew, ana)).toMatchObject({ ok: true, code: "left" });
    expect(decideCase(caseId, "kept", null, STAFF_ROLE, "Asked again")).toEqual({ ok: true, code: "unchanged", decision: "kept" });
  });

  it("a moderator removal takes that guest's place and seat and bars that crew, and never removes the owner or an outsider", () => {
    const { host, ana, bea, crew } = blockedPair();
    const caseId = onlyCase(crew);
    const before = Number(revision(crew));
    expect(decideCase(caseId, "removed", memberId(crew, host))).toEqual({ ok: false, code: "invalid" });
    expect(decideCase(caseId, "removed", NO_CREW)).toEqual({ ok: false, code: "invalid" });
    expect(decideCase(caseId, "removed", memberId(crew, bea))).toEqual({ ok: true, code: "decided", decision: "removed" });
    expect(state(crew, bea)).toBe("removed");
    expect(seatOpen(crew, bea)).toBe("false");
    expect(Number(revision(crew))).toBe(before + 1);
    expect(state(crew, ana)).toBe("active");
    expect(request(bea, crew)).toEqual(NOT_FOUND);
    expect(decideCase(caseId, "removed", memberId(crew, bea))).toEqual({ ok: true, code: "unchanged", decision: "removed" });
    expect(decideCase(caseId, "removed", memberId(crew, ana))).toEqual({ ok: false, code: "already_decided", decision: "removed" });
    expect(decideCase(caseId, "kept")).toEqual({ ok: false, code: "already_decided", decision: "removed" });
    expect(state(crew, ana)).toBe("active");
    expect(Number(revision(crew))).toBe(before + 1);
    const guest = person();
    mutual(host, guest);
    const ownerCrew = crewWith(host, [guest]);
    block(guest, host);
    expect(decideCase(onlyCase(ownerCrew), "removed", memberId(ownerCrew, host))).toEqual({ ok: false, code: "invalid" });
    expect(state(ownerCrew, host)).toBe("active");
  });

  it("after either Leave, an unblock, a cancellation or the close, a cached case decides nothing and removes nobody", () => {
    const changes: ((pair: ReturnType<typeof blockedPair>) => void)[] = [
      ({ ana, crew }) => expect(leave(crew, ana)).toMatchObject({ ok: true, code: "left" }),
      ({ bea, crew }) => expect(leave(crew, bea)).toMatchObject({ ok: true, code: "left" }),
      ({ ana, bea }) => expect(unblock(ana, bea)).toBe(true),
      ({ crew }) => db().sql(`update public.plans set status='abandoned' where id='${planOf(crew)}'`),
      ({ crew }) => startsIn(crew, "-13 hours"),
    ];
    for (const change of changes) {
      const pair = blockedPair();
      const caseId = onlyCase(pair.crew);
      const targets = [memberId(pair.crew, pair.ana), memberId(pair.crew, pair.bea)];
      const before = revision(pair.crew);
      const states = () => [state(pair.crew, pair.ana), state(pair.crew, pair.bea)];
      const kept = states();
      change(pair);
      const changed = states();
      for (const target of targets) expect(decideCase(caseId, "removed", target)).toEqual({ ok: false, code: "stale" });
      expect(decideCase(caseId, "kept")).toEqual({ ok: false, code: "stale" });
      expect(states()).toEqual(changed);
      expect(kept).toEqual(["active", "active"]);
      expect(openRows(pair.crew)).toBe("1");
      if (changed.every((value) => value === "active")) expect(revision(pair.crew)).toBe(before);
    }
  });

  it("a new block after a decision opens a new case", () => {
    const { ana, bea, crew } = blockedPair();
    expect(decideCase(onlyCase(crew), "kept")).toMatchObject({ ok: true, code: "decided" });
    expect(block(bea, ana)).toBe(true);
    expect(openRows(crew)).toBe("1");
    expect(caseRows(crew)).toBe("2");
  });

  it("a suspended participant's case stays with the moderator, and deleting either account or the crew's Plan deletes its cases at once", async () => {
    const first = blockedPair();
    db().sql(asServiceRole(`select public.${suspendCall(first.bea)}`));
    expect(casesIn(first.crew)).toHaveLength(1);
    db().sql(deleteAccount(first.ana));
    expect(caseRows(first.crew)).toBe("0");
    const second = blockedPair();
    db().sql(deleteAccount(second.bea));
    expect(caseRows(second.crew)).toBe("0");
    const third = blockedPair();
    const deleted = await outcome("operator_plan_delete_0248", operatorDelete(planOf(third.crew)), "postgres");
    expect(deleted.ok).toBe(true);
    expect(caseRows(third.crew)).toBe("0");
  });

  it("an expired case leaves the queue and refuses a decision or a replay, and the bounded cleanup deletes it and orphaned rows", () => {
    const { crew } = blockedPair();
    const caseId = onlyCase(crew);
    const decided = blockedPair();
    const decidedId = onlyCase(decided.crew);
    expect(decideCase(decidedId, "kept")).toEqual({ ok: true, code: "decided", decision: "kept" });
    db().sql(`update public.social_crew_block_cases set expires_at=now()-interval '1 second' where crew_id in ('${crew}','${decided.crew}')`);
    expect(casesIn(crew)).toEqual([]);
    expect(decideCase(caseId, "kept")).toEqual({ ok: false, code: "expired" });
    expect(decideCase(decidedId, "kept")).toEqual({ ok: false, code: "expired" });
    db().sql(`insert into public.social_crew_block_cases(crew_id,blocker_account_id,blocked_account_id,expires_at)
      values ('${NO_CREW}','${person().account}','${person().account}',now()+interval '30 days')`);
    expect(purge(2)).toEqual({ ok: true, deleted: 2 });
    expect(purge(1)).toEqual({ ok: true, deleted: 1 });
    expect(purge(1000)).toEqual({ ok: true, deleted: 0 });
    expect(caseRows(crew)).toBe("0");
    expect(caseRows(decided.crew)).toBe("0");
    expect(caseRows(NO_CREW)).toBe("0");
  });

  it("no browser role and not the service role reads the cases, and only the service role runs the moderator calls", () => {
    expect(db().sql(`select relrowsecurity::text from pg_class where oid='public.social_crew_block_cases'::regclass`)).toBe("true");
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(db().sql(`select has_table_privilege('${role}','public.social_crew_block_cases','select,insert,update,delete,truncate,references,trigger')::text`)).toBe("false");
    }
    const callable = ["public.read_social_crew_block_cases_admin(uuid,integer)",
      "public.decide_social_crew_block_case_admin(uuid,uuid,text,uuid,text)",
      "public.purge_expired_social_crew_block_cases(integer)"];
    const internal = ["public._open_social_crew_block_cases()", "public._open_social_crew_block_cases_for(uuid,uuid)", "public._delete_social_crew_block_cases_on_unbind()",
      "public._delete_social_crew_block_cases_with_crew()", "public._social_crew_block_case_moderator_conflicted(uuid,uuid,uuid,uuid)",
      "public._social_crew_block_case_live(uuid,uuid,uuid)"];
    for (const fn of [...callable, ...internal]) {
      for (const role of ["public", "anon", "authenticated"]) {
        const grantee = role === "public" ? "PUBLIC" : role;
        expect(db().sql(`select exists(select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
          where p.oid='${fn}'::regprocedure and acl.privilege_type='EXECUTE'
            and acl.grantee=${grantee === "PUBLIC" ? 0 : `'${grantee}'::regrole`})::text`)).toBe("false");
      }
      expect(db().sql(`select has_function_privilege('service_role','${fn}','execute')::text`)).toBe(String(callable.includes(fn)));
    }
  });
});

describe.skipIf(skipReason !== null)("0248: races and lock order", () => {
  it("an acceptance waits for a block in flight and is refused, and no case opens", async () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    const asked = request(xav, crew);
    const blocker = await holdRpc(blockCall(ana, xav));
    try {
      const acceptance = waitingRpcResult("accept_after_block_0248", decideCall(host, crew, asked.request_id as string));
      await expect.poll(() => waitsOnAccountLock("accept_after_block_0248")).toBe("t");
      await blocker.finish();
      expect(await acceptance).toEqual(NOT_FOUND);
    } finally { await blocker.finish(); }
    expect(state(crew, xav)).toBe("none");
    expect(caseRows(crew)).toBe("0");
  });

  it("a block waits for an acceptance in flight, then opens exactly one case for the guest it admitted", async () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    const asked = request(xav, crew);
    const acceptance = await holdRpc(decideCall(host, crew, asked.request_id as string));
    expect(acceptance.result).toMatchObject({ ok: true, code: "accepted" });
    try {
      const blocking = waitingRpcResult("block_after_accept_0248", blockCall(xav, ana));
      await expect.poll(() => waitsOnAccountLock("block_after_accept_0248")).toBe("t");
      await acceptance.finish();
      expect(await blocking).toBe(true);
    } finally { await acceptance.finish(); }
    expect(state(crew, xav)).toBe("active");
    expect(state(crew, ana)).toBe("active");
    expect(casesIn(crew).map(directions)).toEqual([[arrow(xav, ana)]]);
  });

  it("an invitation acceptance waits for a block in flight and is refused, and no case opens", async () => {
    const host = person(), ana = person(), zed = person();
    mutual(host, zed);
    const crew = crewWith(host, [ana]);
    const invitation = invite(host, crew, zed).invitation_id as string;
    const blocker = await holdRpc(blockCall(zed, ana));
    try {
      const accepting = waitingRpcResult("invite_accept_after_block_0248", acceptInvitationCall(zed, crew, invitation));
      await expect.poll(() => waitsOnAccountLock("invite_accept_after_block_0248")).toBe("t");
      await blocker.finish();
      expect(await accepting).toEqual(NOT_FOUND);
    } finally { await blocker.finish(); }
    expect(state(crew, zed)).toBe("none");
    expect(caseRows(crew)).toBe("0");
  });

  it("a block waits for an invitation acceptance in flight, then opens one case", async () => {
    const host = person(), ana = person(), zed = person();
    mutual(host, zed);
    const crew = crewWith(host, [ana]);
    const invitation = invite(host, crew, zed).invitation_id as string;
    const accepting = await holdRpc(acceptInvitationCall(zed, crew, invitation));
    expect(accepting.result).toMatchObject({ ok: true, code: "accepted" });
    try {
      const blocking = waitingRpcResult("block_after_invite_accept_0248", blockCall(ana, zed));
      await expect.poll(() => waitsOnAccountLock("block_after_invite_accept_0248")).toBe("t");
      await accepting.finish();
      expect(await blocking).toBe(true);
    } finally { await accepting.finish(); }
    expect(state(crew, zed)).toBe("active");
    expect(openRows(crew)).toBe("1");
  });

  it("a block takes no crew row and no auth row, so it lands while admission's crew lock and a deletion's auth rows are held", async () => {
    const host = person(), ana = person(), bea = person();
    const crew = crewWith(host, [ana, bea]);
    const crewRow = await hold(`select 1 from public.social_crews where id='${crew}' for update`, "postgres");
    const authRows = await hold(`select 1 from auth.users where id in ('${ana.user}','${bea.user}') for update`, "postgres");
    try {
      const landed = await outcome("block_beside_held_rows_0248", rpc(blockCall(ana, bea)));
      expect(landed.said).not.toMatch(REFUSED_BY_LOCKS);
      expect(landed.ok).toBe(true);
    } finally {
      await crewRow.finish();
      await authRows.finish();
    }
    expect(openRows(crew)).toBe("1");
  });

  it("a moderator removal waits for the removed guest's deletion in flight, then answers not found with no deadlock", async () => {
    const { bea, crew } = blockedPair();
    const caseId = onlyCase(crew);
    const member = memberId(crew, bea);
    const deletion = await hold(deleteAccount(bea), "postgres");
    try {
      const removing = outcome("remove_after_delete_0248", rpc(decideCaseCall(caseId, "removed", member)));
      await expect.poll(() => waitsOnAnyLock("remove_after_delete_0248")).toBe("t");
      await deletion.finish();
      const answer = await removing;
      expect(answer.said).not.toMatch(REFUSED_BY_LOCKS);
      expect(JSON.parse(answer.said)).toEqual(NOT_FOUND);
    } finally { await deletion.finish(); }
    expect(caseRows(crew)).toBe("0");
  });

  it("a removal held on its member row and the removed guest's deletion never deadlock: the deletion waits on the auth row", async () => {
    const { bea, crew } = blockedPair();
    const caseId = onlyCase(crew);
    const member = memberId(crew, bea);
    const memberRow = await hold(`select 1 from public.social_crew_members where id='${member}' for update`, "postgres");
    let removing: Promise<{ ok: boolean; said: string }> | null = null;
    let deleting: Promise<{ ok: boolean; said: string }> | null = null;
    try {
      removing = outcome("remove_on_member_row_0248", rpc(decideCaseCall(caseId, "removed", member)));
      await expect.poll(() => waitsOnAnyLock("remove_on_member_row_0248")).toBe("t");
      deleting = outcome("delete_during_remove_0248", deleteAccount(bea), "postgres");
      await expect.poll(() => waitsOnAnyLock("delete_during_remove_0248")).toBe("t");
      expect(await db().sqlAsync(`select exists(select 1 from pg_locks lock join pg_stat_activity activity on activity.pid=lock.pid
        where activity.application_name='delete_during_remove_0248' and lock.locktype='tuple'
          and lock.relation='auth.users'::regclass)`)).toBe("t");
    } finally { await memberRow.finish(); }
    const [removed, deleted] = await Promise.all([removing, deleting]);
    for (const answer of [removed, deleted]) expect(answer?.said ?? "").not.toMatch(REFUSED_BY_LOCKS);
    expect(JSON.parse(removed?.said ?? "{}")).toEqual({ ok: true, code: "decided", decision: "removed" });
    expect(deleted?.ok).toBe(true);
    expect(state(crew, bea)).toBe("removed");
    expect(caseRows(crew)).toBe("0");
  });

  it("an account deletion waits for a moderator removal in flight, then deletes the case it decided", async () => {
    const { bea, crew } = blockedPair();
    const removal = await holdRpc(decideCaseCall(onlyCase(crew), "removed", memberId(crew, bea)));
    expect(removal.result).toEqual({ ok: true, code: "decided", decision: "removed" });
    try {
      const deletion = waiting("delete_after_remove_0248", deleteAccount(bea), "postgres");
      await expect.poll(() => waitsOnAnyLock("delete_after_remove_0248")).toBe("t");
      await removal.finish();
      const answer = await deletion;
      expect(answer.said).not.toMatch(REFUSED_BY_LOCKS);
      expect(answer.ok).toBe(true);
    } finally { await removal.finish(); }
    expect(state(crew, bea)).toBe("removed");
    expect(caseRows(crew)).toBe("0");
  });

  it("a reverse block waits for a decision in flight on the same pair, then opens a new case", async () => {
    const { ana, bea, crew } = blockedPair();
    const deciding = await holdRpc(decideCaseCall(onlyCase(crew), "kept"));
    try {
      const blocking = waitingRpcResult("block_after_decision_0248", blockCall(bea, ana));
      await expect.poll(() => waitsOnAnyLock("block_after_decision_0248")).toBe("t");
      await deciding.finish();
      expect(await blocking).toBe(true);
    } finally { await deciding.finish(); }
    expect(openRows(crew)).toBe("1");
    expect(caseRows(crew)).toBe("2");
  });

  it("a removal waits for the blocker's Leave in flight, then answers stale and removes nobody", async () => {
    const { ana, bea, crew } = blockedPair();
    const caseId = onlyCase(crew);
    const target = memberId(crew, bea);
    const leaving = await holdRpc(leaveCall(crew, ana));
    expect(leaving.result).toMatchObject({ ok: true, code: "left" });
    try {
      const removing = waitingRpcResult("remove_after_leave_0248", decideCaseCall(caseId, "removed", target));
      await expect.poll(() => waitsOnAnyLock("remove_after_leave_0248")).toBe("t");
      await leaving.finish();
      expect(await removing).toEqual({ ok: false, code: "stale" });
    } finally { await leaving.finish(); }
    expect(state(crew, ana)).toBe("left");
    expect(state(crew, bea)).toBe("active");
    expect(openRows(crew)).toBe("1");
  });

  it("an unblock in flight does not hold up a removal, which lands first, and once it commits the next decision answers stale", async () => {
    const first = blockedPair(), second = blockedPair();
    const unblocking = await holdRpc(`set_social_block('${first.ana.profile}','${first.bea.profile}',false)`);
    try {
      const removed = await outcome("remove_beside_unblock_0248",
        rpc(decideCaseCall(onlyCase(first.crew), "removed", memberId(first.crew, first.bea))));
      expect(JSON.parse(removed.said)).toEqual({ ok: true, code: "decided", decision: "removed" });
    } finally { await unblocking.finish(); }
    expect(state(first.crew, first.bea)).toBe("removed");
    const caseId = onlyCase(second.crew);
    expect(unblock(second.ana, second.bea)).toBe(true);
    expect(decideCase(caseId, "removed", memberId(second.crew, second.bea))).toEqual({ ok: false, code: "stale" });
    expect(state(second.crew, second.bea)).toBe("active");
  });

  it("a block that lands beside an operator Plan delete leaves no readable case, and the cleanup deletes it", async () => {
    const host = person(), ana = person(), bea = person();
    const crew = crewWith(host, [ana, bea]);
    const blocking = await holdRpc(blockCall(ana, bea));
    try {
      const deleted = await outcome("plan_delete_beside_block_0248", operatorDelete(planOf(crew)), "postgres");
      expect(deleted.said).not.toMatch(REFUSED_BY_LOCKS);
      expect(deleted.ok).toBe(true);
    } finally { await blocking.finish(); }
    expect(casesIn(crew)).toEqual([]);
    expect(decideCase(db().sql(`select id from public.social_crew_block_cases where crew_id='${crew}'`), "kept")).toEqual(NOT_FOUND);
    expect(purge(1000)).toMatchObject({ ok: true });
    expect(caseRows(crew)).toBe("0");
  });
});

describe.skipIf(skipReason !== null)("0248: rollback", () => {
  it("stops while cases exist unless their exact count is acknowledged, drops everything, and reapplying reopens cases for blocks that still stand", async () => {
    const { ana, bea, crew } = blockedPair();
    const rows = allRows();
    expect(Number(rows)).toBeGreaterThan(0);
    const refused = await rollback();
    expect(refused.ok).toBe(false);
    expect(refused.said).toContain(`would drop ${rows} crew block cases`);
    expect(allRows()).toBe(rows);
    const rolled = await rollback(rows);
    expect(rolled.ok).toBe(true);
    expect(db().sql("select coalesce(to_regclass('public.social_crew_block_cases')::text,'gone')")).toBe("gone");
    expect(db().sql(`select count(*) from pg_proc where proname like '%social_crew_block_case%'`)).toBe("0");
    expect(db().sql(`select count(*) from pg_trigger where tgname in ('social_blocks_open_crew_cases',
      'social_account_unbind_deletes_crew_block_cases','social_crews_delete_block_cases')`)).toBe("0");
    const later = blockedPair();
    expect(state(later.crew, later.bea)).toBe("active");
    applyAsMigrator([FORWARD]);
    expect(openRows(crew)).toBe("1");
    expect(openRows(later.crew)).toBe("1");
    expect(casesIn(crew).map(directions)).toEqual([[arrow(ana, bea)]]);
  });

  it("refuses at once while a writer holds a trigger table, so a Plan delete beside it never deadlocks, and every object and case stays", async () => {
    const { crew } = blockedPair();
    const other = blockedPair();
    const reader = await hold("lock table public.social_blocks in access share mode", "postgres");
    let rolling: Promise<{ ok: boolean; said: string }> | null = null;
    let deleting: Promise<{ ok: boolean; said: string }> | null = null;
    try {
      rolling = rollback(allRows(), "rollback_beside_writer_0248");
      await expect.poll(settles(rolling)("rollback_beside_writer_0248")).toBe(true);
      deleting = outcome("plan_delete_beside_rollback_0248", operatorDelete(planOf(crew)), "postgres");
      await expect.poll(settles(deleting)("plan_delete_beside_rollback_0248")).toBe(true);
    } finally { await reader.finish(); }
    const [rolled, deleted] = await Promise.all([rolling, deleting]);
    for (const answer of [rolled, deleted]) expect(answer?.said ?? "").not.toMatch(REFUSED_BY_LOCKS);
    expect(rolled?.ok).toBe(false);
    expect(rolled?.said).toMatch(/could not obtain lock/);
    expect(deleted?.ok).toBe(true);
    expect(db().sql("select coalesce(to_regclass('public.social_crew_block_cases')::text,'gone')")).toBe("social_crew_block_cases");
    expect(db().sql(`select count(*) from pg_trigger where tgname in ('social_blocks_open_crew_cases',
      'social_account_unbind_deletes_crew_block_cases','social_crews_delete_block_cases')`)).toBe("3");
    expect(caseRows(crew)).toBe("0");
    expect(openRows(other.crew)).toBe("1");
  });

  it("the 0245 rollback refuses while 0248 is applied, even after 0246 is rolled back, and changes nothing", async () => {
    const departure = "20261117140000_0246_crew_departure_release.sql";
    expect((await rollbackOutcome("rollback_0246_under_0248", undefined, [`rollback/${departure.replace(/\.sql$/, "_rollback.sql")}`])).ok).toBe(true);
    try {
      const refused = await rollbackOutcome("rollback_0245_under_0248", undefined, ROLLBACK_0245_ONLY);
      expect(refused.ok).toBe(false);
      expect(refused.said).toMatch(/0248/);
      expect(db().sql(`select count(*) from pg_trigger where tgname='social_blocks_lock_participant_accounts'`)).toBe("1");
      expect(db().sql("select coalesce(to_regprocedure('public.correct_social_crew_removal_admin(uuid,uuid,uuid,text)')::text,'gone')"))
        .not.toBe("gone");
    } finally { applyAsMigrator([departure]); }
    const { crew } = blockedPair();
    expect(openRows(crew)).toBe("1");
  });
});
