// Effective proof for guest Plan account claim and its one-account invariant.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const CLAIM = join(
  process.cwd(),
  "supabase/migrations/20260827120448_plan_membership_account_claim.sql",
);
const UNIQUE = join(
  process.cwd(),
  "supabase/migrations/20260827121253_plan_membership_account_uniqueness.sql",
);
const CLAIM_ROLLBACK = join(
  process.cwd(),
  "supabase/migrations/rollback/20260827120448_plan_membership_account_claim_rollback.sql",
);
const UNIQUE_ROLLBACK = join(
  process.cwd(),
  "supabase/migrations/rollback/20260827121253_plan_membership_account_uniqueness_rollback.sql",
);

type PostgresSession = {
  sql: (statement: string) => string;
  apply: (path: string) => void;
  stop: () => Promise<void>;
};

function postgresBinary(name: "initdb" | "postgres" | "psql"): string | null {
  const candidates = [
    `/opt/homebrew/opt/postgresql@16/bin/${name}`,
    `/opt/homebrew/opt/postgresql@17/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/opt/postgresql@16/bin/${name}`,
    `/usr/lib/postgresql/16/bin/${name}`,
    `/usr/lib/postgresql/17/bin/${name}`,
    name,
  ];
  for (const candidate of candidates) {
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
  if (
    process.env.PUBMAX_RLS_NO_PG === "1"
    || process.env.PUBMAX_PLAN_CLAIM_MIGRATION_NO_PG === "1"
  ) {
    return "PostgreSQL was deliberately hidden by the migration test no-PG gate.";
  }
  const missing = (["initdb", "postgres", "psql"] as const).filter(
    (name) => postgresBinary(name) === null,
  );
  return missing.length > 0
    ? `Missing PostgreSQL binaries: ${missing.join(", ")}. Install PostgreSQL 16 to run Plan claim proof.`
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

  const dataDir = mkdtempSync(join(tmpdir(), "pubmax-plan-claim-"));
  const port = await freePort();
  execFileSync(
    initdb,
    ["-D", dataDir, "--locale=C", "-E", "UTF8", "--username=postgres", "--auth=trust"],
    { stdio: "pipe" },
  );
  writeFileSync(
    join(dataDir, "postgresql.auto.conf"),
    [
      "listen_addresses = '127.0.0.1'",
      `port = ${port}`,
      "max_connections = 10",
      "shared_buffers = 12MB",
      "fsync = off",
      "full_page_writes = off",
      "synchronous_commit = off",
    ].join("\n") + "\n",
  );
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
    const sql = (statement: string): string => execFileSync(
      psql,
      [...connection, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", statement],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    const apply = (path: string): void => {
      execFileSync(psql, [...connection, "-v", "ON_ERROR_STOP=1", "-f", path], {
        stdio: "pipe",
      });
    };
    sql(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create table public.plans (
        id uuid primary key,
        social_owner_account_id uuid,
        owner_user_id uuid
      );
      create table public.plan_crew_members (
        id uuid primary key,
        plan_id uuid not null references public.plans(id),
        user_id uuid,
        joined_at timestamptz not null,
        updated_at timestamptz not null default now()
      );
      grant all on public.plans, public.plan_crew_members to service_role;
    `);
    apply(CLAIM);
    apply(UNIQUE);
    return { sql, apply, stop };
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
    console.error(`PLAN CLAIM EFFECTIVE TEST SKIPPED - THIS IS NOT A PASS: ${skipReason}`);
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

describe("Plan membership account claim", () => {
  it("owns host and member atomically, stays idempotent, and rejects duplicates", () => {
    const plan = "00000000-0000-4000-8000-000000000001";
    const host = "00000000-0000-4000-8000-000000000002";
    const guest = "00000000-0000-4000-8000-000000000003";
    const account = "00000000-0000-4000-8000-000000000004";
    session!.sql(`
      insert into public.plans(id) values ('${plan}');
      insert into public.plan_crew_members(id, plan_id, joined_at) values
        ('${host}', '${plan}', '2026-08-27T18:00:00Z'),
        ('${guest}', '${plan}', '2026-08-27T18:01:00Z');
    `);

    expect(session!.sql(`select public.claim_plan_membership('${plan}', '${host}', '${account}')`)).toBe("claimed");
    expect(session!.sql(`select owner_user_id || '|' || user_id from public.plans join public.plan_crew_members on plan_id = plans.id where plan_crew_members.id = '${host}'`)).toBe(`${account}|${account}`);
    expect(session!.sql(`select public.claim_plan_membership('${plan}', '${host}', '${account}')`)).toBe("already_claimed");
    expect(session!.sql(`select public.claim_plan_membership('${plan}', '${guest}', '${account}')`)).toBe("conflict");
    expect(() => session!.sql(`insert into public.plan_crew_members(id, plan_id, user_id, joined_at) values ('00000000-0000-4000-8000-000000000005', '${plan}', '${account}', now())`)).toThrow();
  });

  it("refuses a Plan already owned by a social account", () => {
    const plan = "00000000-0000-4000-8000-000000000011";
    const member = "00000000-0000-4000-8000-000000000012";
    const social = "00000000-0000-4000-8000-000000000013";
    const account = "00000000-0000-4000-8000-000000000014";
    session!.sql(`
      insert into public.plans(id, social_owner_account_id) values ('${plan}', '${social}');
      insert into public.plan_crew_members(id, plan_id, joined_at) values
        ('${member}', '${plan}', '2026-08-27T18:00:00Z');
    `);

    expect(session!.sql(`select public.claim_plan_membership('${plan}', '${member}', '${account}')`)).toBe("not_found");
  });

  it("keeps execution service-only and rollback removes both additions", () => {
    expect(session!.sql(`select has_function_privilege('service_role', 'public.claim_plan_membership(uuid,uuid,uuid)', 'execute') || '|' || has_function_privilege('authenticated', 'public.claim_plan_membership(uuid,uuid,uuid)', 'execute') || '|' || has_function_privilege('anon', 'public.claim_plan_membership(uuid,uuid,uuid)', 'execute')`)).toBe("true|false|false");

    session!.apply(UNIQUE_ROLLBACK);
    expect(session!.sql("select to_regclass('public.plan_crew_members_plan_user_unique_idx') is null")).toBe("t");
    session!.apply(CLAIM_ROLLBACK);
    expect(session!.sql("select to_regprocedure('public.claim_plan_membership(uuid,uuid,uuid)') is null")).toBe("t");
  });
});
