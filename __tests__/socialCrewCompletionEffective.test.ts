import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const migrations = join(process.cwd(), "supabase/migrations");
const name = "20261001092100_0181_social_crew_completion.sql";
const forward = join(migrations, name);
const privacyForward = join(migrations, "20261001092200_0182_completion_group_active_accounts.sql");
const privacyRollback = join(migrations, "rollback/20261001092200_0182_completion_group_active_accounts_rollback.sql");
const prerequisites = readdirSync(migrations).filter((file) => file.endsWith(".sql") && file < name).sort();
const id = (suffix: string) => `00000000-0000-4000-8000-0000000000${suffix}`;
let db: PostgresSession | null = null;
let originalCapture = "";

function pg(): PostgresSession {
  if (!db) throw new Error("PostgreSQL session unavailable");
  return db;
}

const crewId = id("e0");
const planId = id("b0");
const host = id("f1");
const member = id("f2");
const removed = id("f3");
const stranger = id("f4");

function complete(actor: string, revision = 1, arrival = 0,
  selection = '{"kind":"get_home","optionId":"transport:home","evidenceSnapshot":{}}'): string {
  return pg().sql(`select public.complete_social_crew_plan_atomic(
    '${actor}', '${crewId}', ${revision}, '${id("c0")}', '${id("d0")}', '${id("d1")}',
    ${arrival}, 'get_home', null,
    '${selection}'::jsonb,
    '2030-03-06 21:00:00+00'::timestamptz)`);
}

beforeAll(async () => {
  if (skipReason) return;
  db = await startPostgres({ label: "social-complete-0181", database: "pubmax_social_complete" });
  db.applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
  for (const file of prerequisites) db.applyFile(join(migrations, file));
  for (const [account, auth, profile, planMember] of ([
    ["f1", "a1", "e1", "a5"],
    ["f2", "a2", "e2", "a6"],
    ["f3", "a3", "e3", "a7"],
    ["f4", "a4", "e4", null],
  ] as const)) {
    db.sql(`insert into auth.users(id) values('${id(auth)}');
      insert into public.profiles(id,user_id,handle) values('${id(profile)}','${id(auth)}','social-complete-${account}');
      insert into public.private_social_accounts(id,clerk_user_id,supabase_user_id,profile_id)
      values('${id(account)}','social-complete-${account}','${id(auth)}','${id(profile)}');`);
    if (planMember) {
      db.sql(`insert into public.plans(id,title,start_time,status)
        values('${planId}','Social completion night','2030-03-06 20:00:00+00','active')
        on conflict (id) do nothing;
        insert into public.plan_crew_members
          (id,plan_id,name,token_hash,user_id,social_account_id,joined_at,updated_at)
        values('${id(planMember)}','${planId}','Member',md5('${planMember}')||md5('${planMember}2'),
          '${id(auth)}','${id(account)}','2030-03-06 19:00:00+00','2030-03-06 19:00:00+00');`);
    }
  }
  db.sql(`insert into public.plan_stops(plan_id,venue_id,venue_name,position)
    values('${planId}','social-pub','Social Pub',0);
    insert into public.social_crews(id,plan_id,owner_account_id)
    values('${crewId}','${planId}','${host}');
    insert into public.social_crew_members
      (id,crew_id,social_account_id,plan_member_id,role,state,ended_at) values
      ('${id("e5")}','${crewId}','${host}','${id("a5")}','owner','active',null),
      ('${id("e6")}','${crewId}','${member}','${id("a6")}','member','active',null),
      ('${id("e7")}','${crewId}','${removed}','${id("a7")}','member','removed','2030-03-06 19:30:00+00');
    update public.plans set social_owner_account_id='${host}' where id='${planId}';`);
}, 300_000);

afterAll(async () => {
  if (db) await db.stop();
  db = null;
});

describe.skipIf(skipReason !== null)("Social Crew completion through authorized RPC", () => {
  it("refuses nonowners and stale revisions without a side effect", () => {
    pg().applyFile(forward);
    for (const actor of [member, removed, stranger]) expect(complete(actor)).toBe("not_found");
    expect(complete(host, 2)).toBe("conflict");
    expect(complete(host, 1, 7)).toBe("invalid");
    expect(complete(host, 1, 0, '{"optionId":"transport:home","evidenceSnapshot":{}}')).toBe("invalid");
    expect(complete(host, 1, 0, '{"kind":"get_home","optionId":"transport:home"}')).toBe("invalid");
    expect(pg().sql(`select count(*) from public.plan_completions where plan_id='${planId}'`)).toBe("0");
    expect(pg().sql(`select count(*) from public.plan_actions where plan_id='${planId}'`)).toBe("0");
  });

  it("serializes two service-role owner completions into one private group snapshot", async () => {
    const startsAt = new Date(Date.now() + 1200).toISOString();
    const finish = (suffix: string) => `begin;
      set local role service_role;
      set local statement_timeout = '10s';
      select pg_sleep(greatest(0, extract(epoch from timestamptz '${startsAt}' - clock_timestamp())));
      select public.complete_social_crew_plan_atomic(
        '${host}','${crewId}',1,'${id(`c${suffix}`)}','${id(`d${suffix}`)}','${id(`e${suffix}`)}',
        0,'get_home',null,
        '{"kind":"get_home","optionId":"transport:home","evidenceSnapshot":{}}'::jsonb,
        '2030-03-06 21:00:00+00'::timestamptz);
      commit;`;
    const results = await Promise.all([
      pg().sqlAsync(finish("2")),
      pg().sqlAsync(finish("3")),
    ]);
    expect(results.sort()).toEqual(["already_completed", "completed"]);
    expect(complete(host)).toBe("already_completed");
    expect(pg().sql(`select status || ':' || ending from public.plans where id='${planId}'`)).toBe("completed:get_home");
    expect(pg().sql(`select count(*) from public.plan_completions where plan_id='${planId}'`)).toBe("1");
    expect(pg().sql(`select string_agg(type, ',' order by type) from public.plan_actions where plan_id='${planId}'`)).toBe("arrived,ending");
    expect(pg().sql(`select array_to_string(account_keys, ',')
      from pubmax_private.plan_completion_group_snapshots where plan_id='${planId}'`))
      .toBe(`social:${host},social:${member}`);
    expect(pg().sql(`select groups_completed || ':' || groups_repeated
      from pubmax_private.completion_group_week('2030-03-06')`)).toBe("1:0");
  });

  it("excludes an identity when auth deletion cleanup precedes concurrent completion", async () => {
    if (pg().sql(`select to_regprocedure('public.complete_social_crew_plan_atomic(uuid,uuid,integer,uuid,uuid,uuid,integer,text,text,jsonb,timestamptz)') is null`) === "t") {
      pg().applyFile(forward);
    }
    originalCapture = pg().sql(`select pg_get_functiondef(
      'pubmax_private.snapshot_plan_completion_group()'::regprocedure)`);
    pg().applyFile(privacyForward);
    const racePlan = id("b3");
    const raceCrew = id("eb");
    pg().sql(`insert into public.plans(id,title,start_time,status)
      values('${racePlan}','Raced Social night','2030-03-09 20:00:00+00','active');
      insert into public.plan_stops(plan_id,venue_id,venue_name,position)
      values('${racePlan}','race-pub','Race Pub',0);
      insert into public.plan_crew_members
        (id,plan_id,name,token_hash,user_id,social_account_id,joined_at,updated_at) values
        ('${id("ac")}','${racePlan}','Host',md5('race-host')||md5('race-host-2'),
          '${id("a1")}','${host}','2030-03-09 19:00:00+00','2030-03-09 19:00:00+00'),
        ('${id("ad")}','${racePlan}','Member',md5('race-member')||md5('race-member-2'),
          null,'${removed}','2030-03-09 19:00:00+00','2030-03-09 19:00:00+00');
      insert into public.social_crews(id,plan_id,owner_account_id)
      values('${raceCrew}','${racePlan}','${host}');
      insert into public.social_crew_members
        (id,crew_id,social_account_id,plan_member_id,role,state) values
        ('${id("ec")}','${raceCrew}','${host}','${id("ac")}','owner','active'),
        ('${id("ee")}','${raceCrew}','${removed}','${id("ad")}','member','active');
      update public.plans set social_owner_account_id='${host}' where id='${racePlan}';`);

    const deleter = spawn(pg().psql, [...pg().databaseArgs, "-q", "-t", "-A"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let errors = "";
    deleter.stdout!.setEncoding("utf8");
    deleter.stderr!.setEncoding("utf8");
    deleter.stdout!.on("data", (chunk: string) => { output += chunk; });
    deleter.stderr!.on("data", (chunk: string) => { errors += chunk; });
    deleter.stdin!.write(`begin;
      delete from auth.users where id='${id("a3")}';
      select 'DELETE_CLEANUP_DONE';
    `);
    let committed = false;
    try {
      for (let i = 0; !output.includes("DELETE_CLEANUP_DONE"); i += 1) {
        if (deleter.exitCode !== null) throw new Error(`Deletion failed: ${errors}`);
        if (i === 400) throw new Error(`Deletion never reached cleanup barrier: ${errors}`);
        await sleep(25);
      }
      expect(pg().sql(`select count(*) from auth.users where id='${id("a3")}'`)).toBe("1");
      const completion = pg().sqlAsync(`begin;
        set local application_name='completion_group_delete_race';
        set local statement_timeout='10s';
        select public.complete_social_crew_plan_atomic(
          '${host}', '${raceCrew}', 1, '${id("c6")}', '${id("d7")}', '${id("d8")}',
          0, 'get_home', null,
          '{"kind":"get_home","optionId":"transport:home","evidenceSnapshot":{}}'::jsonb,
          '2030-03-09 21:00:00+00'::timestamptz);
        commit;`);
      let settled = false;
      void completion.then(() => { settled = true; }, () => { settled = true; });
      for (let i = 0; !settled; i += 1) {
        const waiting = pg().sql(`select count(*) from pg_stat_activity
          where application_name='completion_group_delete_race'
            and wait_event_type='Lock'`);
        if (waiting === "1") break;
        if (i === 400) throw new Error("Completion neither finished nor waited on deletion lock");
        await sleep(25);
      }
      deleter.stdin!.end("commit;\n\\q\n");
      committed = true;
      expect(await completion).toContain("completed");
    } finally {
      if (!committed && deleter.exitCode === null) deleter.stdin!.end("rollback;\n\\q\n");
      if (deleter.exitCode === null) {
        await Promise.race([
          new Promise<void>((resolve) => deleter.once("exit", () => resolve())),
          sleep(10_000).then(() => { deleter.kill("SIGTERM"); throw new Error("Deleter did not exit"); }),
        ]);
      }
      expect(deleter.exitCode).toBe(0);
      expect(errors).toBe("");
    }
    expect(pg().sql(`select array_to_string(account_keys, ',')
      from pubmax_private.plan_completion_group_snapshots where plan_id='${racePlan}'`))
      .toBe(`social:${host}`);
  });

  it("erases a snapshot when completion commits before concurrent auth deletion", async () => {
    const racePlan = id("b4");
    const raceCrew = id("ef");
    const raceAccount = id("f5");
    const raceAuth = id("a9");
    pg().sql(`insert into auth.users(id) values('${raceAuth}');
      insert into public.profiles(id,user_id,handle)
      values('${id("e8")}','${raceAuth}','social-complete-race-after');
      insert into public.private_social_accounts(id,clerk_user_id,supabase_user_id,profile_id)
      values('${raceAccount}','social-complete-race-after','${raceAuth}','${id("e8")}');
      insert into public.plans(id,title,start_time,status)
      values('${racePlan}','Completion first Social night','2030-03-10 20:00:00+00','active');
      insert into public.plan_stops(plan_id,venue_id,venue_name,position)
      values('${racePlan}','race-after-pub','Race After Pub',0);
      insert into public.plan_crew_members
        (id,plan_id,name,token_hash,user_id,social_account_id,joined_at,updated_at) values
        ('${id("ae")}','${racePlan}','Host',md5('race-after-host')||md5('race-after-host-2'),
          '${id("a1")}','${host}','2030-03-10 19:00:00+00','2030-03-10 19:00:00+00'),
        ('${id("af")}','${racePlan}','Member',md5('race-after-member')||md5('race-after-member-2'),
          '${raceAuth}','${raceAccount}','2030-03-10 19:00:00+00','2030-03-10 19:00:00+00');
      insert into public.social_crews(id,plan_id,owner_account_id)
      values('${raceCrew}','${racePlan}','${host}');
      insert into public.social_crew_members
        (id,crew_id,social_account_id,plan_member_id,role,state) values
        ('${id("f6")}','${raceCrew}','${host}','${id("ae")}','owner','active'),
        ('${id("f7")}','${raceCrew}','${raceAccount}','${id("af")}','member','active');
      update public.plans set social_owner_account_id='${host}' where id='${racePlan}';`);

    const completer = spawn(pg().psql, [...pg().databaseArgs, "-q", "-t", "-A"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let errors = "";
    completer.stdout!.setEncoding("utf8");
    completer.stderr!.setEncoding("utf8");
    completer.stdout!.on("data", (chunk: string) => { output += chunk; });
    completer.stderr!.on("data", (chunk: string) => { errors += chunk; });
    completer.stdin!.write(`begin;
      set local statement_timeout='10s';
      select public.complete_social_crew_plan_atomic(
        '${host}', '${raceCrew}', 1, '${id("c7")}', '${id("d9")}', '${id("da")}',
        0, 'get_home', null,
        '{"kind":"get_home","optionId":"transport:home","evidenceSnapshot":{}}'::jsonb,
        '2030-03-10 21:00:00+00'::timestamptz);
      select array_to_string(account_keys, ',')
      from pubmax_private.plan_completion_group_snapshots where plan_id='${racePlan}';
      select 'COMPLETION_CAPTURE_DONE';
    `);
    let committed = false;
    try {
      for (let i = 0; !output.includes("COMPLETION_CAPTURE_DONE"); i += 1) {
        if (completer.exitCode !== null) throw new Error(`Completion failed: ${errors}`);
        if (i === 400) throw new Error(`Completion never reached capture barrier: ${errors}`);
        await sleep(25);
      }
      expect(output).toContain("completed");
      expect(output).toContain(`social:${host},social:${raceAccount}`);
      expect(pg().sql(`select count(*) from pubmax_private.plan_completion_group_snapshots
        where plan_id='${racePlan}'`)).toBe("0");
      const deletion = pg().sqlAsync(`begin;
        set local application_name='completion_group_delete_after_capture';
        set local statement_timeout='10s';
        delete from auth.users where id='${raceAuth}';
        commit;`);
      let settled = false;
      void deletion.then(() => { settled = true; }, () => { settled = true; });
      for (let i = 0; !settled; i += 1) {
        const waiting = pg().sql(`select count(*) from pg_stat_activity
          where application_name='completion_group_delete_after_capture'
            and wait_event_type='Lock'`);
        if (waiting === "1") break;
        if (i === 400) throw new Error("Deletion neither finished nor waited on completion lock");
        await sleep(25);
      }
      expect(settled).toBe(false);
      completer.stdin!.end("commit;\n\\q\n");
      committed = true;
      await deletion;
    } finally {
      if (!committed && completer.exitCode === null) completer.stdin!.end("rollback;\n\\q\n");
      if (completer.exitCode === null) {
        await Promise.race([
          new Promise<void>((resolve) => completer.once("exit", () => resolve())),
          sleep(10_000).then(() => { completer.kill("SIGTERM"); throw new Error("Completer did not exit"); }),
        ]);
      }
      expect(completer.exitCode).toBe(0);
      expect(errors).toBe("");
    }
    expect(pg().sql(`select count(*) from pubmax_private.plan_completion_group_snapshots
      where plan_id='${racePlan}'`)).toBe("0");
    expect(pg().sql(`select count(*) from public.plan_completions where plan_id='${racePlan}'`)).toBe("1");
    expect(pg().sql(`select public.complete_social_crew_plan_atomic(
      '${host}', '${raceCrew}', 1, '${id("c7")}', '${id("d9")}', '${id("da")}',
      0, 'get_home', null,
      '{"kind":"get_home","optionId":"transport:home","evidenceSnapshot":{}}'::jsonb,
      '2030-03-10 21:00:00+00'::timestamptz)`)).toBe("already_completed");
  });

  it("omits a deleted Social member from a later authorized completion", () => {
    const laterPlan = id("b1");
    const laterCrew = id("e8");
    pg().sql(`insert into public.plans(id,title,start_time,status)
      values('${laterPlan}','Later Social night','2030-03-07 20:00:00+00','active');
      insert into public.plan_stops(plan_id,venue_id,venue_name,position)
      values('${laterPlan}','later-pub','Later Pub',0);
      insert into public.plan_crew_members
        (id,plan_id,name,token_hash,user_id,social_account_id,joined_at,updated_at) values
        ('${id("a8")}','${laterPlan}','Host',md5('later-host')||md5('later-host-2'),
          '${id("a1")}','${host}','2030-03-07 19:00:00+00','2030-03-07 19:00:00+00'),
        ('${id("a9")}','${laterPlan}','Guest',md5('later-guest')||md5('later-guest-2'),
          '${id("a2")}','${member}','2030-03-07 19:00:00+00','2030-03-07 19:00:00+00');
      insert into public.social_crews(id,plan_id,owner_account_id)
      values('${laterCrew}','${laterPlan}','${host}');
      insert into public.social_crew_members
        (id,crew_id,social_account_id,plan_member_id,role,state,ended_at) values
        ('${id("e9")}','${laterCrew}','${host}','${id("a8")}','owner','active',null),
        ('${id("ea")}','${laterCrew}','${member}','${id("a9")}','member','active',null);
      update public.plans set social_owner_account_id='${host}' where id='${laterPlan}';
      delete from auth.users where id='${id("a2")}';`);
    expect(pg().sql(`select ownership_state || ':' || coalesce(supabase_user_id::text, 'null')
      from public.private_social_accounts where id='${member}'`)).toBe("suspended:null");
    expect(pg().sql(`select state from public.social_crew_members where id='${id("ea")}'`)).toBe("active");
    expect(pg().sql(`select count(*) from pubmax_private.plan_completion_group_snapshots
      where plan_id='${planId}'`)).toBe("0");
    expect(pg().sql(`select public.complete_social_crew_plan_atomic(
      '${host}', '${laterCrew}', 1, '${id("c4")}', '${id("d4")}', '${id("d5")}',
      0, 'get_home', null,
      '{"kind":"get_home","optionId":"transport:home","evidenceSnapshot":{}}'::jsonb,
      '2030-03-07 21:00:00+00'::timestamptz)`)).toBe("completed");
    expect(pg().sql(`select array_to_string(account_keys, ',')
      from pubmax_private.plan_completion_group_snapshots where plan_id='${laterPlan}'`))
      .toBe(`social:${host}`);
  });

  it("requires an existing auth identity for a classic member at completion", () => {
    const classicPlan = id("b2");
    const guest = id("ab");
    pg().sql(`insert into public.plans(id,title,start_time,status)
      values('${classicPlan}','Classic night','2030-03-08 20:00:00+00','active');
      insert into public.plan_stops(plan_id,venue_id,venue_name,position)
      values('${classicPlan}','classic-pub','Classic Pub',0);
      insert into public.plan_crew_members
        (id,plan_id,name,token_hash,user_id,joined_at,updated_at) values
        ('${id("aa")}','${classicPlan}','Host',md5('classic-host')||md5('classic-host-2'),
          '${id("a1")}','2030-03-08 19:00:00+00','2030-03-08 19:00:00+00'),
        ('${guest}','${classicPlan}','Guest',md5('classic-guest')||md5('classic-guest-2'),
          '${id("a4")}','2030-03-08 19:00:00+00','2030-03-08 19:00:00+00');
      insert into public.plan_actions(id,plan_id,actor_member_id,type,stop_position,created_at)
      values('${id("ed")}','${classicPlan}','${id("aa")}','arrived',0,'2030-03-08 20:30:00+00');
      delete from auth.users where id='${id("a4")}';`);
    expect(pg().sql(`select user_id is null from public.plan_crew_members where id='${guest}'`)).toBe("t");
    pg().sql(`alter table public.plan_crew_members disable trigger all;
      update public.plan_crew_members set user_id='${id("a4")}' where id='${guest}';
      alter table public.plan_crew_members enable trigger all;`);
    expect(pg().sql(`select count(*) from auth.users where id='${id("a4")}'`)).toBe("0");
    expect(pg().sql(`select public.complete_plan_atomic(
      '${classicPlan}', md5('classic-host')||md5('classic-host-2'), 1,
      '${id("c5")}', '${id("d6")}', 'get_home', null,
      '{"kind":"get_home","optionId":"transport:home","evidenceSnapshot":{}}'::jsonb,
      '2030-03-08 21:00:00+00'::timestamptz)`)).toBe("completed");
    expect(pg().sql(`select array_to_string(account_keys, ',')
      from pubmax_private.plan_completion_group_snapshots where plan_id='${classicPlan}'`))
      .toBe(`social:${host}`);
  });

  it("does not grant clients direct completion access", () => {
    expect(pg().expectRefusal(`set role authenticated;
      select public.complete_social_crew_plan_atomic('${host}','${crewId}',1,
        '${id("c1")}','${id("d2")}','${id("d3")}',0,'get_home',null,'{}'::jsonb,now());
      reset role;`)).toMatch(/permission denied/i);
  });

  it("removes the write path on rollback without erasing completed records", () => {
    pg().applyFile(privacyRollback);
    expect(pg().sql(`select pg_get_functiondef(
      'pubmax_private.snapshot_plan_completion_group()'::regprocedure)`)).toBe(originalCapture);
    expect(pg().sql(`select to_regprocedure('pubmax_private.lock_plan_completion_identities(uuid)') is null`)).toBe("t");
    pg().applyFile(join(migrations, "rollback/20261001092100_0181_social_crew_completion_rollback.sql"));
    expect(pg().sql(`select to_regprocedure('public.complete_social_crew_plan_atomic(uuid,uuid,integer,uuid,uuid,uuid,integer,text,text,jsonb,timestamptz)') is null`)).toBe("t");
    expect(pg().sql(`select count(*) from public.plan_completions where plan_id='${planId}'`)).toBe("1");
  });
});
