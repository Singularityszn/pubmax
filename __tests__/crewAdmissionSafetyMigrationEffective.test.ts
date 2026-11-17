// Migration 0243 on a real PostgreSQL replay. A crew admits and invites nobody
// who has an active block, in either direction, with an accepted member, and
// nobody that crew removed. The refusal says only "not found". Admission,
// invitation, block, suspension and account deletion take the same
// participant-account locks, so none of them can pass another unseen.
//
// Each describe block moves the one database to the stage it needs in its own
// beforeAll, so every case runs alone. Each case makes its own people, with
// auth user, profile and Social account IDs drawn from separate ranges.

import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asServiceRole, postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const directory = join(process.cwd(), "supabase/migrations");
const name = "20261117090000_0243_crew_admission_safety_locks.sql";
const rollback = "rollback/20261117090000_0243_crew_admission_safety_locks_rollback.sql";

const DIGEST = "a".repeat(64);
const NOT_FOUND = { ok: false, code: "not_found" };
const NO_CREW = "a2439999-0000-4000-8000-000000000099";
const STAFF_ROLE = "a2438888-0000-4000-8000-000000000041";

let session: PostgresSession | null = null;
function db() { if (!session) throw new Error("The test database is not running."); return session; }
const json = (value: string) => JSON.parse(value) as Record<string, unknown>;

type Stage = "before" | "after";
let stage: Stage = "before";
/** Moves the one database to a stage: the forward file applies 0243, the rollback file removes it. */
function stageTo(next: Stage) {
  if (stage === next) return;
  db().applyFile(join(directory, next === "after" ? name : rollback));
  stage = next;
}

let keys = 0;
const key = () => `admission-key-0243-${String(++keys).padStart(8, "0")}`;
const rpc = (call: string) => `select public.${call}::text`;
const call = (statement: string) => json(db().sql(asServiceRole(rpc(statement))));

type Person = { user: string; profile: string; account: string; handle: string };
let people = 0;
/** A signed-up person. The three IDs come from different ranges and never coincide. */
function person(): Person {
  const n = String(++people).padStart(12, "0");
  const who = { user: `a2431100-0000-4000-8000-${n}`, profile: `a2432200-0000-4000-8000-${n}`,
    account: `a2433300-0000-4000-8000-${n}`, handle: `p0243_${people}` };
  db().sql(`insert into auth.users(id) values ('${who.user}');
    insert into public.profiles(id,user_id,handle) values ('${who.profile}','${who.user}','${who.handle}');
    insert into public.private_social_accounts(id,clerk_user_id,supabase_user_id,profile_id)
      values ('${who.account}','clerk-${who.handle}','${who.user}','${who.profile}');`);
  return who;
}
const mutual = (a: Person, b: Person) => db().sql(`insert into public.follows(follower_id,followee_id)
  values ('${a.profile}','${b.profile}'),('${b.profile}','${a.profile}') on conflict do nothing`);

const requestCall = (who: Person, crew: string, action = "pending") =>
  `request_social_crew_join_atomic('${who.account}','${crew}','${action}','${key()}','${DIGEST}')`;
const decideCall = (host: Person, crew: string, request: string, idempotencyKey = key()) =>
  `decide_social_crew_join_request_atomic('${host.account}','${crew}','${request}','accepted','${idempotencyKey}','${DIGEST}')`;
const blockCall = (blocker: Person, blocked: Person) => `set_social_block('${blocker.profile}','${blocked.profile}',true)`;
const suspendCall = (who: Person) =>
  `set_social_account_suspension_admin('${STAFF_ROLE}','${who.profile}','suspend','Safety review',null)`;
const inviteCall = (host: Person, crew: string, who: Person) =>
  `invite_social_crew_member_atomic('${host.account}','${crew}','${who.profile}','${key()}','${DIGEST}')`;
const queueCall = (host: Person, crew: string) =>
  `read_social_crew_join_requests('${host.account}','${host.profile}','${crew}')`;
const deleteAccount = (who: Person) => `delete from auth.users where id='${who.user}'`;

const request = (who: Person, crew: string) => call(requestCall(who, crew));
const cancel = (who: Person, crew: string) => call(requestCall(who, crew, "cancelled"));
const decide = (host: Person, crew: string, request: string, idempotencyKey?: string) =>
  call(decideCall(host, crew, request, idempotencyKey));
const block = (blocker: Person, blocked: Person) => call(blockCall(blocker, blocked));
const invite = (host: Person, crew: string, who: Person) => call(inviteCall(host, crew, who));
const answerInvitation = (who: Person, crew: string, invitation: string, action: "accepted" | "declined") =>
  call(`accept_social_crew_invitation_atomic('${who.account}','${crew}','${invitation}','${action}','${key()}','${DIGEST}')`);
const memberId = (crew: string, who: Person) =>
  db().sql(`select id from public.social_crew_members where crew_id='${crew}' and social_account_id='${who.account}'`);
const remove = (host: Person, crew: string, who: Person) =>
  call(`remove_social_crew_member_atomic('${host.account}','${crew}','${memberId(crew, who)}','${key()}','${DIGEST}')`);
const leave = (crew: string, who: Person) => call(`leave_social_crew_atomic('${who.account}','${crew}','${key()}','${DIGEST}')`);
const state = (crew: string, who: Person) =>
  db().sql(`select coalesce((select state from public.social_crew_members where crew_id='${crew}' and social_account_id='${who.account}'),'none')`);
const requestState = (request: string) => db().sql(`select state from public.social_crew_join_requests where id='${request}'`);
const ownership = (who: Person) => db().sql(`select ownership_state from public.private_social_accounts where id='${who.account}'`);
const queued = (host: Person, crew: string) =>
  (call(queueCall(host, crew)).items as { requesterHandle: string }[]).map((item) => item.requesterHandle);

function admit(host: Person, crew: string, who: Person) {
  const asked = request(who, crew);
  expect(asked).toMatchObject({ ok: true, code: "requested" });
  expect(decide(host, crew, asked.request_id as string)).toMatchObject({ ok: true, code: "accepted" });
}

let crews = 0;
/** An open crew hosted by `host` whose accepted guests are `guests`. */
function crewWith(host: Person, guests: Person[] = []): string {
  const n = ++crews;
  const plan = `a2434400-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const hash = String(n).padStart(64, "c");
  db().sql(`insert into public.plans(id,title,start_time,status,owner_user_id) values ('${plan}','Crew night ${n}',now()+interval '1 day','ready','${host.user}');
    insert into public.plan_stops(plan_id,venue_id,venue_name,position) values ('${plan}','venue-one','Venue One',0);
    insert into public.plan_crew_members(plan_id,name,token_hash,status,joined_at,updated_at,can_collaborate,user_id)
      values ('${plan}','Host','${hash}','in',now()-interval '1 minute',now(),true,'${host.user}');`);
  const created = call(`create_social_crew_atomic('${host.account}','${plan}','${hash}','open','${key()}','${DIGEST}')`);
  const crew = created.crew_id as string;
  if (!crew) throw new Error(`The crew was not created: ${JSON.stringify(created)}`);
  for (const guest of guests) admit(host, crew, guest);
  return crew;
}

type Held = { said: string; finish(): Promise<void> };
/** One real transaction that has run its statement and stays open until finish(). */
async function hold(statement: string, role: "service_role" | "postgres" = "service_role"): Promise<Held> {
  const child = spawn(db().psql, [...db().databaseArgs, "-X", "-qAt"], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  let errors = "";
  child.stderr.on("data", (chunk) => { errors += String(chunk); });
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`The held transaction failed: ${errors}`)));
  });
  void exited.catch(() => {});
  const ready = new Promise<string>((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      const lines = output.split(/\r?\n/);
      const marker = lines.indexOf("HELD");
      if (marker >= 0) resolve(lines.slice(0, marker).join("\n").trim());
    });
    child.once("close", () => reject(new Error(`The held transaction ended before its barrier: ${errors}`)));
  });
  const asRole = role === "service_role" ? "set local role service_role; " : "";
  child.stdin.write(`begin; ${asRole}${statement};\n\\echo HELD\n`);
  const said = await ready;
  let finished = false;
  const finish = async () => {
    if (finished) return;
    finished = true;
    child.stdin.end("commit;\n");
    await exited;
  };
  return { said, finish };
}
const holdRpc = async (statement: string) => {
  const held = await hold(rpc(statement));
  return { ...held, result: json(held.said) };
};

/** A statement on its own connection, named so a probe can see what it waits on. */
function waiting(application: string, statement: string, role: "service_role" | "postgres" = "service_role") {
  const asRole = role === "service_role" ? "set role service_role; " : "";
  const pending = db().attempt(`set application_name='${application}'; ${asRole}${statement}`);
  void pending.catch(() => {});
  return pending;
}
const waitingRpc = (application: string, statement: string) =>
  waiting(application, rpc(statement)).then((answer) => {
    if (!answer.ok) throw new Error(answer.said);
    return answer;
  });
function waitingRpcResult(application: string, statement: string) {
  const asRole = "set role service_role; ";
  const pending = db().sqlAsync(`set application_name='${application}'; ${asRole}${rpc(statement)}`).then(json);
  void pending.catch(() => {});
  return pending;
}

/** True only while that connection waits on a participant-account advisory lock. */
const waitsOnAccountLock = (application: string) => db().sqlAsync(`select exists(select 1 from pg_stat_activity
  where application_name='${application}' and wait_event_type='Lock' and wait_event='advisory'
    and cardinality(pg_blocking_pids(pid)) > 0)`);
/** True while that connection waits on any heavyweight lock held by another session. */
const waitsOnAnyLock = (application: string) => db().sqlAsync(`select exists(select 1 from pg_stat_activity
  where application_name='${application}' and wait_event_type='Lock'
    and cardinality(pg_blocking_pids(pid)) > 0)`);

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "crew-admission-0243", database: "crew_admission_0243" });
  try {
    db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const file of readdirSync(directory).filter((entry) => entry.endsWith(".sql") && entry < name).sort()) db().applyFile(join(directory, file));
    const staff = person();
    db().sql(`insert into public.private_social_staff_roles(id,profile_id,display_name,role) values ('${STAFF_ROLE}','${staff.profile}','Moderator','moderator');`);
    stage = "before";
  } catch (error) { await session.stop(); session = null; throw error; }
}, 600_000);
afterAll(async () => { await session?.stop(); session = null; });

describe.skipIf(skipReason !== null)("before 0243", () => {
  beforeAll(() => { if (session) stageTo("before"); });

  it("a block with an accepted guest and an earlier removal both leave the door open", () => {
    const host = person(), ana = person(), xav = person();
    const blocked = crewWith(host, [ana]);
    block(xav, ana);
    admit(host, blocked, xav);
    expect(state(blocked, ana)).toBe("active");

    const removed = crewWith(host, [ana]);
    admit(host, removed, xav);
    expect(remove(host, removed, xav)).toMatchObject({ ok: true, code: "removed" });
    admit(host, removed, xav);
  });
});

describe.skipIf(skipReason !== null)("after 0243: refusals", () => {
  beforeAll(() => { if (session) stageTo("after"); });

  it("a request fails like an unknown crew when the requester and an accepted guest are blocked either way", () => {
    const host = person(), ana = person(), xav = person();
    expect(request(xav, NO_CREW)).toEqual(NOT_FOUND);
    for (const [blocker, blocked] of [[xav, ana], [ana, xav]] as const) {
      const crew = crewWith(host, [ana]);
      block(blocker, blocked);
      expect(request(xav, crew)).toEqual(NOT_FOUND);
      expect(db().sql(`select count(*) from public.social_crew_join_requests where crew_id='${crew}' and requester_account_id='${xav.account}'`)).toBe("0");
      expect(state(crew, ana)).toBe("active");
      db().sql(`delete from public.social_blocks where blocker_profile_id='${blocker.profile}'`);
    }
  });

  it("the host's acceptance fails neutrally once a block appears, replays the same answer, and the request can still be cancelled", () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    const asked = request(xav, crew);
    expect(asked).toMatchObject({ ok: true, code: "requested" });
    block(ana, xav);
    const decision = key();
    expect(decide(host, crew, asked.request_id as string, decision)).toEqual(NOT_FOUND);
    expect(decide(host, crew, asked.request_id as string, decision)).toEqual(NOT_FOUND);
    expect(state(crew, xav)).toBe("none");
    expect(state(crew, ana)).toBe("active");
    expect(requestState(asked.request_id as string)).toBe("pending");
    expect(cancel(xav, crew)).toMatchObject({ ok: true, code: "cancelled" });
    expect(requestState(asked.request_id as string)).toBe("cancelled");
  });

  it("a requester the host has since blocked can still cancel their own request, and cannot ask again", () => {
    const host = person(), xav = person();
    const crew = crewWith(host);
    const asked = request(xav, crew);
    expect(asked).toMatchObject({ ok: true, code: "requested" });
    block(host, xav);
    expect(cancel(xav, crew)).toMatchObject({ ok: true, code: "cancelled" });
    expect(requestState(asked.request_id as string)).toBe("cancelled");
    expect(request(xav, crew)).toEqual(NOT_FOUND);
    expect(cancel(xav, crew)).toEqual(NOT_FOUND);
  });

  it("the host's queue hides a request that acceptance would refuse, without saying why", () => {
    const host = person(), ana = person(), xav = person(), bea = person();
    const crew = crewWith(host, [ana]);
    request(xav, crew);
    request(bea, crew);
    expect(queued(host, crew)).toEqual([xav.handle, bea.handle]);
    block(xav, ana);
    expect(queued(host, crew)).toEqual([bea.handle]);
    expect(call(queueCall(host, crew))).toMatchObject({ hasMore: false });
  });

  it("an invitation cannot bring in a person who is blocked with an accepted guest, and a pending one can still be declined", () => {
    const host = person(), ana = person(), xav = person(), bea = person();
    mutual(host, xav);
    mutual(host, bea);
    const crew = crewWith(host, [ana]);
    const invitation = invite(host, crew, xav);
    expect(invitation).toMatchObject({ ok: true, code: "invited" });
    block(xav, ana);
    expect(answerInvitation(xav, crew, invitation.invitation_id as string, "accepted")).toEqual(NOT_FOUND);
    expect(state(crew, xav)).toBe("none");
    expect(answerInvitation(xav, crew, invitation.invitation_id as string, "declined")).toMatchObject({ ok: true, code: "declined" });

    block(ana, bea);
    expect(invite(host, crew, bea)).toEqual(NOT_FOUND);
    expect(db().sql(`select count(*) from public.social_crew_invitations where crew_id='${crew}' and target_account_id='${bea.account}'`)).toBe("0");
  });

  it("a block between two accepted guests changes no place and ends no seat", () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana, xav]);
    expect(block(ana, xav)).toBeTruthy();
    expect(state(crew, xav)).toBe("active");
    expect(state(crew, ana)).toBe("active");
    expect(db().sql(`select count(*) from public.plan_crew_members seat join public.social_crew_members member on member.plan_member_id=seat.id
      where member.crew_id='${crew}' and seat.membership_revoked_at is null`)).toBe("3");
  });

  it("removal bars that crew only, by request and by invitation, and a guest who left can come back", () => {
    const host = person(), ana = person(), xav = person();
    mutual(host, xav);
    const crew = crewWith(host, [ana, xav]);
    expect(remove(host, crew, xav)).toMatchObject({ ok: true, code: "removed" });
    expect(request(xav, crew)).toEqual(NOT_FOUND);
    expect(invite(host, crew, xav)).toEqual(NOT_FOUND);
    expect(state(crew, xav)).toBe("removed");

    crewWith(host, [xav]);

    const left = crewWith(host, [xav]);
    expect(leave(left, xav)).toMatchObject({ ok: true, code: "left" });
    admit(host, left, xav);
  });

  it("the lock, eligibility and admission helpers are not reachable by a browser role", () => {
    for (const role of ["anon", "authenticated"]) {
      expect(db().sql(`select has_function_privilege('${role}','public._lock_social_participant_accounts(uuid[])','execute')
        or has_function_privilege('${role}','public._social_crew_admission_refused(uuid,uuid)','execute')
        or has_function_privilege('${role}','public._social_crew_admission_ineligible(uuid,uuid)','execute')
        or has_function_privilege('${role}','public._lock_social_auth_user_accounts()','execute')`)).toBe("f");
    }
  });
});

describe.skipIf(skipReason !== null)("after 0243: races", () => {
  beforeAll(() => { if (session) stageTo("after"); });

  it("two acceptances racing for the last place still admit exactly one", async () => {
    const host = person(), ana = person(), cal = person(), xav = person(), bea = person();
    const crew = crewWith(host, [ana]);
    db().sql(`update public.social_crews set capacity=4, meeting_venue_id='venue-one', description='One more place' where id='${crew}'`);
    admit(host, crew, cal);
    const first = request(xav, crew).request_id as string;
    const second = request(bea, crew).request_id as string;
    const answers = (await db().concurrentResults([
      asServiceRole(rpc(decideCall(host, crew, first))),
      asServiceRole(rpc(decideCall(host, crew, second))),
    ])).map((answer) => json(answer).code).sort();
    expect(answers).toEqual(["accepted", "full"]);
    expect(db().sql(`select count(*) from public.social_crew_members where crew_id='${crew}' and state='active'`)).toBe("4");
  });

  it("an acceptance waits for a block in flight, then refuses once it commits", async () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    const asked = request(xav, crew);
    const blocker = await holdRpc(blockCall(ana, xav));
    try {
      const acceptance = waitingRpcResult("accept_after_block", decideCall(host, crew, asked.request_id as string));
      await expect.poll(() => waitsOnAccountLock("accept_after_block")).toBe("t");
      await blocker.finish();
      expect(await acceptance).toEqual(NOT_FOUND);
    } finally { await blocker.finish(); }
    expect(state(crew, xav)).toBe("none");
    expect(state(crew, ana)).toBe("active");
  });

  it("a block waits for an acceptance in flight, then lands without removing anyone", async () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    const asked = request(xav, crew);
    const acceptance = await holdRpc(decideCall(host, crew, asked.request_id as string));
    expect(acceptance.result).toMatchObject({ ok: true, code: "accepted" });
    try {
      const blocking = waitingRpcResult("block_after_accept", blockCall(ana, xav));
      await expect.poll(() => waitsOnAccountLock("block_after_accept")).toBe("t");
      await acceptance.finish();
      expect(await blocking).toBe(true);
    } finally { await acceptance.finish(); }
    expect(state(crew, xav)).toBe("active");
    expect(state(crew, ana)).toBe("active");
  });

  it("a block row moved onto a new person waits for an acceptance in flight like a new block", async () => {
    const host = person(), ana = person(), xav = person(), bea = person(), cal = person();
    const crew = crewWith(host, [ana]);
    block(bea, cal);
    const asked = request(xav, crew);
    const acceptance = await holdRpc(decideCall(host, crew, asked.request_id as string));
    expect(acceptance.result).toMatchObject({ ok: true, code: "accepted" });
    try {
      const moving = waiting("block_moved_after_accept", `update public.social_blocks
        set blocker_profile_id='${ana.profile}', blocked_profile_id='${xav.profile}'
        where blocker_profile_id='${bea.profile}' and blocked_profile_id='${cal.profile}'`);
      await expect.poll(() => waitsOnAccountLock("block_moved_after_accept")).toBe("t");
      await acceptance.finish();
      expect(await moving).toMatchObject({ ok: true });
    } finally { await acceptance.finish(); }
    expect(state(crew, xav)).toBe("active");
  });

  it("an invitation waits for a block in flight, then refuses once it commits", async () => {
    const host = person(), ana = person(), xav = person();
    mutual(host, xav);
    const crew = crewWith(host, [ana]);
    const blocker = await holdRpc(blockCall(xav, ana));
    try {
      const inviting = waitingRpcResult("invite_after_block", inviteCall(host, crew, xav));
      await expect.poll(() => waitsOnAccountLock("invite_after_block")).toBe("t");
      await blocker.finish();
      expect(await inviting).toEqual(NOT_FOUND);
    } finally { await blocker.finish(); }
    expect(db().sql(`select count(*) from public.social_crew_invitations where crew_id='${crew}'`)).toBe("0");
  });

  it("a suspension and an acceptance take the account lock first, in either order, without deadlock", async () => {
    const host = person(), ana = person(), xav = person();
    const refused = crewWith(host, [ana]);
    const first = request(xav, refused);
    const suspension = await holdRpc(suspendCall(xav));
    expect(suspension.result).toMatchObject({ ok: true, code: "suspended" });
    try {
      const acceptance = waitingRpcResult("accept_after_suspend", decideCall(host, refused, first.request_id as string));
      await expect.poll(() => waitsOnAccountLock("accept_after_suspend")).toBe("t");
      await suspension.finish();
      expect(await acceptance).toEqual(NOT_FOUND);
    } finally { await suspension.finish(); }
    expect(state(refused, xav)).toBe("none");

    const bea = person();
    const accepted = crewWith(host, [ana]);
    const second = request(bea, accepted);
    const acceptance = await holdRpc(decideCall(host, accepted, second.request_id as string));
    expect(acceptance.result).toMatchObject({ ok: true, code: "accepted" });
    try {
      const suspending = waitingRpcResult("suspend_after_accept", suspendCall(bea));
      await expect.poll(() => waitsOnAccountLock("suspend_after_accept")).toBe("t");
      await acceptance.finish();
      expect(await suspending).toMatchObject({ ok: true, code: "suspended" });
    } finally { await acceptance.finish(); }
    expect(state(accepted, bea)).toBe("active");
  });

  it("a host whose suspension commits while their approval waits admits nobody, and the refusal replays", async () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    const asked = request(xav, crew);
    const decision = key();
    const suspension = await holdRpc(suspendCall(host));
    expect(suspension.result).toMatchObject({ ok: true, code: "suspended" });
    try {
      const approval = waitingRpcResult("approve_after_host_suspend", decideCall(host, crew, asked.request_id as string, decision));
      await expect.poll(() => waitsOnAccountLock("approve_after_host_suspend")).toBe("t");
      await suspension.finish();
      expect(await approval).toEqual(NOT_FOUND);
    } finally { await suspension.finish(); }
    expect(state(crew, xav)).toBe("none");
    expect(requestState(asked.request_id as string)).toBe("pending");
    db().sql(`update public.private_social_accounts set ownership_state='active' where id='${host.account}'`);
    expect(decide(host, crew, asked.request_id as string, decision)).toEqual(NOT_FOUND);
    expect(state(crew, xav)).toBe("none");
  });

  it("a host suspension waits for an approval in flight, and the guest it admitted keeps the place", async () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    const asked = request(xav, crew);
    const approval = await holdRpc(decideCall(host, crew, asked.request_id as string));
    expect(approval.result).toMatchObject({ ok: true, code: "accepted" });
    try {
      const suspending = waitingRpcResult("host_suspend_after_approve", suspendCall(host));
      await expect.poll(() => waitsOnAccountLock("host_suspend_after_approve")).toBe("t");
      await approval.finish();
      expect(await suspending).toMatchObject({ ok: true, code: "suspended" });
    } finally { await approval.finish(); }
    expect(state(crew, xav)).toBe("active");
    expect(ownership(host)).toBe("suspended");
  });

  it("admissions to two crews that share guests wait their turn on the shared locks and both land", async () => {
    const host = person(), ana = person(), bea = person(), xav = person(), yan = person();
    const first = crewWith(host, [ana, bea]);
    const second = crewWith(host, [bea, ana]);
    const askedFirst = request(xav, first);
    const askedSecond = request(yan, second);
    const firstApproval = await holdRpc(decideCall(host, first, askedFirst.request_id as string));
    expect(firstApproval.result).toMatchObject({ ok: true, code: "accepted" });
    try {
      const secondApproval = waitingRpcResult("overlap_second", decideCall(host, second, askedSecond.request_id as string));
      await expect.poll(() => waitsOnAccountLock("overlap_second")).toBe("t");
      await firstApproval.finish();
      expect(await secondApproval).toMatchObject({ ok: true, code: "accepted" });
    } finally { await firstApproval.finish(); }
    expect(state(first, xav)).toBe("active");
    expect(state(second, yan)).toBe("active");
  });

  it("the host's queue never waits on the account locks a write holds", async () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    request(xav, crew);
    const blocker = await holdRpc(blockCall(ana, xav));
    try {
      expect(queued(host, crew)).toEqual([xav.handle]);
    } finally { await blocker.finish(); }
    expect(queued(host, crew)).toEqual([]);
  });
});

describe.skipIf(skipReason !== null)("after 0243: account deletion", () => {
  beforeAll(() => { if (session) stageTo("after"); });

  it("a deletion waits for an admission that holds a guest's account lock, then completes", async () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    const asked = request(xav, crew);
    const approval = await holdRpc(decideCall(host, crew, asked.request_id as string));
    expect(approval.result).toMatchObject({ ok: true, code: "accepted" });
    try {
      const deletion = waiting("delete_after_admission", deleteAccount(ana), "postgres");
      await expect.poll(() => waitsOnAccountLock("delete_after_admission")).toBe("t");
      const authRow = await db().attempt(`select 1 from auth.users where id='${ana.user}' for key share nowait`);
      expect(authRow.said).toContain("55P03");
      await approval.finish();
      expect(await deletion).toMatchObject({ ok: true });
    } finally { await approval.finish(); }
    expect(state(crew, xav)).toBe("active");
    expect(ownership(ana)).toBe("suspended");
  });

  it("an approval waits for the requester's deletion in flight, then refuses neutrally", async () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    const asked = request(xav, crew);
    const deletion = await hold(deleteAccount(xav), "postgres");
    try {
      const approval = waitingRpcResult("approve_after_delete", decideCall(host, crew, asked.request_id as string));
      await expect.poll(() => waitsOnAccountLock("approve_after_delete")).toBe("t");
      await deletion.finish();
      expect(await approval).toEqual(NOT_FOUND);
    } finally { await deletion.finish(); }
    expect(state(crew, xav)).toBe("none");
  });

  it("a deletion and a suspension of the same person both finish when the moderator reaches the profile first", async () => {
    const xav = person();
    const profileHolder = await hold(`select id from public.profiles where id='${xav.profile}' for update`, "postgres");
    let suspension: Promise<{ ok: boolean; said: string }> | null = null;
    let deletion: Promise<{ ok: boolean; said: string }> | null = null;
    try {
      suspension = waitingRpc("suspend_racing_delete", suspendCall(xav));
      await expect.poll(() => waitsOnAnyLock("suspend_racing_delete")).toBe("t");
      deletion = waiting("delete_racing_suspend", deleteAccount(xav), "postgres");
      await expect.poll(() => waitsOnAnyLock("delete_racing_suspend")).toBe("t");
    } finally { await profileHolder.finish(); }
    const answers = await Promise.allSettled([suspension, deletion]);
    expect(answers.map((answer) => answer.status === "fulfilled" ? answer.value?.ok || answer.value?.said : String(answer.reason)))
      .toEqual([true, true]);
    expect(ownership(xav)).toBe("suspended");
    expect(db().sql(`select supabase_user_id is null from public.private_social_accounts where id='${xav.account}'`)).toBe("t");
  });

  it("a suspension after a deletion answers gone, and the person's crew seat stays closed", async () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    const asked = request(xav, crew);
    db().sql(deleteAccount(xav));
    expect(call(suspendCall(xav))).toMatchObject({ ok: false, code: "gone" });
    expect(decide(host, crew, asked.request_id as string)).toEqual(NOT_FOUND);
    expect(state(crew, xav)).toBe("none");
  });

  it("a requester's own deletion racing their own new seat ends with PostgreSQL refusing exactly one side", async () => {
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    const asked = request(xav, crew);
    const plan = db().sql(`select plan_id from public.social_crews where id='${crew}'`);
    const seatLock = await hold(`select pg_advisory_xact_lock(hashtextextended('plan:join-account:${plan}:${xav.user}',0))`, "postgres");
    let approval: Promise<{ ok: boolean; said: string }> | null = null;
    let deletion: Promise<{ ok: boolean; said: string }> | null = null;
    try {
      approval = waiting("self_race_approve", rpc(decideCall(host, crew, asked.request_id as string)));
      await expect.poll(() => waitsOnAccountLock("self_race_approve")).toBe("t");
      deletion = waiting("self_race_delete", deleteAccount(xav), "postgres");
      await expect.poll(() => waitsOnAccountLock("self_race_delete")).toBe("t");
    } finally { await seatLock.finish(); }
    const answers = await Promise.all([approval, deletion]);
    expect(answers.filter((answer) => answer?.ok)).toHaveLength(1);
    expect(answers.find((answer) => !answer?.ok)?.said).toContain("40P01");
    expect(state(crew, xav) === "active").toBe(ownership(xav) === "active");
  });
});

describe.skipIf(skipReason !== null)("rollback and reapply", () => {
  beforeAll(() => { if (session) stageTo("after"); });

  it("rollback restores the old admission answers and drops the locks, and reapplying restores the refusals", () => {
    stageTo("before");
    expect(db().sql(`select to_regprocedure('public._lock_social_participant_accounts(uuid[])') is null
      and to_regprocedure('public._social_crew_admission_refused(uuid,uuid)') is null
      and to_regprocedure('public._social_crew_admission_ineligible(uuid,uuid)') is null
      and to_regprocedure('public._lock_social_auth_user_accounts()') is null
      and not exists(select 1 from pg_trigger where tgname in ('social_blocks_lock_participant_accounts','lock_social_accounts_on_auth_user_delete'))`)).toBe("t");
    const host = person(), ana = person(), xav = person();
    const crew = crewWith(host, [ana]);
    block(xav, ana);
    admit(host, crew, xav);
    expect(remove(host, crew, xav)).toMatchObject({ ok: true, code: "removed" });
    admit(host, crew, xav);
    expect(call(suspendCall(xav))).toMatchObject({ ok: true, code: "suspended" });

    stageTo("after");
    const bea = person();
    const again = crewWith(host, [ana]);
    block(bea, ana);
    expect(request(bea, again)).toEqual(NOT_FOUND);
  });
});
