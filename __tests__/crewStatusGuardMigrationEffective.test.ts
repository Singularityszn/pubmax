// Migration 0233 on a real PostgreSQL replay: one guarded writer for crew
// status. It refuses an ended seat, a member who left the crew and a Plan that
// ended, and no browser role can call it.

import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asBrowserRole, asServiceRole, postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const directory = join(process.cwd(), "supabase/migrations");
const name = "20261110150000_0233_crew_status_guard.sql";
const rollback = "rollback/20261110150000_0233_crew_status_guard_rollback.sql";

const PLAN = "a2330000-0000-4000-8000-000000000001";
const HOST = "a2330000-0000-4000-8000-000000000002";
const GUEST = "a2330000-0000-4000-8000-000000000003";
const HOST_HASH = "a".repeat(64);
const GUEST_HASH = "b".repeat(64);
const CREW_PLAN = "a2330000-0000-4000-8000-000000000011";
const CREW = "a2330000-0000-4000-8000-000000000012";
const OWNER_USER = "a2330000-0000-4000-8000-000000000021";
const MATE_USER = "a2330000-0000-4000-8000-000000000022";
const OWNER = "a2330000-0000-4000-8000-000000000031";
const MATE = "a2330000-0000-4000-8000-000000000032";
const OWNER_SEAT = "a2330000-0000-4000-8000-000000000041";
const MATE_SEAT = "a2330000-0000-4000-8000-000000000042";

let session: PostgresSession | null = null;
function db() { if (!session) throw new Error("The test database is not running."); return session; }

const byToken = (hash: string, status = "here", plan = PLAN) =>
  db().sql(asServiceRole(`select public.set_crew_status('${plan}','${status}','${hash}',null,null)`));
const bySeat = (seat: string, account: string, status = "here") =>
  db().sql(asServiceRole(`select public.set_crew_status('${CREW_PLAN}','${status}',null,'${seat}','${account}')`));
const seat = (id: string) => db().sql(`select status from public.plan_crew_members where id='${id}'`);

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "crew-status-0233", database: "crew_status_0233" });
  try {
    db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
    for (const file of readdirSync(directory).filter((entry) => entry.endsWith(".sql") && entry <= name).sort()) db().applyFile(join(directory, file));
    db().sql(`insert into public.plans(id,title,start_time,status) values ('${PLAN}','Our night',now(),'active');
      insert into public.plan_crew_members(id,plan_id,name,token_hash,can_collaborate,joined_at) values
        ('${HOST}','${PLAN}','Host','${HOST_HASH}',true,now()-interval '1 minute'),
        ('${GUEST}','${PLAN}','Guest','${GUEST_HASH}',true,now());
      insert into auth.users(id) values ('${OWNER_USER}'),('${MATE_USER}');
      insert into public.profiles(id,user_id,handle) values ('${OWNER_USER}','${OWNER_USER}','crewhost'),('${MATE_USER}','${MATE_USER}','crewmate');
      insert into public.private_social_accounts(id,clerk_user_id,supabase_user_id,profile_id,ownership_state) values
        ('${OWNER}','clerk-0233-owner','${OWNER_USER}','${OWNER_USER}','active'),
        ('${MATE}','clerk-0233-mate','${MATE_USER}','${MATE_USER}','active');
      insert into public.plans(id,title,start_time,owner_user_id,status,social_owner_account_id)
        values ('${CREW_PLAN}','Open crawl',now(),'${OWNER_USER}','active','${OWNER}');
      insert into public.plan_crew_members(id,plan_id,name,token_hash,status,user_id,joined_at,updated_at,can_collaborate,social_account_id) values
        ('${OWNER_SEAT}','${CREW_PLAN}','Crew host','${"e".repeat(64)}','in','${OWNER_USER}',now()-interval '1 minute',now(),true,'${OWNER}'),
        ('${MATE_SEAT}','${CREW_PLAN}','Crew mate','${"f".repeat(64)}','in','${MATE_USER}',now(),now(),true,'${MATE}');
      insert into public.social_crews(id,plan_id,owner_account_id,visibility) values ('${CREW}','${CREW_PLAN}','${OWNER}','open');
      insert into public.social_crew_members(crew_id,social_account_id,plan_member_id,role,state) values
        ('${CREW}','${OWNER}','${OWNER_SEAT}','owner','active'),
        ('${CREW}','${MATE}','${MATE_SEAT}','member','active');`);
  } catch (error) { await session.stop(); session = null; throw error; }
}, 600_000);
beforeEach(() => {
  if (!session) return;
  db().sql(`update public.plans set status='active' where id in ('${PLAN}','${CREW_PLAN}');
    update public.plan_crew_members set status='in', membership_revoked_at=null where plan_id in ('${PLAN}','${CREW_PLAN}');
    update public.social_crew_members set state='active', ended_at=null where crew_id='${CREW}';`);
});
afterAll(async () => { await session?.stop(); session = null; });

describe.skipIf(skipReason !== null)("0233 set_crew_status", () => {
  it("writes a legacy seat by its token and an open crawl seat by its active member", () => {
    expect(byToken(GUEST_HASH)).toBe("ok");
    expect(seat(GUEST)).toBe("here");
    expect(bySeat(MATE_SEAT, MATE)).toBe("ok");
    expect(seat(MATE_SEAT)).toBe("here");
  });

  it.each(["in", "on_the_way", "here", "running_late", "start_without_me"])("holds the crew lock until %s commits", async (status) => {
    const writer = spawn(db().psql, [...db().databaseArgs, "-q", "-t", "-A"], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let stderr = "";
    writer.stderr.on("data", (chunk) => { stderr += String(chunk); });
    const finished = new Promise<void>((resolve, reject) => {
      writer.once("error", reject);
      writer.once("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr)));
    });
    const ready = new Promise<void>((resolve, reject) => {
      writer.stdout.on("data", (chunk) => {
        output += String(chunk);
        if (output.includes("STATUS_WRITTEN")) resolve();
      });
      writer.once("error", reject);
      writer.once("exit", () => reject(new Error(`Writer exited before release: ${stderr}`)));
    });
    writer.stdin.write(`begin;
      set local role service_role;
      select public.set_crew_status('${CREW_PLAN}','${status}',null,'${MATE_SEAT}','${MATE}');
      \\echo STATUS_WRITTEN
    `);
    try {
      await ready;
      expect(output.trim().split(/\s+/)).toContain("ok");
      expect(db().expectRefusal(asServiceRole(`select id from public.social_crews where id='${CREW}' for update nowait`)))
        .toMatch(/could not obtain lock/);
    } finally {
      writer.stdin.end("commit;\n");
      await finished;
    }
    expect(seat(MATE_SEAT)).toBe(status);
    expect(db().sql(asServiceRole(`select id from public.social_crews where id='${CREW}' for update nowait`))).toBe(CREW);
  });

  it.each(["completed", "abandoned"])("refuses Here once the Plan is %s and writes nothing", (status) => {
    db().sql(`update public.plans set status='${status}' where id in ('${PLAN}','${CREW_PLAN}')`);
    expect(byToken(GUEST_HASH)).toBe("closed");
    expect(bySeat(MATE_SEAT, MATE)).toBe("closed");
    expect(seat(GUEST)).toBe("in");
    expect(seat(MATE_SEAT)).toBe("in");
  });

  it("still writes on an ending Plan", () => {
    db().sql(`update public.plans set status='ending' where id='${PLAN}'`);
    expect(byToken(GUEST_HASH, "on_the_way")).toBe("ok");
  });

  it.each(["left", "removed"])("refuses an ended seat, a %s member, another member's seat and a token on a crew Plan", (state) => {
    db().sql(`update public.plan_crew_members set membership_revoked_at=now() where id='${GUEST}'`);
    expect(byToken(GUEST_HASH)).toBe("forbidden");
    db().sql(`update public.social_crew_members set state='${state}', ended_at=now() where social_account_id='${MATE}'`);
    expect(bySeat(MATE_SEAT, MATE)).toBe("not_found");
    expect(bySeat(OWNER_SEAT, MATE)).toBe("not_found");
    expect(byToken("f".repeat(64), "here", CREW_PLAN)).toBe("not_found");
    expect(seat(GUEST)).toBe("in");
    expect(seat(MATE_SEAT)).toBe("in");
    expect(seat(OWNER_SEAT)).toBe("in");
  });

  it("refuses an unknown status and a call that names both doors or neither", () => {
    expect(byToken(GUEST_HASH, "asleep")).toBe("invalid");
    expect(db().sql(asServiceRole(`select public.set_crew_status('${PLAN}','here',null,null,null)`))).toBe("invalid");
    expect(db().sql(asServiceRole(`select public.set_crew_status('${CREW_PLAN}','here','${GUEST_HASH}','${MATE_SEAT}','${MATE}')`))).toBe("invalid");
  });

  it("is not reachable by a browser role", () => {
    for (const role of ["anon", "authenticated"] as const) {
      expect(db().expectRefusal(asBrowserRole(role, MATE_USER, `select public.set_crew_status('${PLAN}','here','${GUEST_HASH}',null,null)`)))
        .toMatch(/permission denied/);
    }
  });

  it("rollback removes the function", () => {
    db().applyFile(join(directory, rollback));
    expect(db().sql("select to_regprocedure('public.set_crew_status(uuid,text,text,uuid,uuid)') is null")).toBe("t");
  });
});
