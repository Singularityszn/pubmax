// Effective PostgreSQL proof for account-bound Plan capability recovery.

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
const JOIN_ACCOUNT = join(ROOT, "supabase/migrations/20260827190000_plan_join_account_atomicity.sql");
const FORWARD = join(ROOT, "supabase/migrations/20260827210000_plan_account_capability_recovery.sql");
const ROLLBACK = join(ROOT, "supabase/migrations/rollback/20260827210000_plan_account_capability_recovery_rollback.sql");

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
  const missing = (['initdb', 'postgres', 'psql'] as const).filter(
    (name) => postgresBinary(name) === null,
  );
  return missing.length > 0
    ? `Missing PostgreSQL binaries: ${missing.join(", ")}. Install PostgreSQL 16 to run Plan recovery proof.`
    : null;
}

async function freePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function startPostgres(): Promise<PostgresSession> {
  const initdb = postgresBinary("initdb");
  const postgres = postgresBinary("postgres");
  const psql = postgresBinary("psql");
  if (!initdb || !postgres || !psql) throw new Error("PostgreSQL unavailable.");

  const dataDir = mkdtempSync(join(tmpdir(), "pubmax-plan-account-recovery-"));
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
        owner_user_id uuid,
        invite_token text not null unique
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
    apply(JOIN_ACCOUNT);
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
    console.error(`PLAN ACCOUNT RECOVERY EFFECTIVE TEST SKIPPED - THIS IS NOT A PASS: ${skipReason}`);
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

describe("Plan account capability recovery migration", () => {
  it("rotates only the exact account membership and replays the requested token", () => {
    const plan = "40000000-0000-4000-8000-000000000001";
    const host = "40000000-0000-4000-8000-000000000002";
    const guest = "40000000-0000-4000-8000-000000000003";
    const account = "40000000-0000-4000-8000-000000000004";
    const wrongAccount = "40000000-0000-4000-8000-000000000005";
    const oldHash = "a".repeat(64);
    const newHash = "b".repeat(64);
    const laterHash = "c".repeat(64);
    const recoveredAt = "2026-08-27T20:00:00Z";
    session!.sql(`
      insert into public.plans(id, invite_token) values ('${plan}', '${"1".repeat(32)}');
      insert into public.plan_crew_members(id,plan_id,name,token_hash,user_id,status,joined_at,updated_at,can_collaborate)
      values
        ('${host}','${plan}','Host','${"d".repeat(64)}',null,'in','2026-08-27T19:00:00Z','2026-08-27T19:00:00Z',true),
        ('${guest}','${plan}','Guest','${oldHash}','${account}','running_late','2026-08-27T19:01:00Z','2026-08-27T19:01:00Z',true);
    `);

    expect(session!.sql(`select public.recover_plan_account_membership_atomic(
      '${plan}','${wrongAccount}','${newHash}','${recoveredAt}'::timestamptz
    )`)).toBe("not_found");
    expect(session!.sql(`select public.recover_plan_account_membership_atomic(
      '${plan}','${account}','${newHash}','${recoveredAt}'::timestamptz
    )`)).toBe("recovered");
    expect(session!.sql(`select token_hash || '|' || status || '|' || can_collaborate
      from public.plan_crew_members where id='${guest}'`)).toBe(`${newHash}|running_late|true`);
    expect(session!.sql(`select count(*) from public.plan_crew_members
      where plan_id='${plan}' and token_hash='${oldHash}'`)).toBe("0");
    expect(session!.sql(`select string_agg(id::text, '|' order by joined_at, id)
      from public.plan_crew_members where plan_id='${plan}'`)).toBe(`${host}|${guest}`);
    expect(session!.sql(`select public.recover_plan_account_membership_atomic(
      '${plan}','${account}','${newHash}','${recoveredAt}'::timestamptz
    )`)).toBe("replayed");
    expect(session!.sql(`select public.recover_plan_account_membership_atomic(
      '${plan}','${account}','${laterHash}','2026-08-27T20:01:00Z'::timestamptz
    )`)).toBe("recovered");
    expect(session!.sql(`select token_hash from public.plan_crew_members where id='${guest}'`)).toBe(laterHash);
  });

  it("refuses recovery on a Social Plan", () => {
    const plan = "41000000-0000-4000-8000-000000000001";
    const member = "41000000-0000-4000-8000-000000000002";
    const other = "41000000-0000-4000-8000-000000000003";
    const account = "41000000-0000-4000-8000-000000000004";
    const social = "41000000-0000-4000-8000-000000000005";
    const oldHash = "e".repeat(64);
    const collisionHash = "f".repeat(64);
    session!.sql(`
      insert into public.plans(id, invite_token, social_owner_account_id)
      values ('${plan}', '${"2".repeat(32)}', '${social}');
      insert into public.plan_crew_members(id,plan_id,name,token_hash,user_id,joined_at,updated_at)
      values
        ('${member}','${plan}','Member','${oldHash}','${account}',now(),now()),
        ('${other}','${plan}','Other','${collisionHash}',null,now(),now());
    `);
    expect(session!.sql(`select public.recover_plan_account_membership_atomic(
      '${plan}','${account}','${collisionHash}',now()
    )`)).toBe("not_found");
    expect(session!.sql(`select token_hash from public.plan_crew_members where id='${member}'`)).toBe(oldHash);
  });

  it("returns conflict without partial rotation on a token collision", () => {
    const plan = "41100000-0000-4000-8000-000000000001";
    const member = "41100000-0000-4000-8000-000000000002";
    const other = "41100000-0000-4000-8000-000000000003";
    const account = "41100000-0000-4000-8000-000000000004";
    const oldHash = "01".repeat(32);
    const collisionHash = "02".repeat(32);
    const updatedAt = "2026-08-27T19:05:00Z";
    session!.sql(`
      insert into public.plans(id, invite_token) values ('${plan}', '${"5".repeat(32)}');
      insert into public.plan_crew_members(id,plan_id,name,token_hash,user_id,status,joined_at,updated_at,can_collaborate)
      values
        ('${member}','${plan}','Member','${oldHash}','${account}','running_late','2026-08-27T19:04:00Z','${updatedAt}',true),
        ('${other}','${plan}','Other','${collisionHash}',null,'in','2026-08-27T19:04:01Z','${updatedAt}',false);
    `);
    expect(session!.sql(`select public.recover_plan_account_membership_atomic(
      '${plan}','${account}','${collisionHash}','2026-08-27T20:04:00Z'::timestamptz
    )`)).toBe("conflict");
    expect(session!.sql(`select token_hash || '|' || status || '|' || can_collaborate || '|' || to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      from public.plan_crew_members where id='${member}'`)).toBe(`${oldHash}|running_late|true|${updatedAt}`);
  });

  it("keeps host and guest order while recovering either account", () => {
    const plan = "42000000-0000-4000-8000-000000000001";
    const host = "42000000-0000-4000-8000-000000000002";
    const guest = "42000000-0000-4000-8000-000000000003";
    const hostAccount = "42000000-0000-4000-8000-000000000004";
    const guestAccount = "42000000-0000-4000-8000-000000000005";
    session!.sql(`
      insert into public.plans(id, invite_token) values ('${plan}', '${"3".repeat(32)}');
      insert into public.plan_crew_members(id,plan_id,name,token_hash,user_id,joined_at,updated_at,can_collaborate)
      values
        ('${host}','${plan}','Host','${"1".repeat(64)}','${hostAccount}','2026-08-27T19:10:00Z','2026-08-27T19:10:00Z',true),
        ('${guest}','${plan}','Guest','${"2".repeat(64)}','${guestAccount}','2026-08-27T19:11:00Z','2026-08-27T19:11:00Z',false);
    `);
    expect(session!.sql(`select public.recover_plan_account_membership_atomic(
      '${plan}','${hostAccount}','${"4".repeat(64)}',now()
    )`)).toBe("recovered");
    expect(session!.sql(`select public.recover_plan_account_membership_atomic(
      '${plan}','${guestAccount}','${"5".repeat(64)}',now()
    )`)).toBe("recovered");
    expect(session!.sql(`select string_agg(user_id::text, '|' order by joined_at, id)
      from public.plan_crew_members where plan_id='${plan}'`)).toBe(`${hostAccount}|${guestAccount}`);
    expect(session!.sql(`select can_collaborate from public.plan_crew_members where id='${guest}'`)).toBe("f");
  });

  it("serializes direct account join with recovery into one seat", async () => {
    const plan = "43000000-0000-4000-8000-000000000001";
    const host = "43000000-0000-4000-8000-000000000002";
    const member = "43000000-0000-4000-8000-000000000003";
    const joiningMember = "43000000-0000-4000-8000-000000000004";
    const account = "43000000-0000-4000-8000-000000000005";
    session!.sql(`
      insert into public.plans(id, invite_token) values ('${plan}', '${"4".repeat(32)}');
      insert into public.plan_crew_members(id,plan_id,name,token_hash,user_id,joined_at,updated_at)
      values
        ('${host}','${plan}','Host','${"6".repeat(64)}',null,'2026-08-27T19:20:00Z','2026-08-27T19:20:00Z'),
        ('${member}','${plan}','Member','${"7".repeat(64)}','${account}','2026-08-27T19:21:00Z','2026-08-27T19:21:00Z');
    `);
    const start = new Date(Date.now() + 1_000).toISOString();
    const synchronized = (statement: string) => `begin;
      set local statement_timeout='10s';
      select pg_sleep(greatest(0,extract(epoch from timestamptz '${start}'-clock_timestamp())));
      ${statement};
      commit;`;
    const results = await session!.concurrentResults([
      synchronized(`select public.join_plan_account_idempotent_atomic(
        '${plan}','${joiningMember}','Another seat','${"8".repeat(64)}',now(),false,
        '${"9".repeat(64)}','${"a".repeat(64)}','${account}'
      )`),
      synchronized(`select public.recover_plan_account_membership_atomic(
      '${plan}','${account}','${"b1".repeat(32)}',now()
      )`),
    ]);
    expect(results.sort()).toEqual(["account_conflict", "recovered"]);
    expect(session!.sql(`select count(*) from public.plan_crew_members
      where plan_id='${plan}' and user_id='${account}'`)).toBe("1");
    expect(session!.sql(`select token_hash from public.plan_crew_members where id='${member}'`)).toBe("b1".repeat(32));
  });

  it("keeps execution service-only and rollback removes the RPC", () => {
    expect(session!.sql(
      "select has_function_privilege('service_role','public.recover_plan_account_membership_atomic(uuid,uuid,text,timestamptz)','execute') || '|' || has_function_privilege('authenticated','public.recover_plan_account_membership_atomic(uuid,uuid,text,timestamptz)','execute') || '|' || has_function_privilege('anon','public.recover_plan_account_membership_atomic(uuid,uuid,text,timestamptz)','execute')",
    )).toBe("true|false|false");
    session!.apply(ROLLBACK);
    expect(session!.sql(
      "select to_regprocedure('public.recover_plan_account_membership_atomic(uuid,uuid,text,timestamptz)') is null",
    )).toBe("t");
  });
});
