// Migration 0243 on a real PostgreSQL replay. A crew admits nobody who has an
// active block, in either direction, with an accepted member, and nobody that
// crew removed. The refusal says only "not found". Acceptance, block and
// suspension writes take the same participant-account locks, so a block or a
// suspension and an acceptance can no longer pass each other unseen.

import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asServiceRole, postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const directory = join(process.cwd(), "supabase/migrations");
const name = "20261117090000_0243_crew_admission_safety_locks.sql";
const rollback = "rollback/20261117090000_0243_crew_admission_safety_locks_rollback.sql";

const id = (n: number) => `a2430000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const HOST_USER = id(11), ANA_USER = id(12), XAV_USER = id(13), BEA_USER = id(14), CAL_USER = id(15), STAFF_USER = id(16);
const HOST_PROFILE = id(21), ANA_PROFILE = id(22), XAV_PROFILE = id(23), BEA_PROFILE = id(24), CAL_PROFILE = id(25), STAFF_PROFILE = id(26);
const HOST = id(31), ANA = id(32), XAV = id(33), BEA = id(34), CAL = id(35);
const STAFF_ROLE = id(41);
const NO_CREW = id(99);
const DIGEST = "a".repeat(64);
const NOT_FOUND = { ok: false, code: "not_found" };

let session: PostgresSession | null = null;
function db() { if (!session) throw new Error("The test database is not running."); return session; }
const json = (value: string) => JSON.parse(value) as Record<string, unknown>;

let keys = 0;
const key = () => `admission-key-0243-${String(++keys).padStart(8, "0")}`;
const rpc = (call: string) => `select public.${call}::text`;
const call = (statement: string) => json(db().sql(asServiceRole(rpc(statement))));

const requestCall = (account: string, crew: string, action = "pending") =>
  `request_social_crew_join_atomic('${account}','${crew}','${action}','${key()}','${DIGEST}')`;
const decideCall = (crew: string, request: string, idempotencyKey = key()) =>
  `decide_social_crew_join_request_atomic('${HOST}','${crew}','${request}','accepted','${idempotencyKey}','${DIGEST}')`;
const blockCall = (blocker: string, blocked: string) => `set_social_block('${blocker}','${blocked}',true)`;
const suspendCall = (profile: string) =>
  `set_social_account_suspension_admin('${STAFF_ROLE}','${profile}','suspend','Safety review',null)`;

const request = (account: string, crew: string) => call(requestCall(account, crew));
const decide = (crew: string, request: string, idempotencyKey?: string) => call(decideCall(crew, request, idempotencyKey));
const block = (blocker: string, blocked: string) => call(blockCall(blocker, blocked));
const invite = (crew: string, profile: string) =>
  call(`invite_social_crew_member_atomic('${HOST}','${crew}','${profile}','${key()}','${DIGEST}')`);
const acceptInvitation = (account: string, crew: string, invitation: string) =>
  call(`accept_social_crew_invitation_atomic('${account}','${crew}','${invitation}','accepted','${key()}','${DIGEST}')`);
const memberId = (crew: string, account: string) =>
  db().sql(`select id from public.social_crew_members where crew_id='${crew}' and social_account_id='${account}'`);
const remove = (crew: string, account: string) =>
  call(`remove_social_crew_member_atomic('${HOST}','${crew}','${memberId(crew, account)}','${key()}','${DIGEST}')`);
const leave = (crew: string, account: string) => call(`leave_social_crew_atomic('${account}','${crew}','${key()}','${DIGEST}')`);
const state = (crew: string, account: string) =>
  db().sql(`select coalesce((select state from public.social_crew_members where crew_id='${crew}' and social_account_id='${account}'),'none')`);
const requestState = (request: string) => db().sql(`select state from public.social_crew_join_requests where id='${request}'`);

function admit(crew: string, account: string) {
  const asked = request(account, crew);
  expect(asked).toMatchObject({ ok: true, code: "requested" });
  expect(decide(crew, asked.request_id as string)).toMatchObject({ ok: true, code: "accepted" });
}

let crews = 0;
/** An open crew whose host is HOST and whose one accepted guest is ANA. */
function freshCrew(): string {
  const n = ++crews;
  const plan = `a2431000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const hash = String(n).padStart(64, "c");
  db().sql(`insert into public.plans(id,title,start_time,status,owner_user_id) values ('${plan}','Crew night ${n}',now()+interval '1 day','ready','${HOST_USER}');
    insert into public.plan_stops(plan_id,venue_id,venue_name,position) values ('${plan}','venue-one','Venue One',0);
    insert into public.plan_crew_members(plan_id,name,token_hash,status,joined_at,updated_at,can_collaborate,user_id)
      values ('${plan}','Host','${hash}','in',now()-interval '1 minute',now(),true,'${HOST_USER}');`);
  const created = call(`create_social_crew_atomic('${HOST}','${plan}','${hash}','open','${key()}','${DIGEST}')`);
  const crew = created.crew_id as string;
  if (!crew) throw new Error(`The crew was not created: ${JSON.stringify(created)}`);
  admit(crew, ANA);
  return crew;
}

/** One real transaction that has run its statement and stays open until finish(). */
async function hold(statement: string) {
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
  child.stdin.write(`begin; set local role service_role; ${rpc(statement)};\n\\echo HELD\n`);
  const result = json(await ready);
  let finished = false;
  const finish = async () => {
    if (finished) return;
    finished = true;
    child.stdin.end("commit;\n");
    await exited;
  };
  return { result, finish };
}

function waiting(application: string, statement: string): Promise<Record<string, unknown>> {
  const pending = db().sqlAsync(`set application_name='${application}'; ${asServiceRole(rpc(statement))}`).then(json);
  void pending.catch(() => {});
  return pending;
}

/** True only while that connection waits on a participant-account advisory lock. */
const waitsOnAccountLock = (application: string) => db().sqlAsync(`select exists(select 1 from pg_stat_activity
  where application_name='${application}' and wait_event_type='Lock' and wait_event='advisory'
    and cardinality(pg_blocking_pids(pid)) > 0)`);

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "crew-admission-0243", database: "crew_admission_0243" });
  try {
    db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const file of readdirSync(directory).filter((entry) => entry.endsWith(".sql") && entry < name).sort()) db().applyFile(join(directory, file));
    db().sql(`insert into auth.users(id) values ('${HOST_USER}'),('${ANA_USER}'),('${XAV_USER}'),('${BEA_USER}'),('${CAL_USER}'),('${STAFF_USER}');
      insert into public.profiles(id,user_id,handle) values ('${HOST_PROFILE}','${HOST_USER}','host'),('${ANA_PROFILE}','${ANA_USER}','ana'),
        ('${XAV_PROFILE}','${XAV_USER}','xav'),('${BEA_PROFILE}','${BEA_USER}','bea'),('${CAL_PROFILE}','${CAL_USER}','cal'),('${STAFF_PROFILE}','${STAFF_USER}','staff');
      insert into public.private_social_accounts(id,clerk_user_id,supabase_user_id,profile_id) values
        ('${HOST}','clerk-host','${HOST_USER}','${HOST_PROFILE}'),('${ANA}','clerk-ana','${ANA_USER}','${ANA_PROFILE}'),
        ('${XAV}','clerk-xav','${XAV_USER}','${XAV_PROFILE}'),('${BEA}','clerk-bea','${BEA_USER}','${BEA_PROFILE}'),
        ('${CAL}','clerk-cal','${CAL_USER}','${CAL_PROFILE}');
      insert into public.follows(follower_id,followee_id) values ('${HOST_PROFILE}','${XAV_PROFILE}'),('${XAV_PROFILE}','${HOST_PROFILE}');
      insert into public.private_social_staff_roles(id,profile_id,display_name,role) values ('${STAFF_ROLE}','${STAFF_PROFILE}','Moderator','moderator');`);
  } catch (error) { await session.stop(); session = null; throw error; }
}, 600_000);
beforeEach(() => {
  if (!session) return;
  db().sql(`delete from public.social_blocks;
    update public.private_social_accounts set ownership_state='active', updated_at=now() where ownership_state<>'active';`);
});
afterAll(async () => { await session?.stop(); session = null; });

describe.skipIf(skipReason !== null)("0243 crew admission refuses blocked and removed people under account locks", () => {
  it("before 0243: a block with an accepted guest and an earlier removal both leave the door open", () => {
    const blocked = freshCrew();
    block(XAV_PROFILE, ANA_PROFILE);
    admit(blocked, XAV);
    expect(state(blocked, ANA)).toBe("active");

    const removed = freshCrew();
    admit(removed, XAV);
    expect(remove(removed, XAV)).toMatchObject({ ok: true, code: "removed" });
    admit(removed, XAV);
  });

  it("after 0243: a request fails like an unknown crew when the requester and an accepted guest are blocked either way", () => {
    db().applyFile(join(directory, name));
    expect(request(XAV, NO_CREW)).toEqual(NOT_FOUND);
    for (const [blocker, blocked] of [[XAV_PROFILE, ANA_PROFILE], [ANA_PROFILE, XAV_PROFILE]] as const) {
      db().sql("delete from public.social_blocks");
      const crew = freshCrew();
      block(blocker, blocked);
      expect(request(XAV, crew)).toEqual(NOT_FOUND);
      expect(db().sql(`select count(*) from public.social_crew_join_requests where crew_id='${crew}' and requester_account_id='${XAV}'`)).toBe("0");
      expect(state(crew, ANA)).toBe("active");
    }
  });

  it("after 0243: the host's acceptance fails neutrally once a block appears, replays the same answer, and the request can still be cancelled", () => {
    const crew = freshCrew();
    const asked = request(XAV, crew);
    expect(asked).toMatchObject({ ok: true, code: "requested" });
    block(ANA_PROFILE, XAV_PROFILE);
    const decision = key();
    expect(decide(crew, asked.request_id as string, decision)).toEqual(NOT_FOUND);
    expect(decide(crew, asked.request_id as string, decision)).toEqual(NOT_FOUND);
    expect(state(crew, XAV)).toBe("none");
    expect(state(crew, ANA)).toBe("active");
    expect(requestState(asked.request_id as string)).toBe("pending");
    expect(call(requestCall(XAV, crew, "cancelled"))).toMatchObject({ ok: true, code: "cancelled" });
    expect(requestState(asked.request_id as string)).toBe("cancelled");
  });

  it("after 0243: an invitation cannot bring in a person who is blocked with an accepted guest", () => {
    const crew = freshCrew();
    const invitation = invite(crew, XAV_PROFILE);
    expect(invitation).toMatchObject({ ok: true, code: "invited" });
    block(XAV_PROFILE, ANA_PROFILE);
    expect(acceptInvitation(XAV, crew, invitation.invitation_id as string)).toEqual(NOT_FOUND);
    expect(state(crew, XAV)).toBe("none");
    expect(state(crew, ANA)).toBe("active");
  });

  it("after 0243: a block between two accepted guests changes no place and ends no seat", () => {
    const crew = freshCrew();
    admit(crew, XAV);
    expect(block(ANA_PROFILE, XAV_PROFILE)).toBeTruthy();
    expect(state(crew, XAV)).toBe("active");
    expect(state(crew, ANA)).toBe("active");
    expect(db().sql(`select count(*) from public.plan_crew_members seat join public.social_crew_members member on member.plan_member_id=seat.id
      where member.crew_id='${crew}' and seat.membership_revoked_at is null`)).toBe("3");
  });

  it("after 0243: removal bars that crew only, by request and by invitation, and a guest who left can come back", () => {
    const crew = freshCrew();
    admit(crew, XAV);
    expect(remove(crew, XAV)).toMatchObject({ ok: true, code: "removed" });
    expect(request(XAV, crew)).toEqual(NOT_FOUND);
    const invitation = invite(crew, XAV_PROFILE);
    expect(acceptInvitation(XAV, crew, invitation.invitation_id as string)).toEqual(NOT_FOUND);
    expect(state(crew, XAV)).toBe("removed");

    admit(freshCrew(), XAV);

    const left = freshCrew();
    admit(left, XAV);
    expect(leave(left, XAV)).toMatchObject({ ok: true, code: "left" });
    admit(left, XAV);
  });

  it("after 0243: two acceptances racing for the last place still admit exactly one", async () => {
    const crew = freshCrew();
    db().sql(`update public.social_crews set capacity=4, meeting_venue_id='venue-one', description='One more place' where id='${crew}'`);
    admit(crew, CAL);
    const first = request(XAV, crew).request_id as string;
    const second = request(BEA, crew).request_id as string;
    const answers = (await db().concurrentResults([
      asServiceRole(rpc(decideCall(crew, first))),
      asServiceRole(rpc(decideCall(crew, second))),
    ])).map((answer) => json(answer).code).sort();
    expect(answers).toEqual(["accepted", "full"]);
    expect(db().sql(`select count(*) from public.social_crew_members where crew_id='${crew}' and state='active'`)).toBe("4");
  });

  it("after 0243: an acceptance waits for a block in flight, then refuses once it commits", async () => {
    const crew = freshCrew();
    const asked = request(XAV, crew);
    const blocker = await hold(blockCall(ANA_PROFILE, XAV_PROFILE));
    try {
      const acceptance = waiting("accept_after_block", decideCall(crew, asked.request_id as string));
      await expect.poll(() => waitsOnAccountLock("accept_after_block")).toBe("t");
      await blocker.finish();
      expect(await acceptance).toEqual(NOT_FOUND);
    } finally { await blocker.finish(); }
    expect(state(crew, XAV)).toBe("none");
    expect(state(crew, ANA)).toBe("active");
  });

  it("after 0243: a block waits for an acceptance in flight, then lands without removing anyone", async () => {
    const crew = freshCrew();
    const asked = request(XAV, crew);
    const acceptance = await hold(decideCall(crew, asked.request_id as string));
    expect(acceptance.result).toMatchObject({ ok: true, code: "accepted" });
    try {
      const blocking = waiting("block_after_accept", blockCall(ANA_PROFILE, XAV_PROFILE));
      await expect.poll(() => waitsOnAccountLock("block_after_accept")).toBe("t");
      await acceptance.finish();
      expect(await blocking).toBe(true);
    } finally { await acceptance.finish(); }
    expect(state(crew, XAV)).toBe("active");
    expect(state(crew, ANA)).toBe("active");
  });

  it("after 0243: a suspension and an acceptance take the account lock first, in either order, without deadlock", async () => {
    const refused = freshCrew();
    const first = request(XAV, refused);
    const suspension = await hold(suspendCall(XAV_PROFILE));
    expect(suspension.result).toMatchObject({ ok: true, code: "suspended" });
    try {
      const acceptance = waiting("accept_after_suspend", decideCall(refused, first.request_id as string));
      await expect.poll(() => waitsOnAccountLock("accept_after_suspend")).toBe("t");
      await suspension.finish();
      expect(await acceptance).toEqual(NOT_FOUND);
    } finally { await suspension.finish(); }
    expect(state(refused, XAV)).toBe("none");

    db().sql(`update public.private_social_accounts set ownership_state='active' where id='${XAV}'`);
    const accepted = freshCrew();
    const second = request(XAV, accepted);
    const acceptance = await hold(decideCall(accepted, second.request_id as string));
    expect(acceptance.result).toMatchObject({ ok: true, code: "accepted" });
    try {
      const suspending = waiting("suspend_after_accept", suspendCall(XAV_PROFILE));
      await expect.poll(() => waitsOnAccountLock("suspend_after_accept")).toBe("t");
      await acceptance.finish();
      expect(await suspending).toMatchObject({ ok: true, code: "suspended" });
    } finally { await acceptance.finish(); }
    expect(state(accepted, XAV)).toBe("active");
  });

  it("after 0243: the lock and admission helpers are not reachable by a browser role", () => {
    for (const role of ["anon", "authenticated"]) {
      expect(db().sql(`select has_function_privilege('${role}','public._lock_social_participant_accounts(uuid[])','execute')
        or has_function_privilege('${role}','public._social_crew_admission_refused(uuid,uuid)','execute')`)).toBe("f");
    }
  });

  it("rollback restores the old admission answers and drops the locks", () => {
    db().applyFile(join(directory, rollback));
    expect(db().sql(`select to_regprocedure('public._lock_social_participant_accounts(uuid[])') is null
      and to_regprocedure('public._social_crew_admission_refused(uuid,uuid)') is null
      and not exists(select 1 from pg_trigger where tgname='social_blocks_lock_participant_accounts')`)).toBe("t");
    const crew = freshCrew();
    block(XAV_PROFILE, ANA_PROFILE);
    admit(crew, XAV);
    expect(remove(crew, XAV)).toMatchObject({ ok: true, code: "removed" });
    admit(crew, XAV);
    expect(call(suspendCall(XAV_PROFILE))).toMatchObject({ ok: true, code: "suspended" });
  });
});
