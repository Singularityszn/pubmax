import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startPostgres, type PostgresSession } from "./helpers/postgres";

const migrations = join(process.cwd(), "supabase/migrations");
const completion = "20260930090000_0170_social_crew_completion.sql";
const id = (suffix: string) => `00000000-0000-4000-8000-0000000000${suffix}`;
const auth = id("a1");
const account = id("f1");
const profile = id("e1");
const plan = id("b1");
const crew = id("c1");
const member = id("d1");
let db: PostgresSession;

beforeAll(async () => {
  db = await startPostgres({ label: "owner-deadlock", database: "owner_deadlock" });
  db.applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
  for (const file of readdirSync(migrations).filter((file) => file.endsWith(".sql") && file < completion).sort()) {
    db.applyFile(join(migrations, file));
  }
  db.applyFile(join(migrations, completion));
  db.applyFile(join(migrations, "20260930110000_0173_completion_group_active_accounts.sql"));
  db.sql(`insert into auth.users(id) values('${auth}');
    insert into public.profiles(id,user_id,handle) values('${profile}','${auth}','owner-race');
    insert into public.private_social_accounts(id,clerk_user_id,supabase_user_id,profile_id)
    values('${account}','owner-race','${auth}','${profile}');
    insert into public.plans(id,title,start_time,status,owner_user_id)
    values('${plan}','Owner race','2030-03-11 20:00:00+00','active','${auth}');
    insert into public.plan_stops(plan_id,venue_id,venue_name,position)
    values('${plan}','owner-pub','Owner Pub',0);
    insert into public.plan_crew_members
      (id,plan_id,name,token_hash,user_id,social_account_id,joined_at,updated_at)
    values('${member}','${plan}','Owner',md5('owner')||md5('owner2'),
      '${auth}','${account}','2030-03-11 19:00:00+00','2030-03-11 19:00:00+00');
    insert into public.social_crews(id,plan_id,owner_account_id)
    values('${crew}','${plan}','${account}');
    insert into public.social_crew_members
      (id,crew_id,social_account_id,plan_member_id,role,state)
    values('${id("e2")}','${crew}','${account}','${member}','owner','active');
    update public.plans set social_owner_account_id='${account}' where id='${plan}';`);
}, 300_000);

afterAll(async () => {
  if (db) await db.stop();
});

it("records the owner auth deletion deadlock while completion holds the Plan", async () => {
  const completer = spawn(db.psql, [...db.databaseArgs, "-v", "VERBOSITY=verbose", "-q", "-t", "-A"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  let errors = "";
  completer.stdout!.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  completer.stderr!.on("data", (chunk: Buffer) => { errors += chunk.toString(); });
  completer.stdin!.write(`begin;
    set local application_name='owner_completion_probe';
    set local deadlock_timeout='100ms';
    set local statement_timeout='10s';
    select id from public.plans where id='${plan}' for update;
    select 'PLAN_LOCKED';
  `);
  try {
    for (let i = 0; !output.includes("PLAN_LOCKED"); i += 1) {
      if (i === 400) throw new Error(`Plan lock never reached: ${errors}`);
      await sleep(25);
    }
    const deletion = db.attempt(`begin;
      set local application_name='owner_deletion_probe';
      set local deadlock_timeout='100ms';
      set local statement_timeout='10s';
      delete from auth.users where id='${auth}';
      commit;`);
    for (let i = 0; i < 400; i += 1) {
      const waiting = db.sql(`select count(*) from pg_stat_activity
        where application_name='owner_deletion_probe' and wait_event_type='Lock'`);
      if (waiting === "1") break;
      if (i === 399) throw new Error("Deletion never waited on plan lock");
      await sleep(25);
    }
    completer.stdin!.end(`select public.complete_social_crew_plan_atomic(
      '${account}','${crew}',1,'${id("c2")}','${id("d2")}','${id("d3")}',
      0,'get_home',null,
      '{"kind":"get_home","optionId":"transport:home","evidenceSnapshot":{}}'::jsonb,
      '2030-03-11 21:00:00+00'::timestamptz);
      commit;
      \\q
    `);
    const deleted = await deletion;
    await new Promise<void>((resolve) => completer.once("exit", () => resolve()));
    expect(`${deleted.said}\n${errors}`).toMatch(/40P01: deadlock detected/i);
  } finally {
    if (completer.exitCode === null) {
      completer.stdin!.end("rollback;\n\\q\n");
      await new Promise<void>((resolve) => completer.once("exit", () => resolve()));
    }
  }
});
