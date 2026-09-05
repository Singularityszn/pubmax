// Effective proof for 0146, and for the half of 0034 the review lane now
// depends on. The shape pins live in nightSignalCheckpointMigration.test.ts;
// this file APPLIES the migrations to a real PostgreSQL 16 and exercises the
// tables as the three Supabase roles, because a policy is a claim about what a
// role may do and only the database can answer that.
//
// Same host contract as the other effective migration proofs: a host with no
// PostgreSQL binaries skips LOUDLY rather than passing quietly.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const CLAIMS_MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260716190000_0034_night_signal_claims.sql",
);
const SEARCH_PATH_MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260716200100_0036_fix_night_signal_function_search_paths.sql",
);
const RLS_WAVE2 = join(
  process.cwd(),
  "supabase/migrations/20260803203000_0068_rls_wave2_service_role_only.sql",
);
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260905160000_0146_night_signal_ingest_checkpoint.sql",
);
const ROLLBACK_PATH = join(
  process.cwd(),
  "supabase/migrations/rollback/20260905160000_0146_night_signal_ingest_checkpoint_rollback.sql",
);

type PostgresSession = {
  sql: (statement: string) => string;
  expectRefusal: (statement: string) => string;
  applyFile: (path: string) => void;
  stop: () => Promise<void>;
};

function findPostgresBinary(name: "initdb" | "postgres" | "psql"): string | null {
  const candidates = [
    `/opt/homebrew/opt/postgresql@16/bin/${name}`,
    `/opt/homebrew/opt/postgresql@17/bin/${name}`,
    `/usr/local/opt/postgresql@16/bin/${name}`,
    `/usr/lib/postgresql/16/bin/${name}`,
    `/usr/lib/postgresql/17/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    `/usr/bin/${name}`,
    name,
  ];
  for (const candidate of candidates) {
    try {
      if (candidate === name) {
        execFileSync("which", [name], { stdio: "pipe" });
        return name;
      }
      if (existsSync(candidate)) return candidate;
    } catch {
      // Try the next known PostgreSQL installation path.
    }
  }
  return null;
}

function missingPostgresReason(): string | null {
  if (process.env.PUBMAX_NIGHT_SIGNAL_MIGRATION_NO_PG === "1") {
    return "PostgreSQL binaries were deliberately hidden by PUBMAX_NIGHT_SIGNAL_MIGRATION_NO_PG=1.";
  }
  const missing = (["initdb", "postgres", "psql"] as const).filter(
    (name) => findPostgresBinary(name) === null,
  );
  return missing.length > 0
    ? `Missing PostgreSQL binaries: ${missing.join(", ")}. Install PostgreSQL 16 to run Night Signal migration proofs.`
    : null;
}

/** The night_signal_claims statements of 0068, exactly as that migration ships them. */
function nightSignalBlockOf(wave2: string): string {
  const start = wave2.indexOf("-- night_signal_claims:");
  const end = wave2.lastIndexOf("commit;");
  const block = start >= 0 && end > start ? wave2.slice(start, end) : "";
  if (!block.includes("on table public.night_signal_claims to service_role;")) {
    throw new Error("0068 no longer carries its night_signal_claims grants; this proof is stale.");
  }
  return block;
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

async function startPostgresSession(): Promise<PostgresSession> {
  const initdb = findPostgresBinary("initdb");
  const postgres = findPostgresBinary("postgres");
  const psql = findPostgresBinary("psql");
  if (!initdb || !postgres || !psql) {
    throw new Error(missingPostgresReason() ?? "PostgreSQL binaries unavailable.");
  }

  const dataDir = mkdtempSync(join(tmpdir(), "pubmax-night-signal-0146-"));
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
  const logs: string[] = [];
  processHandle.stdout?.on("data", (chunk) => logs.push(chunk.toString()));
  processHandle.stderr?.on("data", (chunk) => logs.push(chunk.toString()));

  const connectionArgs = ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres"];
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
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
  if (!ready) {
    processHandle.kill("SIGKILL");
    rmSync(dataDir, { recursive: true, force: true });
    throw new Error(`PostgreSQL failed to start:\n${logs.join("")}`);
  }

  const database = "pubmax_night_signal_0146";
  execFileSync(
    psql,
    [
      ...connectionArgs,
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `create database ${database}`,
    ],
    { stdio: "pipe" },
  );
  const databaseArgs = [...connectionArgs, "-d", database, "-v", "ON_ERROR_STOP=1"];

  // psql prints a command tag for every statement, so `set role x; update …`
  // answers "SET\n<rows>\nUPDATE 1". The rows are the answer; the tags are
  // noise, and a returned value in this file is never one of these words.
  const COMMAND_TAG =
    /^(SET|BEGIN|COMMIT|INSERT \d|UPDATE \d|DELETE \d|TRUNCATE TABLE|CREATE |DROP |ALTER |GRANT|REVOKE)/;
  const stripCommandTags = (output: string): string =>
    output
      .trim()
      .split("\n")
      .filter((line) => !COMMAND_TAG.test(line.trim()))
      .join("\n")
      .trim();

  const sql = (statement: string): string =>
    stripCommandTags(
      execFileSync(psql, [...databaseArgs, "-t", "-A", "-c", statement], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );

  const expectRefusal = (statement: string): string => {
    try {
      execFileSync(psql, [...databaseArgs, "-t", "-A", "-c", statement], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      const shell = error as { stderr?: Buffer | string };
      return String(shell.stderr ?? "");
    }
    throw new Error(`PostgreSQL accepted a statement it had to refuse: ${statement}`);
  };

  const applyFile = (path: string): void => {
    execFileSync(psql, [...databaseArgs, "-f", path], { stdio: "pipe" });
  };

  try {
    // The Supabase roles these tables are governed by. service_role carries
    // BYPASSRLS in a Supabase project, so the local cluster mirrors that or
    // "the write path still works" would not be the thing under test.
    sql(`
      create role anon nologin noinherit;
      create role authenticated nologin noinherit;
      create role service_role nologin noinherit bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
      -- A Supabase project ships default privileges that grant EXECUTE on new
      -- public functions to these roles. 0034 revokes its validation helpers
      -- from PUBLIC and relies on that grant surviving, so the local cluster
      -- mirrors it or the write path would fail here for a reason no deployed
      -- database has.
      alter default privileges in schema public
        grant execute on functions to anon, authenticated, service_role;
    `);
    applyFile(CLAIMS_MIGRATION);
    applyFile(SEARCH_PATH_MIGRATION);
    // 0034 creates the table; the grants the write path needs ship in 0068,
    // which also touches tables this cluster has no reason to hold. So the
    // night_signal_claims block of that migration is applied VERBATIM rather
    // than restated, or this proof would be about a grant nobody deployed.
    sql(nightSignalBlockOf(readFileSync(RLS_WAVE2, "utf8")));
    applyFile(MIGRATION_PATH);
  } catch (error) {
    processHandle.kill("SIGKILL");
    rmSync(dataDir, { recursive: true, force: true });
    throw error;
  }

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

  return { sql, expectRefusal, applyFile, stop };
}

let session: PostgresSession | null = null;
let skipReason: string | null = null;

beforeAll(async () => {
  skipReason = missingPostgresReason();
  if (skipReason) {
    console.error(
      [
        "",
        "NIGHT SIGNAL 0146 EFFECTIVE TESTS SKIPPED - THIS IS NOT A PASS",
        `Reason: ${skipReason}`,
        "No checkpoint row or candidate row was written or refused on this host.",
        "",
      ].join("\n"),
    );
    return;
  }
  session = await startPostgresSession();
}, 90_000);

beforeEach((context) => {
  if (skipReason) context.skip(true, skipReason);
  session?.sql(
    "truncate public.night_signal_ingest_checkpoint; truncate public.night_signal_claims;",
  );
});

afterAll(async () => {
  await session?.stop();
});

function requireSession(): PostgresSession {
  if (!session) throw new Error("PostgreSQL Night Signal session did not start.");
  return session;
}

const CANDIDATE_ID = "opening:camden:20260901:abcd1234";

function insertCandidate(reviewState: string, reviewer: string | null): string {
  const reviewedAt = reviewer ? "now()" : "null";
  const authority = reviewer ? `'${reviewer}'` : "null";
  return `
    insert into public.night_signal_claims
      (id, kind, entity_type, entity_id, claim, source_url, publisher, published_at,
       observed_at, expires_at, confidence, review_state, verification, route_effect,
       reviewed_at, review_authority)
    values
      ('${CANDIDATE_ID}', 'opening', 'night_area', 'camden',
       'The Camden Arms reopens as a late-night taproom on Chalk Farm Road',
       'https://example.com/london/camden-arms', 'example.com', now() - interval '3 days',
       now() - interval '1 day', now() + interval '20 days', 0.5, '${reviewState}',
       'single_source', 'none', ${reviewedAt}, ${authority})
  `;
}

describe("0146 applied to PostgreSQL", () => {
  it("takes one checkpoint per scope from the service role", () => {
    const db = requireSession();
    db.sql(`
      set role service_role;
      insert into public.night_signal_ingest_checkpoint (scope, version, deferred, terminal)
      values ('london', 1, '[{"key":"opening|new London pub","attempts":1}]'::jsonb, '[]'::jsonb);
    `);
    expect(
      db.sql(
        "set role service_role; select scope, jsonb_array_length(deferred) from public.night_signal_ingest_checkpoint",
      ),
    ).toBe("london|1");

    expect(
      db.expectRefusal(`
        set role service_role;
        insert into public.night_signal_ingest_checkpoint (scope) values ('london');
      `),
    ).toMatch(/duplicate key value|night_signal_ingest_checkpoint_pkey/i);
  });

  it("refuses half a lease, in either direction", () => {
    const db = requireSession();
    expect(
      db.expectRefusal(`
        set role service_role;
        insert into public.night_signal_ingest_checkpoint (scope, lease_owner)
        values ('london', 'run-a');
      `),
    ).toMatch(/violates check constraint/i);
    expect(
      db.expectRefusal(`
        set role service_role;
        insert into public.night_signal_ingest_checkpoint (scope, lease_expires_at)
        values ('london', now() + interval '2 minutes');
      `),
    ).toMatch(/violates check constraint/i);
  });

  it("gives exactly one of two racing runs the lease", () => {
    const db = requireSession();
    db.sql(`
      set role service_role;
      insert into public.night_signal_ingest_checkpoint (scope) values ('london');
    `);
    // The claim the store issues: a conditional UPDATE that matches only a null
    // or expired lease. The first run takes the row; the second matches nothing.
    const claim = (owner: string): string => `
      set role service_role;
      update public.night_signal_ingest_checkpoint
      set lease_owner = '${owner}', lease_expires_at = now() + interval '150 seconds'
      where scope = 'london' and (lease_owner is null or lease_expires_at < now())
      returning lease_owner;
    `;
    expect(db.sql(claim("run-a"))).toBe("run-a");
    expect(db.sql(claim("run-b"))).toBe("");

    // A commit guarded on the lease we hold: the run that lost writes nothing.
    const commit = (owner: string): string => `
      set role service_role;
      update public.night_signal_ingest_checkpoint
      set terminal = '[{"key":"x","attempts":3}]'::jsonb, lease_owner = null, lease_expires_at = null
      where scope = 'london' and lease_owner = '${owner}'
      returning scope;
    `;
    expect(db.sql(commit("run-b"))).toBe("");
    expect(db.sql(commit("run-a"))).toBe("london");
  });

  it("keeps the browser out of the checkpoint entirely", () => {
    const db = requireSession();
    db.sql(`
      set role service_role;
      insert into public.night_signal_ingest_checkpoint (scope) values ('london');
    `);
    for (const role of ["anon", "authenticated"]) {
      expect(
        db.expectRefusal(
          `set role ${role}; select scope from public.night_signal_ingest_checkpoint;`,
        ),
      ).toMatch(/permission denied/i);
      expect(
        db.expectRefusal(
          `set role ${role}; insert into public.night_signal_ingest_checkpoint (scope) values ('leeds');`,
        ),
      ).toMatch(/permission denied/i);
    }
  });
});

describe("the candidate queue 0146 exists to feed", () => {
  it("stores a pending candidate that no reader may see", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertCandidate("pending", null)};`);
    expect(
      db.sql("set role service_role; select review_state from public.night_signal_claims"),
    ).toBe("pending");
    // 0034's policy admits approved, current rows only, so an unreviewed
    // third-party claim is invisible to anon and to a signed-in member.
    for (const role of ["anon", "authenticated"]) {
      expect(db.sql(`set role ${role}; select id from public.night_signal_claims;`)).toBe("");
    }
  });

  it("refuses an approval that names no reviewer, and takes one that does", () => {
    const db = requireSession();
    expect(db.expectRefusal(`set role service_role; ${insertCandidate("approved", null)};`)).toMatch(
      /violates check constraint/i,
    );

    db.sql(`set role service_role; ${insertCandidate("approved", "operations")};`);
    // Approved, dated and in window: now a reader sees it.
    expect(db.sql("set role anon; select entity_id from public.night_signal_claims;")).toBe(
      "camden",
    );
  });

  it("keeps a rejected candidate out of every reader's answer", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertCandidate("rejected", "operations")};`);
    expect(db.sql("set role anon; select id from public.night_signal_claims;")).toBe("");
  });
});

describe("the 0146 rollback", () => {
  it("drops the checkpoint and leaves the candidates alone", () => {
    const db = requireSession();
    db.sql(`set role service_role; ${insertCandidate("pending", null)};`);
    db.applyFile(ROLLBACK_PATH);
    expect(db.sql("select to_regclass('public.night_signal_ingest_checkpoint') is null")).toBe("t");
    expect(db.sql("set role service_role; select count(*) from public.night_signal_claims")).toBe(
      "1",
    );
    // Put it back for any case that runs after this one.
    db.applyFile(MIGRATION_PATH);
  });
});
