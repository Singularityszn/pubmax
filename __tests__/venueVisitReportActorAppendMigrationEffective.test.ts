import { spawn } from "node:child_process";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { listMigrations } from "../scripts/qa/migration-apply-list.mjs";
import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";

const skipReason = postgresSkipReason();
const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const NAME = "20261004233000_0174_venue_photo_and_visit_report_actor_append";
const FORWARD = join(MIGRATIONS, `${NAME}.sql`);
const ROLLBACK = join(MIGRATIONS, "rollback", `${NAME}_rollback.sql`);
const PROFILE = "10000000-0000-4000-8000-000000000174";
const ABSENT = "90000000-0000-4000-8000-000000000174";
const AT = "2026-10-04T12:00:00Z";
const TARGETS = [
  { table: "venue_photos", rpc: "append_venue_photo_report_actor", id: "20000000-0000-4000-8000-000000000174", column: "moderation_state", visible: "approved" },
  { table: "structured_visit_reports", rpc: "append_visit_report_report_actor", id: "30000000-0000-4000-8000-000000000174", column: "status", visible: "visible" },
] as const;
type Target = typeof TARGETS[number];
let session: PostgresSession | null = null;
let tableCatalog: string;

function db(): PostgresSession {
  if (!session) throw new Error("Reporter PostgreSQL session unavailable.");
  return session;
}

function catalog(): string {
  return db().sql(`select jsonb_build_object(
    'tables', (select jsonb_agg(jsonb_build_object('name', c.relname, 'rls', c.relrowsecurity, 'acl', c.relacl::text) order by c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('venue_photos', 'structured_visit_reports')),
    'policies', (select jsonb_agg(to_jsonb(p) order by p.tablename, p.policyname)
      from pg_policies p where p.schemaname = 'public' and p.tablename in ('venue_photos', 'structured_visit_reports'))
  )::text`);
}

function rowSnapshot(target: Target): string {
  return db().sql(`select to_jsonb(t)::text from public.${target.table} t where id = '${target.id}'`);
}

function asService(target: Target, actor: string, reason = "null"): string {
  return `begin; set local role service_role; select public.${target.rpc}('${target.id}', '${actor}', ${reason}); commit;`;
}

async function bounded<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

/** Hold the real target row until every contender is observed waiting on a lock. */
async function throughLockBarrier(target: Target, statements: string[], mutation = ""): Promise<string[]> {
  const holder = spawn(db().psql, [...db().databaseArgs, "-q", "-t", "-A", "-f", "-"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  let stdout = "";
  let lockedPid: number | undefined;
  let rejectLock: (error: Error) => void;
  const locked = new Promise<number>((resolve, reject) => {
    rejectLock = reject;
    holder.stdout.setEncoding("utf8");
    holder.stdout.on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(-4_000);
      const match = /REPORTER_LOCK_HELD:(\d+)/.exec(stdout);
      if (match) {
        lockedPid = Number(match[1]);
        resolve(lockedPid);
      }
    });
  });
  holder.stderr.setEncoding("utf8");
  holder.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-4_000); });
  const holderDone = new Promise<number | null>((resolve, reject) => {
    holder.once("error", (error) => { rejectLock(error); reject(error); });
    holder.once("exit", (code) => {
      if (lockedPid === undefined) rejectLock(new Error(`Reporter lock holder exited before barrier (${code}): ${stderr}`));
      resolve(code);
    });
  });
  // Attach rejection handlers before an asynchronous connection can fail.
  void holderDone.catch(() => undefined);
  holder.stdin.on("error", (error) => { rejectLock(error); });
  holder.stdin.write(`begin;
    select id from public.${target.table} where id = '${target.id}' for update;
    ${mutation}
    select 'REPORTER_LOCK_HELD:' || pg_backend_pid();\n`);
  let contenders: Promise<PromiseSettledResult<string>[]> | undefined;
  let releaseWithCommit = false;
  try {
    const holderPid = await bounded(locked, 5_000, "Reporter row lock was not acquired");
    const name = `reporter-race-${target.table}`;
    contenders = Promise.allSettled(statements.map((statement) => db().sqlAsync(
      `set application_name = '${name}'; ${statement}`,
    )));
    const deadline = Date.now() + 5_000;
    for (;;) {
      const waiting = Number(await db().sqlAsync(`select count(*) from pg_stat_activity
        where application_name = '${name}' and wait_event_type = 'Lock'
          and cardinality(pg_blocking_pids(pid)) > 0`));
      if (waiting === statements.length) break;
      if (holder.exitCode !== null || Date.now() >= deadline) {
        throw new Error(`Reporter contenders did not reach the row lock (${waiting}/${statements.length}), holder ${holderPid}: ${stderr}`);
      }
      await sleep(20);
    }
    releaseWithCommit = true;
  } finally {
    // Both success and failure release the holder. The harness also bounds
    // an idle transaction at 15 seconds and lock waits at 15 seconds.
    if (!holder.stdin.destroyed) holder.stdin.end(releaseWithCommit ? "commit;\n" : "rollback;\n");
    try {
      const code = await bounded(holderDone, 5_000, "Reporter lock holder did not finish");
      if (code !== 0) throw new Error(`Reporter lock holder failed (${code}): ${stderr}`);
    } finally {
      if (holder.exitCode === null) holder.kill("SIGTERM");
      if (contenders) await bounded(contenders, 20_000, "Reporter contenders did not finish after lock release");
    }
  }
  if (!contenders) throw new Error("Reporter contenders were not started");
  const results = await contenders;
  return results.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
}

beforeAll(async () => {
  if (skipReason) return;
  session = await startPostgres({ label: "report-actors", database: "pubmax_report_actors" });
  db().applyFile(join(process.cwd(), "scripts/rls/session-fixture.sql"));
  // Use the real catalog, constraints, grants and RLS, not donor-only tables.
  for (const filename of listMigrations(MIGRATIONS).filter((file) => file < `${NAME}.sql`)) {
    db().applyFile(join(MIGRATIONS, filename));
  }
  tableCatalog = catalog();
  db().applyFile(FORWARD);
  db().sql(`
    insert into public.profiles (id, handle) values ('${PROFILE}', 'fixture_reporter');
    insert into public.venue_photos (id, venue_id, author_actor, author_profile_id, object_key, width, height)
      values ('${TARGETS[0].id}', 'fixture-pub', 'profile:${PROFILE}', '${PROFILE}',
        'venue-photos/fixture-pub/${TARGETS[0].id}.jpg', 100, 100);
    insert into public.structured_visit_reports (id, venue_id, handle, visited_at)
      values ('${TARGETS[1].id}', 'fixture-pub', 'fixture_reporter', '2026-10-03');
  `);
}, 300_000);

beforeEach(() => {
  if (skipReason) return;
  for (const target of TARGETS) db().sql(`update public.${target.table}
    set report_actors = '{}', report_count = 0, reported_at = null,
      report_reason = 'existing reason', moderated_at = '${AT}', moderator_note = 'kept note',
      ${target.column} = '${target.visible}' where id = '${target.id}'`);
});

afterAll(async () => {
  await session?.stop();
});

describe.skipIf(skipReason !== null)("provisional 0174 atomic report actors", () => {
  it.each(TARGETS)("retains concurrent distinct and duplicate actors in $table", async (target) => {
    const results = await throughLockBarrier(target, [
      asService(target, "actor-a", "' first reason '"),
      asService(target, "actor-b", "'second reason'"),
      asService(target, "actor-a", "'duplicate reason'"),
      asService(target, "actor-b", "'duplicate reason'"),
    ]);
    expect(results).toEqual(["t", "t", "t", "t"]);
    expect(db().sql(`select report_count || ':' || cardinality(report_actors) || ':' ||
      (moderated_at is null)::text || ':' || ${target.column}
      from public.${target.table} where id = '${target.id}'`)).toBe(`2:2:true:${target.visible}`);
    expect(db().sql(`select string_agg(actor, ',' order by actor)
      from public.${target.table}, unnest(report_actors) actor where id = '${target.id}'`)).toBe("actor-a,actor-b");
    const before = rowSnapshot(target);
    expect(db().sql(asService(target, "actor-a", "'replace reason'"))).toBe("t");
    expect(rowSnapshot(target)).toBe(before);
  });

  it.each(TARGETS)("keeps blank reasons and a concurrent hidden decision in $table", async (target) => {
    expect(await throughLockBarrier(target, [
      asService(target, "actor-a", "'   '"),
    ], `update public.${target.table} set ${target.column} = 'hidden', moderated_at = '${AT}' where id = '${target.id}';`)).toEqual(["t"]);
    expect(db().sql(`select ${target.column} || ':' || (moderated_at is not null)::text || ':' ||
      report_reason || ':' || moderator_note || ':' || report_count
      from public.${target.table} where id = '${target.id}'`)).toBe("hidden:true:existing reason:kept note:1");
  });

  it.each(TARGETS)("executes only for service_role and rejects invalid targets in $table", (target) => {
    const signature = `public.${target.rpc}(uuid,text,text)`;
    for (const role of ["anon", "authenticated"]) {
      expect(db().expectRefusal(`set role ${role}; select public.${target.rpc}('${target.id}', 'forged', null)`)).toMatch(/permission denied/i);
    }
    expect(db().sql(`select has_function_privilege('service_role', '${signature}', 'execute')`)).toBe("t");
    expect(db().sql(`select prosecdef::text || ':' || array_to_string(proconfig, ',')
      from pg_proc where oid = '${signature}'::regprocedure`)).toBe('true:search_path=""');
    expect(db().sql(`select public.${target.rpc}('${ABSENT}', 'actor', null),
      public.${target.rpc}(null, 'actor', null), public.${target.rpc}('${target.id}', '', null),
      public.${target.rpc}('${target.id}', null, null)`)).toBe("f|f|f|f");
    expect(db().sql(`select report_count from public.${target.table} where id = '${target.id}'`)).toBe("0");
    expect(catalog()).toBe(tableCatalog);
  });

  it("reapplies and rolls back without changing rows or table permissions", () => {
    for (const target of TARGETS) expect(db().sql(asService(target, "actor-a"))).toBe("t");
    const rows = TARGETS.map(rowSnapshot);
    db().applyFile(FORWARD);
    expect(TARGETS.map(rowSnapshot)).toEqual(rows);
    db().applyFile(ROLLBACK);
    expect(TARGETS.map(rowSnapshot)).toEqual(rows);
    expect(catalog()).toBe(tableCatalog);
    for (const target of TARGETS) expect(db().sql(
      `select to_regprocedure('public.${target.rpc}(uuid,text,text)') is null`,
    )).toBe("t");
  });
});
