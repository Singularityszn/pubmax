import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startPostgres, type PostgresSession } from "./helpers/postgres";

const migrations = join(process.cwd(), "supabase/migrations");
const completion = "20260930090000_0170_social_crew_completion.sql";
const id = (suffix: string) => `00000000-0000-4000-8000-0000000000${suffix}`;
let db: PostgresSession;

type Race = { kind: "social" | "classic"; suffix: number; auth: string; plan: string; completionSql: string };

function fixture(kind: Race["kind"], suffix: number): Race {
  const auth = id(`a${suffix}`);
  const plan = id(`b${suffix}`);
  const member = id(`d${suffix}`);
  const account = id(`f${suffix}`);
  const crew = id(`c${suffix}`);
  db.sql(`insert into auth.users(id) values('${auth}');
    insert into public.plans(id,title,start_time,status,owner_user_id)
    values('${plan}','Owner race','2030-03-11 20:00:00+00','active','${auth}');
    insert into public.plan_stops(plan_id,venue_id,venue_name,position)
    values('${plan}','owner-pub','Owner Pub',0);`);
  if (kind === "social") {
    db.sql(`insert into public.profiles(id,user_id,handle)
      values('${id(`e${suffix}`)}','${auth}','owner-race-${suffix}');
      insert into public.private_social_accounts(id,clerk_user_id,supabase_user_id,profile_id)
      values('${account}','owner-race-${suffix}','${auth}','${id(`e${suffix}`)}');
      insert into public.plan_crew_members
        (id,plan_id,name,token_hash,user_id,social_account_id,joined_at,updated_at)
      values('${member}','${plan}','Owner',md5('owner-${suffix}')||md5('owner2-${suffix}'),
        '${auth}','${account}','2030-03-11 19:00:00+00','2030-03-11 19:00:00+00');
      insert into public.social_crews(id,plan_id,owner_account_id)
      values('${crew}','${plan}','${account}');
      insert into public.social_crew_members
        (id,crew_id,social_account_id,plan_member_id,role,state)
      values('${id(`e${suffix + 4}`)}','${crew}','${account}','${member}','owner','active');
      update public.plans set social_owner_account_id='${account}' where id='${plan}';`);
  } else {
    db.sql(`insert into public.plan_crew_members
      (id,plan_id,name,token_hash,user_id,joined_at,updated_at)
      values('${member}','${plan}','Owner',md5('owner-${suffix}')||md5('owner2-${suffix}'),
        '${auth}','2030-03-11 19:00:00+00','2030-03-11 19:00:00+00');
      insert into public.plan_actions(id,plan_id,actor_member_id,type,stop_position,created_at)
      values('${id(`2${suffix}`)}','${plan}','${member}','arrived',0,'2030-03-11 20:30:00+00');`);
  }
  const ending = `'get_home',null,
    '{"kind":"get_home","optionId":"transport:home","evidenceSnapshot":{}}'::jsonb,
    '2030-03-11 21:00:00+00'::timestamptz`;
  const completionSql = kind === "social"
    ? `select public.complete_social_crew_plan_atomic('${account}','${crew}',1,
        '${id(`0${suffix}`)}','${id(`1${suffix}`)}','${id(`3${suffix}`)}',0,${ending});`
    : `select public.complete_plan_atomic('${plan}',md5('owner-${suffix}')||md5('owner2-${suffix}'),1,
        '${id(`0${suffix}`)}','${id(`1${suffix}`)}',${ending});`;
  return { kind, suffix, auth, plan, completionSql };
}

function session(): { child: ChildProcessWithoutNullStreams; output: () => string; errors: () => string } {
  const child = spawn(db.psql, [...db.databaseArgs, "-v", "VERBOSITY=verbose", "-q", "-t", "-A"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  let errors = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { errors += chunk.toString(); });
  return { child, output: () => output, errors: () => errors };
}

async function until(check: () => boolean, failure: string): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (check()) return;
    await sleep(25);
  }
  throw new Error(failure);
}

async function exited(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode === null) await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

beforeAll(async () => {
  db = await startPostgres({ label: "owner-deadlock", database: "owner_deadlock" });
  db.applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
  for (const file of readdirSync(migrations).filter((file) => file.endsWith(".sql") && file < completion).sort()) {
    db.applyFile(join(migrations, file));
  }
  db.applyFile(join(migrations, completion));
  db.applyFile(join(migrations, "20260930110000_0173_completion_group_active_accounts.sql"));
  db.sql(`create function public.pause_owner_completion() returns trigger
    language plpgsql as $$ begin
      if current_setting('application_name') = 'owner_completion_probe'
        and new.status = 'completed' and old.status <> new.status then
        perform pg_advisory_xact_lock(424242);
      end if;
      return new;
    end $$;
    create trigger pause_owner_completion before update on public.plans
      for each row execute function public.pause_owner_completion();`);
}, 300_000);

afterAll(async () => {
  if (db) await db.stop();
});

it.each(["social", "classic"] as const)("finishes %s completion before deleting claimed owner without deadlock", async (kind) => {
  const race = fixture(kind, kind === "social" ? 1 : 2);
  const barrier = session();
  barrier.child.stdin.write("select pg_advisory_lock(424242); select 'BARRIER_HELD';\n");
  await until(() => barrier.output().includes("BARRIER_HELD"), `Barrier did not lock: ${barrier.errors()}`);
  const completionAttempt = db.sqlAsync(`begin;
    set local application_name='owner_completion_probe';
    set local deadlock_timeout='100ms';
    set local statement_timeout='10s';
    ${race.completionSql}
    commit;`).then(
    (said) => ({ ok: true, said }),
    (error) => ({ ok: false, said: String(error) }),
  );
  try {
    await until(() => db.sql(`select count(*) from pg_stat_activity
      where application_name='owner_completion_probe' and wait_event='advisory'`) === "1",
    "Completion did not reach Plan update barrier");
    const deletionAttempt = db.attempt(`begin;
      set local application_name='owner_deletion_probe';
      set local deadlock_timeout='100ms';
      set local statement_timeout='10s';
      delete from auth.users where id='${race.auth}';
      commit;`);
    await until(() => db.sql(`select count(*) from pg_stat_activity
      where application_name='owner_deletion_probe' and wait_event_type='Lock'`) === "1",
    "Owner deletion did not wait on completion");
    barrier.child.stdin.end("select pg_advisory_unlock(424242);\n\\q\n");
    const [completed, deleted] = await Promise.all([completionAttempt, deletionAttempt]);
    expect(completed.ok, completed.said).toBe(true);
    expect(completed.said).toContain("completed");
    expect(deleted.ok, deleted.said).toBe(true);
    expect(db.sql(`select count(*) from pubmax_private.plan_completion_group_snapshots
      where plan_id='${race.plan}'`)).toBe("0");
    expect(db.sql(`select count(*) from public.plan_completions where plan_id='${race.plan}'`)).toBe("1");
  } finally {
    if (barrier.child.exitCode === null) barrier.child.stdin.end("select pg_advisory_unlock(424242);\n\\q\n");
    await exited(barrier.child);
  }
});

it.each(["social", "classic"] as const)("settles %s owner deletion before completion capture", async (kind) => {
  const race = fixture(kind, kind === "social" ? 3 : 4);
  const deletion = session();
  deletion.child.stdin.write(`begin;
    set local statement_timeout='10s';
    delete from auth.users where id='${race.auth}';
    select 'DELETED';\n`);
  try {
    await until(() => deletion.output().includes("DELETED"), `Deletion did not reach barrier: ${deletion.errors()}`);
    const completionAttempt = db.sqlAsync(`begin;
      set local application_name='owner_completion_probe';
      set local statement_timeout='10s';
      ${race.completionSql}
      commit;`).then(
      (said) => ({ ok: true, said }),
      (error) => ({ ok: false, said: String(error) }),
    );
    await until(() => db.sql(`select count(*) from pg_stat_activity
      where application_name='owner_completion_probe' and wait_event_type='Lock'`) === "1",
    "Completion did not wait on owner deletion");
    deletion.child.stdin.end("commit;\n\\q\n");
    const completed = await completionAttempt;
    expect(completed.ok, completed.said).toBe(true);
    expect(completed.said).toContain(kind === "social" ? "not_found" : "completed");
    expect(db.sql(`select count(*) from pubmax_private.plan_completion_group_snapshots
      where plan_id='${race.plan}' and account_keys && array['auth:${race.auth}', 'social:${id(`f${race.suffix}`)}']`)).toBe("0");
  } finally {
    if (deletion.child.exitCode === null) deletion.child.stdin.end("rollback;\n\\q\n");
    await exited(deletion.child);
  }
});
