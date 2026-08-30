// Effective PostgreSQL proof for migration 0125. It executes the complete
// migration history, then exercises threshold concurrency, abandoned Plans,
// private invite replay, and function privileges through production RPCs.

import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20260830180000_0125_plan_crew_commitment.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const MIGRATION_CHAIN = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name <= FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

function binary(name: "initdb" | "postgres" | "psql"): string | null {
  for (const path of [
    `/opt/homebrew/opt/postgresql@16/bin/${name}`,
    `/usr/local/opt/postgresql@16/bin/${name}`,
    `/usr/lib/postgresql/16/bin/${name}`,
  ]) {
    try {
      if (existsSync(path)) return path;
    } catch {
      // Try next known PostgreSQL 16 path.
    }
  }
  return null;
}

function missingPostgresReason(): string | null {
  if (process.env.PUBMAX_RLS_NO_PG === "1") {
    return "PUBMAX_RLS_NO_PG=1 forced PostgreSQL skip.";
  }
  const missing = (["initdb", "postgres", "psql"] as const)
    .filter((name) => binary(name) === null);
  return missing.length > 0
    ? `Missing PostgreSQL binaries: ${missing.join(", ")}.`
    : null;
}

const execFileAsync = promisify(execFile);

type Database = {
  sql(statement: string): string;
  concurrentResults(statements: readonly string[]): Promise<string[]>;
  stop(): Promise<void>;
};

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

async function startDatabase(): Promise<Database> {
  const initdb = binary("initdb");
  const postgres = binary("postgres");
  const psql = binary("psql");
  if (!initdb || !postgres || !psql) {
    throw new Error(missingPostgresReason() ?? "PostgreSQL 16 is unavailable.");
  }
  const directory = mkdtempSync(join(tmpdir(), "pubmax-plan-crew-0125-"));
  const port = await freePort();
  try {
    execFileSync(initdb, [
      "-D", directory, "--auth=trust", "--username=postgres", "--locale=C", "-E", "UTF8",
      "-c", "shared_memory_type=mmap", "-c", "dynamic_shared_memory_type=mmap",
    ], { stdio: "pipe" });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  writeFileSync(
    join(directory, "postgresql.auto.conf"),
    `listen_addresses='127.0.0.1'\nport=${port}\nfsync=off\nfull_page_writes=off\nsynchronous_commit=off\n`,
  );
  const server: ChildProcess = spawn(
    postgres,
    ["-D", directory, "-k", directory, "-h", "127.0.0.1", "-p", String(port)],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let serverLog = "";
  server.stderr!.setEncoding("utf8");
  server.stderr!.on("data", (chunk: string) => {
    serverLog = (serverLog + chunk).slice(-8_000);
  });
  const connection = ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres"];
  for (let attempt = 0; attempt < 600; attempt += 1) {
    try {
      execFileSync(psql, [...connection, "-c", "select 1"], { stdio: "pipe" });
      break;
    } catch {
      if (server.exitCode !== null) {
        throw new Error(`PostgreSQL exited with code ${server.exitCode}.\n${serverLog.trim()}`);
      }
      if (attempt === 599) {
        throw new Error(`PostgreSQL did not start within 60s.\n${serverLog.trim()}`);
      }
      await sleep(100);
    }
  }
  const run = (args: string[]) => execFileSync(
    psql,
    [...connection, "-v", "ON_ERROR_STOP=1", ...args],
    { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
  run(["-f", SESSION_FIXTURE]);
  for (const migration of MIGRATION_CHAIN) run(["-f", migration]);
  return {
    sql: (statement) => run(["-q", "-t", "-A", "-c", statement]),
    concurrentResults: (statements) => Promise.all(statements.map(async (statement) => {
      const { stdout } = await execFileAsync(psql, [
        ...connection, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-c", statement,
      ], { encoding: "utf8" });
      return stdout.trim();
    })),
    async stop() {
      if (server.exitCode === null) {
        server.kill("SIGTERM");
        await Promise.race([
          new Promise<void>((resolve) => server.once("exit", resolve)),
          sleep(1_000),
        ]);
      }
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

type CommitmentResult = {
  outcome: string;
  member_id: string | null;
  crew_committed_at: string | null;
  crew_committed_event_id: string | null;
};

function json(value: string): CommitmentResult {
  return JSON.parse(value) as CommitmentResult;
}

function digest(character: string): string {
  return character.repeat(64);
}

function uniqueDigest(label: string): string {
  return createHash("sha256").update(label).digest("hex");
}

const postgresUnavailable = missingPostgresReason();
if (postgresUnavailable) {
  process.stdout.write(`[plan-crew-postgres] SKIPPED: ${postgresUnavailable}\n`);
}
let database: Database | null = null;

beforeAll(async () => {
  if (postgresUnavailable) return;
  if (!existsSync(FORWARD)) throw new Error(`Missing migration: ${FORWARD}`);
  database = await startDatabase();
}, 120_000);

afterAll(async () => database?.stop());

describe.skipIf(postgresUnavailable !== null)("Plan crew commitment PostgreSQL migration", () => {
  it("records one event across concurrent second and third joins", async () => {
    const db = database!;
    const plan = "24242424-2424-4242-8242-242424242424";
    const host = "25252525-2525-4252-8252-252525252525";
    const members = [
      "26262626-2626-4262-8262-262626262626",
      "27272727-2727-4272-8272-272727272727",
    ] as const;
    db.sql(`
      insert into public.plans(id,title,start_time,status)
      values('${plan}','Commitment race',now()+interval '1 day','ready');
      insert into public.plan_crew_members(
        id,plan_id,name,token_hash,status,joined_at,updated_at,can_collaborate
      ) values(
        '${host}','${plan}','Host','${digest("a")}','in',now()-interval '1 minute',now(),true
      );
    `);
    const start = new Date(Date.now() + 1_000).toISOString();
    const synchronizedJoin = (index: 0 | 1) => `begin;
      set local statement_timeout='10s';
      select pg_sleep(greatest(0,extract(epoch from timestamptz '${start}'-clock_timestamp())));
      select public.join_plan_idempotent_with_crew_commitment_atomic(
        '${plan}','${members[index]}','Guest ${index + 1}','${digest(index === 0 ? "b" : "c")}',now(),false,
        '${digest(index === 0 ? "d" : "e")}','${digest(index === 0 ? "f" : "1")}'
      );
      commit;`;
    const results = (await db.concurrentResults([
      synchronizedJoin(0),
      synchronizedJoin(1),
    ])).map(json);
    const threshold = results.find((result) => result.crew_committed_event_id !== null)!;

    expect(results.map((result) => result.outcome)).toEqual(["joined", "joined"]);
    expect(results.filter((result) => result.crew_committed_event_id !== null)).toHaveLength(1);
    expect(threshold).toMatchObject({
      crew_committed_at: expect.any(String),
      crew_committed_event_id: expect.any(String),
    });
    expect(db.sql(`select count(*) from public.plan_crew_members where plan_id='${plan}' and crew_committed_event_id is not null`)).toBe("1");

    const thresholdIndex = results.indexOf(threshold) as 0 | 1;
    db.sql(`update public.plans set status='completed' where id='${plan}'`);
    const replay = json(db.sql(`select public.join_plan_idempotent_with_crew_commitment_atomic(
      '${plan}','${members[thresholdIndex]}','Guest ${thresholdIndex + 1}','${digest(thresholdIndex === 0 ? "b" : "c")}',now(),false,
      '${digest(thresholdIndex === 0 ? "d" : "e")}','${digest(thresholdIndex === 0 ? "f" : "1")}'
    )`));
    expect(replay).toEqual({ ...threshold, outcome: "replayed" });
  });

  it("does not record an event for an abandoned Plan", () => {
    const db = database!;
    const plan = "34343434-3434-4343-8343-343434343434";
    db.sql(`
      insert into public.plans(id,title,start_time,status)
      values('${plan}','Abandoned commitment',now()+interval '1 day','abandoned');
      insert into public.plan_crew_members(
        id,plan_id,name,token_hash,status,joined_at,updated_at,can_collaborate
      ) values(
        '35353535-3535-4353-8353-353535353535','${plan}','Host','${digest("2")}','in',now(),now(),true
      );
    `);

    const result = json(db.sql(`select public.join_plan_idempotent_with_crew_commitment_atomic(
      '${plan}','36363636-3636-4363-8363-363636363636','Guest','${digest("3")}',now(),false,
      '${digest("4")}','${digest("5")}'
    )`));

    expect(result).toMatchObject({
      outcome: "joined",
      crew_committed_at: null,
      crew_committed_event_id: null,
    });
    expect(db.sql(`select count(*) from public.plan_crew_members where plan_id='${plan}' and crew_committed_event_id is not null`)).toBe("0");
  });

  it("does not record an event when an ordinary join reaches two on a completed Plan", () => {
    const db = database!;
    const plan = "47474747-4747-4747-8747-474747474747";
    const member = "49494949-4949-4949-8949-494949494949";
    db.sql(`
      insert into public.plans(id,title,start_time,status)
      values('${plan}','Completed ordinary commitment',now()-interval '1 day','completed');
      insert into public.plan_crew_members(
        id,plan_id,name,token_hash,status,joined_at,updated_at,can_collaborate
      ) values(
        '48484848-4848-4848-8848-484848484848','${plan}','Host','${uniqueDigest("completed-ordinary-host")}','in',now(),now(),true
      );
    `);

    const result = json(db.sql(`select public.join_plan_idempotent_with_crew_commitment_atomic(
      '${plan}','${member}','Guest','${uniqueDigest("completed-ordinary-guest")}',now(),false,
      '${uniqueDigest("completed-ordinary-key")}','${uniqueDigest("completed-ordinary-request")}'
    )`));

    expect(result).toMatchObject({
      outcome: "joined",
      crew_committed_at: null,
      crew_committed_event_id: null,
    });
    expect(db.sql(`select count(*) from public.plan_crew_members where plan_id='${plan}' and crew_committed_event_id is not null`)).toBe("0");
  });

  it("does not record an event when public Going reaches two on a completed Plan", () => {
    const db = database!;
    const plan = "50505050-5050-4050-8050-505050505050";
    const member = "52525252-5252-4252-8252-525252525252";
    db.sql(`
      insert into public.plans(id,title,start_time,status)
      values('${plan}','Completed public Going',now()-interval '1 day','completed');
      insert into public.plan_crew_members(
        id,plan_id,name,token_hash,status,joined_at,updated_at,can_collaborate
      ) values(
        '51515151-5151-4151-8151-515151515151','${plan}','Host','${uniqueDigest("completed-rsvp-host")}','in',now(),now(),true
      );
    `);

    const result = json(db.sql(`select public.upsert_plan_invite_rsvp_membership_with_crew_commitment_atomic(
      '${plan}','${uniqueDigest("completed-rsvp-submitter")}','Public guest','going','${member}',null,'Public guest',
      '${uniqueDigest("completed-rsvp-guest")}','${uniqueDigest("completed-rsvp-key")}',
      '${uniqueDigest("completed-rsvp-request")}',now(),100
    )`));

    expect(result).toMatchObject({
      outcome: "saved",
      member_id: member,
      crew_committed_at: null,
      crew_committed_event_id: null,
    });
    expect(db.sql(`select count(*) from public.plan_crew_members where plan_id='${plan}' and crew_committed_event_id is not null`)).toBe("0");
  });

  it("replays private invite evidence and keeps helper privileges closed", () => {
    const db = database!;
    const plan = "29292929-2929-4292-8292-292929292929";
    const host = "30303030-3030-4303-8303-303030303030";
    const invite = "31313131-3131-4313-8313-313131313131";
    const member = "32323232-3232-4323-8323-323232323232";
    db.sql(`
      insert into public.plans(id,title,start_time,status)
      values('${plan}','Invite commitment',now()+interval '1 day','ready');
      insert into public.plan_crew_members(
        id,plan_id,name,token_hash,status,joined_at,updated_at,can_collaborate
      ) values(
        '${host}','${plan}','Host','${digest("6")}','in',now()-interval '1 minute',now(),true
      );
      insert into public.plan_invites(
        id,plan_id,created_by_member_id,token_hash,idempotency_key,created_at,expires_at
      ) values(
        '${invite}','${plan}','${host}','${digest("7")}','commitment-invite',now(),now()+interval '1 day'
      );
    `);
    const redeem = () => json(db.sql(`select public.redeem_plan_invite_idempotent_with_crew_commitment_atomic(
      '${plan}','${digest("7")}','${member}','Private guest','${digest("8")}',now(),
      '${digest("9")}','${digest("a")}'
    )`));
    const first = redeem();
    expect(first).toMatchObject({
      outcome: "joined",
      crew_committed_at: expect.any(String),
      crew_committed_event_id: expect.any(String),
    });

    expect(json(db.sql(`select public.join_plan_idempotent_with_crew_commitment_atomic(
      '${plan}','33333333-3333-4333-8333-333333333333','Later guest','${digest("0")}',now(),false,
      '${digest("2")}','${digest("3")}'
    )`))).toMatchObject({
      outcome: "joined",
      crew_committed_at: null,
      crew_committed_event_id: null,
    });
    const replay = redeem();
    expect(replay).toEqual({ ...first, outcome: "replayed" });
    expect(db.sql("select has_function_privilege('authenticated','public.redeem_plan_invite_idempotent_with_crew_commitment_atomic(uuid,text,uuid,text,text,timestamptz,text,text)','execute')")).toBe("f");
    expect(db.sql("select has_function_privilege('service_role','public.redeem_plan_invite_idempotent_with_crew_commitment_atomic(uuid,text,uuid,text,text,timestamptz,text,text)','execute')")).toBe("t");
    expect(db.sql("select has_function_privilege('service_role','public._plan_crew_commitment_for_member(uuid,uuid,boolean)','execute')")).toBe("f");
  });

  it("records a public Going threshold through the evidence-returning RPC", () => {
    const db = database!;
    const plan = "40404040-4040-4040-8040-404040404040";
    const member = "41414141-4141-4141-8141-414141414141";
    db.sql(`
      insert into public.plans(id,title,start_time,status)
      values('${plan}','Public Going commitment',now()+interval '1 day','ready');
      insert into public.plan_crew_members(
        id,plan_id,name,token_hash,status,joined_at,updated_at,can_collaborate
      ) values(
        '42424242-4242-4242-8242-424242424242','${plan}','Host','${digest("4")}','in',now(),now(),true
      );
    `);

    const result = json(db.sql(`select public.upsert_plan_invite_rsvp_membership_with_crew_commitment_atomic(
      '${plan}','${digest("5")}','Public guest','going','${member}',null,'Public guest',
      '${digest("5")}','${digest("7")}','${digest("8")}',now(),100
    )`));

    expect(result).toMatchObject({
      outcome: "saved",
      member_id: member,
      crew_committed_at: expect.any(String),
      crew_committed_event_id: expect.any(String),
    });
    expect(db.sql(`select count(*) from public.plan_crew_members where plan_id='${plan}' and crew_committed_event_id is not null`)).toBe("1");
  });

  it("records a public Going threshold through the old compatible RPC", () => {
    const db = database!;
    const plan = "43434343-4343-4343-8343-434343434343";
    const member = "44444444-4444-4444-8444-444444444444";
    db.sql(`
      insert into public.plans(id,title,start_time,status)
      values('${plan}','Old app public Going',now()+interval '1 day','ready');
      insert into public.plan_crew_members(
        id,plan_id,name,token_hash,status,joined_at,updated_at,can_collaborate
      ) values(
        '45454545-4545-4545-8545-454545454545','${plan}','Host','${digest("7")}','in',now(),now(),true
      );
    `);

    const result = json(db.sql(`select public.upsert_plan_invite_rsvp_membership_atomic(
      '${plan}','${digest("a")}','Old app guest','going','${member}',null,'Old app guest',
      '${digest("d")}','${digest("c")}','${digest("d")}',now(),100
    )`));

    expect(result).toMatchObject({
      outcome: "saved",
      member_id: member,
      crew_committed_at: expect.any(String),
      crew_committed_event_id: expect.any(String),
    });
    expect(db.sql(`select count(*) from public.plan_crew_members where plan_id='${plan}' and crew_committed_event_id is not null`)).toBe("1");
  });

  it("accepts a refreshed crew token digest for one receipt", () => {
    const db = database!;
    const eventId = "46464646-4646-4646-8646-464646464646";
    expect(db.sql(`select public.claim_analytics_event_receipt(
      '${eventId}','${digest("e")}','crew_committed',timestamptz '2026-08-30 12:00:00+00',
      timestamptz '2026-08-30 12:00:01+00'
    )`)).toBe("claimed");
    expect(db.sql(`select public.claim_analytics_event_receipt(
      '${eventId}','${digest("f")}','crew_committed',timestamptz '2026-08-30 12:00:02+00',
      timestamptz '2026-08-30 12:00:03+00'
    )`)).toBe("claimed");
    expect(db.sql(`select token_hash from public.analytics_event_receipts where event_id='${eventId}'`)).toBe(digest("f"));
    expect(db.sql(`select public.complete_analytics_event_receipt('${eventId}',timestamptz '2026-08-30 12:00:04+00')`)).toBe("t");
    expect(db.sql(`select public.claim_analytics_event_receipt(
      '${eventId}','${digest("1")}','crew_committed',timestamptz '2026-08-30 12:00:05+00',
      timestamptz '2026-08-30 12:00:06+00'
    )`)).toBe("delivered");
    expect(db.sql(`select count(*) from public.analytics_event_receipts where event_id='${eventId}'`)).toBe("1");
  });

  it("keeps commitment columns and functions service-only", () => {
    const db = database!;
    expect(db.sql("select has_column_privilege('authenticated','public.plan_crew_members','crew_committed_at','select')")).toBe("f");
    expect(db.sql("select has_column_privilege('authenticated','public.plan_crew_members','crew_committed_event_id','select')")).toBe("f");
    expect(db.sql("select has_column_privilege('service_role','public.plan_crew_members','crew_committed_at','select')")).toBe("t");
    expect(db.sql("select has_column_privilege('service_role','public.plan_crew_members','crew_committed_event_id','update')")).toBe("t");
    for (const signature of [
      "public.join_plan_idempotent_with_crew_commitment_atomic(uuid,uuid,text,text,timestamptz,boolean,text,text)",
      "public.redeem_plan_invite_idempotent_with_crew_commitment_atomic(uuid,text,uuid,text,text,timestamptz,text,text)",
      "public.upsert_plan_invite_rsvp_membership_with_crew_commitment_atomic(uuid,text,text,text,uuid,uuid,text,text,text,text,timestamptz,integer)",
    ]) {
      expect(db.sql(`select has_function_privilege('authenticated','${signature}','execute')`)).toBe("f");
      expect(db.sql(`select has_function_privilege('service_role','${signature}','execute')`)).toBe("t");
    }
  });
});
