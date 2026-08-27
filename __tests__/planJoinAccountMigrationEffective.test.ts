// Effective PostgreSQL proof for signed-in Plan joins.

import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const BASE = join(ROOT, "supabase/migrations/20260716200000_0035_plan_write_idempotency.sql");
const CLAIM = join(ROOT, "supabase/migrations/20260827120448_plan_membership_account_claim.sql");
const UNIQUE = join(ROOT, "supabase/migrations/20260827121253_plan_membership_account_uniqueness.sql");
const FORWARD = join(ROOT, "supabase/migrations/20260827190000_plan_join_account_atomicity.sql");
const ROLLBACK = join(ROOT, "supabase/migrations/rollback/20260827190000_plan_join_account_atomicity_rollback.sql");

const execFileAsync = promisify(execFile);

type PostgresSession = {
  sql(statement: string): string;
  apply(path: string): void;
  concurrentResults(statements: readonly string[]): Promise<string[]>;
  stop(): Promise<void>;
};

function postgresBinary(name: "initdb" | "postgres" | "psql"): string | null {
  for (const candidate of [
    `/opt/homebrew/opt/postgresql@16/bin/${name}`,
    `/opt/homebrew/opt/postgresql@17/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/opt/postgresql@16/bin/${name}`,
    `/usr/lib/postgresql/16/bin/${name}`,
    `/usr/lib/postgresql/17/bin/${name}`,
    name,
  ]) {
    try {
      if (candidate === name) execFileSync("which", [name], { stdio: "pipe" });
      else if (!existsSync(candidate)) continue;
      return candidate;
    } catch {
      // Try next known installation.
    }
  }
  return null;
}

function missingPostgresReason(): string | null {
  if (process.env.PUBMAX_RLS_NO_PG === "1") {
    return "PostgreSQL was deliberately hidden by the migration test no-PG gate.";
  }
  const missing = (["initdb", "postgres", "psql"] as const).filter(
    (name) => postgresBinary(name) === null,
  );
  return missing.length > 0
    ? `Missing PostgreSQL binaries: ${missing.join(", ")}. Install PostgreSQL 16 to run Plan join proof.`
    : null;
}

async function freePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
    server.on("error", reject);
  });
}

async function startPostgres(): Promise<PostgresSession> {
  const initdb = postgresBinary("initdb");
  const postgres = postgresBinary("postgres");
  const psql = postgresBinary("psql");
  if (!initdb || !postgres || !psql) throw new Error("PostgreSQL unavailable.");

  const dataDir = mkdtempSync(join(tmpdir(), "pubmax-plan-account-join-"));
  const port = await freePort();
  execFileSync(
    initdb,
    ["-D", dataDir, "--locale=C", "-E", "UTF8", "--username=postgres", "--auth=trust"],
    { stdio: "pipe" },
  );
  writeFileSync(join(dataDir, "postgresql.auto.conf"), [
    "listen_addresses = '127.0.0.1'",
    `port = ${port}`,
    "max_connections = 12",
    "shared_buffers = 12MB",
    "fsync = off",
    "full_page_writes = off",
    "synchronous_commit = off",
  ].join("\n") + "\n");
  const processHandle = spawn(
    postgres,
    ["-D", dataDir, "-k", dataDir, "-p", String(port), "-h", "127.0.0.1"],
    { stdio: "ignore", env: { ...process.env, LC_ALL: "C" } },
  );
  const connection = ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres"];
  const stop = async (): Promise<void> => {
    if (processHandle.exitCode === null) {
      processHandle.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((resolve) => processHandle.once("exit", () => resolve())),
        sleep(1_000).then(() => undefined),
      ]);
    }
    if (processHandle.exitCode === null) processHandle.kill("SIGKILL");
    rmSync(dataDir, { recursive: true, force: true });
  };

  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        execFileSync(psql, [...connection, "-c", "select 1"], { stdio: "pipe" });
        break;
      } catch {
        if (attempt === 49) throw new Error("PostgreSQL did not start.");
        await sleep(100);
      }
    }
    const run = (statement: string): string => execFileSync(
      psql,
      [...connection, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c", statement],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    const apply = (path: string): void => {
      execFileSync(psql, [...connection, "-v", "ON_ERROR_STOP=1", "-f", path], {
        stdio: "pipe",
      });
    };
    const concurrentResults = (statements: readonly string[]) => Promise.all(
      statements.map(async (statement) => {
        const { stdout } = await execFileAsync(psql, [
          ...connection,
          "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c", statement,
        ], { encoding: "utf8" });
        return stdout.trim();
      }),
    );

    run(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create table public.plans (
        id uuid primary key,
        title text not null default 'Plan',
        start_time timestamptz not null default now(),
        status text not null default 'draft',
        social_owner_account_id uuid,
        owner_user_id uuid
      );
      create table public.plan_stops (
        id bigint generated always as identity primary key,
        plan_id uuid not null references public.plans(id),
        venue_id text not null,
        venue_name text not null,
        position integer not null
      );
      create table public.plan_crew_members (
        id uuid primary key,
        plan_id uuid not null references public.plans(id),
        name text not null,
        status text not null default 'in',
        token_hash text not null unique,
        user_id uuid,
        joined_at timestamptz not null,
        updated_at timestamptz not null default now(),
        can_collaborate boolean not null default false
      );
      create table public.plan_invites (
        id uuid primary key,
        plan_id uuid not null references public.plans(id),
        created_by_member_id uuid not null references public.plan_crew_members(id),
        token_hash text not null unique,
        idempotency_key text not null,
        created_at timestamptz not null,
        expires_at timestamptz not null,
        revoked_at timestamptz,
        redeemed_at timestamptz
      );
      create table public.plan_actions (
        id uuid primary key,
        plan_id uuid not null references public.plans(id),
        actor_member_id uuid references public.plan_crew_members(id),
        type text not null,
        stop_position integer,
        created_at timestamptz not null
      );
      grant all on public.plans, public.plan_stops, public.plan_crew_members,
        public.plan_invites, public.plan_actions to service_role;
    `);
    apply(BASE);
    apply(CLAIM);
    apply(UNIQUE);
    apply(FORWARD);
    return { sql: run, apply, concurrentResults, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

let session: PostgresSession | null = null;
let skipReason: string | null = null;

beforeAll(async () => {
  skipReason = missingPostgresReason();
  if (skipReason) {
    console.error(`PLAN ACCOUNT JOIN EFFECTIVE TEST SKIPPED - THIS IS NOT A PASS: ${skipReason}`);
    return;
  }
  session = await startPostgres();
}, 30_000);

beforeEach((context) => {
  if (skipReason) context.skip(true, skipReason);
});

afterAll(async () => {
  await session?.stop();
});

describe("Plan account join migration", () => {
  it("linearizes different join keys for one signed-in account", async () => {
    const plan = "10000000-0000-4000-8000-000000000001";
    const host = "10000000-0000-4000-8000-000000000002";
    const account = "10000000-0000-4000-8000-000000000003";
    session!.sql(`
      insert into public.plans(id) values ('${plan}');
      insert into public.plan_crew_members(id,plan_id,name,token_hash,joined_at)
      values ('${host}','${plan}','Host','${"a".repeat(64)}',now());
    `);
    const start = new Date(Date.now() + 1_000).toISOString();
    const synchronized = (statement: string) => `begin;
      set local statement_timeout='10s';
      select pg_sleep(greatest(0,extract(epoch from timestamptz '${start}'-clock_timestamp())));
      ${statement};
      commit;`;
    const results = await session!.concurrentResults([
      synchronized(`select public.join_plan_account_idempotent_atomic(
        '${plan}','10000000-0000-4000-8000-000000000004','One','${"b".repeat(64)}',now(),false,
        '${"1".repeat(64)}','${"2".repeat(64)}','${account}'
      )`),
      synchronized(`select public.join_plan_account_idempotent_atomic(
        '${plan}','10000000-0000-4000-8000-000000000005','Two','${"c".repeat(64)}',now(),false,
        '${"3".repeat(64)}','${"4".repeat(64)}','${account}'
      )`),
    ]);

    expect(results.sort()).toEqual(["account_conflict", "joined"]);
    expect(session!.sql(`select count(*) from public.plan_crew_members where plan_id='${plan}' and user_id='${account}'`)).toBe("1");
    expect(session!.sql(`select count(*) from public.plan_crew_members where plan_id='${plan}'`)).toBe("2");
  });

  it("replays the same request and leaves a second invite unused", () => {
    const plan = "20000000-0000-4000-8000-000000000001";
    const host = "20000000-0000-4000-8000-000000000002";
    const account = "20000000-0000-4000-8000-000000000003";
    const member = "20000000-0000-4000-8000-000000000004";
    const firstInvite = "20000000-0000-4000-8000-000000000005";
    const secondInvite = "20000000-0000-4000-8000-000000000006";
    const key = "5".repeat(64);
    const request = "6".repeat(64);
    session!.sql(`
      insert into public.plans(id) values ('${plan}');
      insert into public.plan_crew_members(id,plan_id,name,token_hash,joined_at)
      values ('${host}','${plan}','Host','${"d".repeat(64)}',now());
      insert into public.plan_invites(
        id,plan_id,created_by_member_id,token_hash,idempotency_key,created_at,expires_at
      ) values
        ('${firstInvite}','${plan}','${host}','${"e".repeat(64)}','first',now(),now()+interval '1 hour'),
        ('${secondInvite}','${plan}','${host}','${"f".repeat(64)}','second',now(),now()+interval '1 hour');
    `);

    const redeem = (inviteHash: string, memberId: string, joinKey: string, requestHash: string) =>
      session!.sql(`select public.redeem_plan_invite_account_idempotent_atomic(
        '${plan}','${inviteHash}','${memberId}','Guest','${"0".repeat(64)}',now(),
        '${joinKey}','${requestHash}','${account}'
      )`);

    expect(redeem("e".repeat(64), member, key, request)).toBe("joined");
    expect(redeem("e".repeat(64), member, key, request)).toBe("replayed");
    expect(redeem(
      "f".repeat(64),
      "20000000-0000-4000-8000-000000000007",
      "7".repeat(64),
      "8".repeat(64),
    )).toBe("account_conflict");
    expect(session!.sql(`select redeemed_at is null from public.plan_invites where id='${secondInvite}'`)).toBe("t");
  });

  it("keeps unrelated uniqueness collisions as ordinary request conflicts", () => {
    const plan = "30000000-0000-4000-8000-000000000001";
    const host = "30000000-0000-4000-8000-000000000002";
    const account = "30000000-0000-4000-8000-000000000003";
    const tokenHash = "9".repeat(64);
    session!.sql(`
      insert into public.plans(id) values ('${plan}');
      insert into public.plan_crew_members(id,plan_id,name,token_hash,joined_at)
      values ('${host}','${plan}','Host','${tokenHash}',now());
    `);

    expect(session!.sql(`select public.join_plan_account_idempotent_atomic(
      '${plan}','30000000-0000-4000-8000-000000000004','Guest','${tokenHash}',now(),false,
      '${"a".repeat(64)}','${"b".repeat(64)}','${account}'
    )`)).toBe("conflict");
    expect(session!.sql(`select count(*) from public.plan_crew_members where plan_id='${plan}'`)).toBe("1");
  });

  it("keeps both RPCs service-only and removes them on rollback", () => {
    expect(session!.sql(`select
      has_function_privilege('service_role','public.join_plan_account_idempotent_atomic(uuid,uuid,text,text,timestamptz,boolean,text,text,uuid)','execute') || '|' ||
      has_function_privilege('authenticated','public.join_plan_account_idempotent_atomic(uuid,uuid,text,text,timestamptz,boolean,text,text,uuid)','execute') || '|' ||
      has_function_privilege('anon','public.join_plan_account_idempotent_atomic(uuid,uuid,text,text,timestamptz,boolean,text,text,uuid)','execute') || '|' ||
      has_function_privilege('service_role','public.redeem_plan_invite_account_idempotent_atomic(uuid,text,uuid,text,text,timestamptz,text,text,uuid)','execute') || '|' ||
      has_function_privilege('authenticated','public.redeem_plan_invite_account_idempotent_atomic(uuid,text,uuid,text,text,timestamptz,text,text,uuid)','execute') || '|' ||
      has_function_privilege('anon','public.redeem_plan_invite_account_idempotent_atomic(uuid,text,uuid,text,text,timestamptz,text,text,uuid)','execute')
    `)).toBe("true|false|false|true|false|false");

    session!.apply(ROLLBACK);
    expect(session!.sql("select to_regprocedure('public.join_plan_account_idempotent_atomic(uuid,uuid,text,text,timestamptz,boolean,text,text,uuid)') is null")).toBe("t");
    expect(session!.sql("select to_regprocedure('public.redeem_plan_invite_account_idempotent_atomic(uuid,text,uuid,text,text,timestamptz,text,text,uuid)') is null")).toBe("t");
  });
});
