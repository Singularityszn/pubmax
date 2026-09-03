// Effective PostgreSQL proof for 0137. The migration changes only the two
// private 0075 helpers behind the public join and invite wrappers. A member
// can therefore move from an anonymous idempotency key K, to account U, and
// then to recovered capability R. An old K request must conflict while R is
// current; rolling back must deliberately restore the old replay behaviour.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20260903130000_0137_plan_legacy_replay_capability.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20260903130000_0137_plan_legacy_replay_capability_rollback.sql",
);
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

const HOST_USER = "00000000-0000-4000-8000-0000000000a1";
const ACCOUNT_USER = "00000000-0000-4000-8000-0000000000a2";
const JOIN_PLAN = "00000000-0000-4000-8000-0000000000b1";
const INVITE_PLAN = "00000000-0000-4000-8000-0000000000b2";
const REVOKED_JOIN_PLAN = "00000000-0000-4000-8000-0000000000b3";
const REVOKED_INVITE_PLAN = "00000000-0000-4000-8000-0000000000b4";
const JOIN_HOST_MEMBER = "00000000-0000-4000-8000-0000000000c1";
const JOIN_MEMBER = "00000000-0000-4000-8000-0000000000c2";
const INVITE_HOST_MEMBER = "00000000-0000-4000-8000-0000000000c3";
const INVITE_MEMBER = "00000000-0000-4000-8000-0000000000c4";
const REVOKED_JOIN_HOST_MEMBER = "00000000-0000-4000-8000-0000000000c5";
const REVOKED_JOIN_MEMBER = "00000000-0000-4000-8000-0000000000c6";
const REVOKED_INVITE_HOST_MEMBER = "00000000-0000-4000-8000-0000000000c7";
const REVOKED_INVITE_MEMBER = "00000000-0000-4000-8000-0000000000c8";
const INVITE_ID = "00000000-0000-4000-8000-0000000000d1";
const REVOKED_INVITE_ID = "00000000-0000-4000-8000-0000000000d2";
const WHEN = "2026-09-03 12:00:00+00";

type Session = {
  sql: (statement: string) => string;
  applyFile: (path: string) => void;
  stop: () => Promise<void>;
};

async function waitForExit(processHandle: ReturnType<typeof spawn>, timeoutMs: number): Promise<void> {
  if (processHandle.exitCode !== null || processHandle.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    processHandle.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function findPostgresBinary(name: "initdb" | "postgres" | "psql"): string | null {
  const candidates = [
    `/opt/homebrew/opt/postgresql@16/bin/${name}`,
    `/usr/local/opt/postgresql@16/bin/${name}`,
    `/usr/lib/postgresql/16/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    `/usr/bin/${name}`,
  ];
  const isPostgres16 = (candidate: string): boolean => {
    try {
      const version = execFileSync(candidate, ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return /\bPostgreSQL\)?\s+16(?:\.|\s|$)/i.test(version);
    } catch {
      return false;
    }
  };
  for (const candidate of candidates) {
    if (existsSync(candidate) && isPostgres16(candidate)) return candidate;
  }
  try {
    const candidate = execFileSync("which", [name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return candidate !== "" && isPostgres16(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function missingPostgresReason(): string | null {
  if (process.env.PUBMAX_PLAN_LEGACY_REPLAY_NO_PG === "1") {
    return "PostgreSQL binaries were deliberately hidden by PUBMAX_PLAN_LEGACY_REPLAY_NO_PG=1.";
  }
  const missing = (["initdb", "postgres", "psql"] as const).filter(
    (name) => findPostgresBinary(name) === null,
  );
  return missing.length > 0
    ? `PostgreSQL 16 binaries unavailable for: ${missing.join(", ")}. Each binary must report major version 16 to run the 0137 replay proof.`
    : null;
}

async function pickPort(): Promise<number> {
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

async function startPostgres(): Promise<Session> {
  const initdb = findPostgresBinary("initdb");
  const postgres = findPostgresBinary("postgres");
  const psql = findPostgresBinary("psql");
  if (!initdb || !postgres || !psql) {
    throw new Error(missingPostgresReason() ?? "PostgreSQL binaries unavailable.");
  }

  const dataDir = mkdtempSync(join(tmpdir(), "pubmax-plan-legacy-replay-0137-"));
  let handle: ReturnType<typeof spawn> | null = null;
  try {
    const port = await pickPort();
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
        "max_connections = 12",
        "shared_buffers = 16MB",
        "fsync = off",
        "full_page_writes = off",
        "synchronous_commit = off",
      ].join("\n") + "\n",
    );

    const processHandle = spawn(
      postgres,
      ["-D", dataDir, "-k", dataDir, "-p", String(port), "-h", "127.0.0.1"],
      { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LC_ALL: "C" } },
    );
    handle = processHandle;
    const logs: string[] = [];
    processHandle.stdout?.on("data", (chunk) => logs.push(chunk.toString()));
    processHandle.stderr?.on("data", (chunk) => logs.push(chunk.toString()));

    const connectionArgs = ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres"];
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        execFileSync(psql, [...connectionArgs, "-d", "postgres", "-c", "select 1"], {
          stdio: "pipe",
        });
        ready = true;
        break;
      } catch {
        await sleep(100);
      }
    }
    if (!ready) throw new Error(`PostgreSQL failed to start:\n${logs.join("")}`);

    const database = "pubmax_plan_legacy_replay_0137";
    execFileSync(
      psql,
      [...connectionArgs, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `create database ${database}`],
      { stdio: "pipe" },
    );
    const databaseArgs = [...connectionArgs, "-d", database, "-v", "ON_ERROR_STOP=1"];

    const sql = (statement: string): string =>
      execFileSync(psql, [...databaseArgs, "-t", "-A", "-c", statement], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      })
        .trim()
        .split("\n")
        .filter((line) => line.trim() !== "SET")
        .join("\n")
        .trim();

    const applyFile = (path: string): void => {
      execFileSync(psql, [...databaseArgs, "-f", path], { stdio: "pipe" });
    };

    const stop = async (): Promise<void> => {
      if (processHandle.exitCode === null && processHandle.signalCode === null) {
        processHandle.kill("SIGINT");
        await waitForExit(processHandle, 5_000);
      }
      if (processHandle.exitCode === null && processHandle.signalCode === null) {
        processHandle.kill("SIGTERM");
        await waitForExit(processHandle, 2_000);
      }
      if (processHandle.exitCode === null && processHandle.signalCode === null) {
        processHandle.kill("SIGKILL");
        await waitForExit(processHandle, 5_000);
      }
      rmSync(dataDir, { recursive: true, force: true });
    };

    return { sql, applyFile, stop };
  } catch (error) {
    if (handle && handle.exitCode === null && handle.signalCode === null) {
      handle.kill("SIGKILL");
      await waitForExit(handle, 5_000);
    }
    rmSync(dataDir, { recursive: true, force: true });
    throw error;
  }
}

let database: Session | null = null;
let skipReason: string | null = null;

function requireDatabase(): Session {
  if (!database) throw new Error("PostgreSQL session unavailable.");
  return database;
}

function joinPlan(
  db: Session,
  planId: string,
  memberId: string,
  token: string,
  key: string,
  request: string,
): string {
  return db.sql(`select public.join_plan_idempotent_atomic(
    '${planId}'::uuid,
    '${memberId}'::uuid,
    'Replay guest',
    repeat('${token}', 64),
    '${WHEN}'::timestamptz,
    true,
    repeat('${key}', 64),
    repeat('${request}', 64)
  )`);
}

function redeem(
  db: Session,
  planId: string,
  memberId: string,
  inviteToken: string,
  memberToken: string,
  key: string,
  request: string,
): string {
  return db.sql(`select public.redeem_plan_invite_idempotent_atomic(
    '${planId}'::uuid,
    repeat('${inviteToken}', 64),
    '${memberId}'::uuid,
    'Replay guest',
    repeat('${memberToken}', 64),
    '${WHEN}'::timestamptz,
    repeat('${key}', 64),
    repeat('${request}', 64)
  )`);
}

function seed(db: Session): void {
  db.sql(`
    insert into public.plans (id, title, start_time, owner_user_id, status)
    values
      ('${JOIN_PLAN}', 'Join replay', '${WHEN}'::timestamptz + interval '1 day', '${HOST_USER}', 'ready'),
      ('${INVITE_PLAN}', 'Invite replay', '${WHEN}'::timestamptz + interval '1 day', '${HOST_USER}', 'ready'),
      ('${REVOKED_JOIN_PLAN}', 'Revoked join', '${WHEN}'::timestamptz + interval '1 day', '${HOST_USER}', 'ready'),
      ('${REVOKED_INVITE_PLAN}', 'Revoked invite', '${WHEN}'::timestamptz + interval '1 day', '${HOST_USER}', 'ready');

    insert into public.plan_crew_members
      (id, plan_id, name, token_hash, status, joined_at, updated_at, can_collaborate, user_id, membership_revoked_at, join_key_hash, join_request_hash)
    values
      ('${JOIN_HOST_MEMBER}', '${JOIN_PLAN}', 'Host', repeat('1', 64), 'in', '${WHEN}', '${WHEN}', true, '${HOST_USER}', null, null, null),
      ('${INVITE_HOST_MEMBER}', '${INVITE_PLAN}', 'Host', repeat('2', 64), 'in', '${WHEN}', '${WHEN}', true, '${HOST_USER}', null, null, null),
      ('${REVOKED_JOIN_HOST_MEMBER}', '${REVOKED_JOIN_PLAN}', 'Host', repeat('3', 64), 'in', '${WHEN}', '${WHEN}', true, '${HOST_USER}', null, null, null),
      ('${REVOKED_INVITE_HOST_MEMBER}', '${REVOKED_INVITE_PLAN}', 'Host', repeat('4', 64), 'in', '${WHEN}', '${WHEN}', true, '${HOST_USER}', null, null, null),
      ('${REVOKED_JOIN_MEMBER}', '${REVOKED_JOIN_PLAN}', 'Replay guest', repeat('5', 64), 'in', '${WHEN}', '${WHEN}', true, null, '${WHEN}'::timestamptz - interval '1 minute', repeat('0', 64), repeat('1', 64)),
      ('${REVOKED_INVITE_MEMBER}', '${REVOKED_INVITE_PLAN}', 'Replay guest', repeat('6', 64), 'in', '${WHEN}', '${WHEN}', true, null, '${WHEN}'::timestamptz - interval '1 minute', repeat('2', 64), repeat('3', 64));

    insert into public.plan_invites
      (id, plan_id, created_by_member_id, token_hash, idempotency_key, created_at, expires_at)
    values
      ('${INVITE_ID}', '${INVITE_PLAN}', '${INVITE_HOST_MEMBER}', repeat('7', 64), 'invite-replay-key', '${WHEN}', '${WHEN}'::timestamptz + interval '1 day'),
      ('${REVOKED_INVITE_ID}', '${REVOKED_INVITE_PLAN}', '${REVOKED_INVITE_HOST_MEMBER}', repeat('8', 64), 'revoked-invite-key', '${WHEN}', '${WHEN}'::timestamptz + interval '1 day');
  `);
}

beforeAll(async () => {
  skipReason = missingPostgresReason();
  if (skipReason) {
    console.error(
      [
        "",
        "0137 PLAN LEGACY REPLAY CAPABILITY EFFECTIVE TESTS SKIPPED - THIS IS NOT A PASS",
        `Reason: ${skipReason}`,
        "No public-wrapper replay, token rotation, invite, reactivation, or rollback behaviour was exercised.",
        "",
      ].join("\n"),
    );
    return;
  }
  try {
    database = await startPostgres();
    database.applyFile(SESSION_FIXTURE);
    for (const path of PREREQUISITES) database.applyFile(path);
    database.sql(`insert into auth.users(id) values ('${HOST_USER}'), ('${ACCOUNT_USER}')`);
    database.applyFile(FORWARD);
  } catch (error) {
    if (database) await database.stop();
    database = null;
    throw error;
  }
}, 300_000);

afterAll(async () => {
  if (database) await database.stop();
  database = null;
});

describe("0137 applied to PostgreSQL", () => {
  it("fences stale K after U recovery to R without changing invite redemption", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();
    seed(db);

    expect(joinPlan(db, JOIN_PLAN, JOIN_MEMBER, "a", "b", "c")).toBe("joined");
    expect(
      db.sql(
        `select public.claim_plan_membership('${JOIN_PLAN}'::uuid, '${JOIN_MEMBER}'::uuid, '${ACCOUNT_USER}'::uuid)`,
      ),
    ).toBe("claimed");
    expect(
      db.sql(
        `select public.recover_plan_account_membership_atomic('${JOIN_PLAN}'::uuid, '${ACCOUNT_USER}'::uuid, repeat('d', 64), repeat('e', 64), repeat('f', 64), '${WHEN}'::timestamptz + interval '5 minutes')`,
      ),
    ).toBe("recovered");

    expect(joinPlan(db, JOIN_PLAN, JOIN_MEMBER, "a", "b", "c")).toBe("conflict");
    expect(
      db.sql(
        `select token_hash = repeat('d', 64) and recovery_key_hash = repeat('e', 64) and recovery_request_hash = repeat('f', 64) from public.plan_crew_members where id = '${JOIN_MEMBER}'::uuid`,
      ),
    ).toBe("t");
    expect(joinPlan(db, JOIN_PLAN, JOIN_MEMBER, "d", "b", "c")).toBe("replayed");

    expect(redeem(db, INVITE_PLAN, INVITE_MEMBER, "7", "b", "b", "c")).toBe("joined");
    expect(
      db.sql(
        `select public.claim_plan_membership('${INVITE_PLAN}'::uuid, '${INVITE_MEMBER}'::uuid, '${ACCOUNT_USER}'::uuid)`,
      ),
    ).toBe("claimed");
    expect(
      db.sql(
        `select public.recover_plan_account_membership_atomic('${INVITE_PLAN}'::uuid, '${ACCOUNT_USER}'::uuid, repeat('9', 64), repeat('0', 64), repeat('1', 64), '${WHEN}'::timestamptz + interval '5 minutes')`,
      ),
    ).toBe("recovered");
    const redeemedAt = db.sql(
      `select redeemed_at::text from public.plan_invites where id = '${INVITE_ID}'::uuid`,
    );

    expect(redeem(db, INVITE_PLAN, INVITE_MEMBER, "7", "b", "b", "c")).toBe("conflict");
    expect(
      db.sql(
        `select token_hash = repeat('9', 64) and recovery_key_hash = repeat('0', 64) and recovery_request_hash = repeat('1', 64) from public.plan_crew_members where id = '${INVITE_MEMBER}'::uuid`,
      ),
    ).toBe("t");
    expect(
      db.sql(`select redeemed_at::text from public.plan_invites where id = '${INVITE_ID}'::uuid`),
    ).toBe(redeemedAt);
    expect(redeem(db, INVITE_PLAN, INVITE_MEMBER, "7", "9", "b", "c")).toBe("replayed");
    expect(
      db.sql(`select redeemed_at::text from public.plan_invites where id = '${INVITE_ID}'::uuid`),
    ).toBe(redeemedAt);

    expect(joinPlan(db, REVOKED_JOIN_PLAN, REVOKED_JOIN_MEMBER, "c", "0", "1")).toBe("joined");
    expect(
      db.sql(
        `select membership_revoked_at is null and token_hash = repeat('c', 64) from public.plan_crew_members where id = '${REVOKED_JOIN_MEMBER}'::uuid`,
      ),
    ).toBe("t");
    expect(
      redeem(db, REVOKED_INVITE_PLAN, REVOKED_INVITE_MEMBER, "8", "f", "2", "3"),
    ).toBe("joined");
    expect(
      db.sql(
        `select membership_revoked_at is null and token_hash = repeat('f', 64) from public.plan_crew_members where id = '${REVOKED_INVITE_MEMBER}'::uuid`,
      ),
    ).toBe("t");
  }, 120_000);

  it("keeps service-only wrappers and makes rollback restore stale replay", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();

    expect(
      db.sql(
        `select has_function_privilege('anon', 'public.join_plan_idempotent_atomic(uuid,uuid,text,text,timestamptz,boolean,text,text)', 'execute')::text || '|' || has_function_privilege('service_role', 'public.join_plan_idempotent_atomic(uuid,uuid,text,text,timestamptz,boolean,text,text)', 'execute')::text`,
      ),
    ).toBe("false|true");
    expect(
      db.sql(
        `select has_function_privilege('anon', 'public.redeem_plan_invite_idempotent_atomic(uuid,text,uuid,text,text,timestamptz,text,text)', 'execute')::text || '|' || has_function_privilege('service_role', 'public.redeem_plan_invite_idempotent_atomic(uuid,text,uuid,text,text,timestamptz,text,text)', 'execute')::text`,
      ),
    ).toBe("false|true");

    const dbBeforeRollback = db.sql(
      `select token_hash from public.plan_crew_members where id = '${JOIN_MEMBER}'::uuid`,
    );
    const redeemedAt = db.sql(
      `select redeemed_at::text from public.plan_invites where id = '${INVITE_ID}'::uuid`,
    );
    db.applyFile(ROLLBACK);

    expect(joinPlan(db, JOIN_PLAN, JOIN_MEMBER, "a", "b", "c")).toBe("replayed");
    expect(
      db.sql(`select token_hash from public.plan_crew_members where id = '${JOIN_MEMBER}'::uuid`),
    ).toBe(dbBeforeRollback);
    expect(redeem(db, INVITE_PLAN, INVITE_MEMBER, "7", "b", "b", "c")).toBe("replayed");
    expect(
      db.sql(`select redeemed_at::text from public.plan_invites where id = '${INVITE_ID}'::uuid`),
    ).toBe(redeemedAt);
  }, 120_000);
});
