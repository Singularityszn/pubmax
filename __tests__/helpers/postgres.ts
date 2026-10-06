/**
 * The ONE throwaway PostgreSQL cluster every effective proof runs on.
 *
 * Before this module the tree held sixteen hand-copied `missingPostgresReason`
 * definitions, each with its own binary search and its own `initdb` flags, and
 * that drift is what a full parallel `vitest run` used to fail on: a macOS host
 * ships `kern.sysv.shmmni = 32`, every running cluster claims one SysV segment
 * for the postmaster interlock whatever `shared_memory_type` says, and two
 * dozen suites booting their own cluster at once exhausted the table with
 *
 *   FATAL:  could not create shared memory segment: No space left on device
 *
 * over a perfectly healthy migration.
 *
 * The host facts - which binary, whether this host may run a proof at all, and
 * the cluster budget - live in `scripts/rls/postgresHost.mjs`, because the RLS
 * runner and the session harness are plain `node` and cannot import TypeScript.
 * This module is the TypeScript door onto them plus the ONE cluster every proof
 * boots: `startPostgres` takes a host slot before it runs `initdb` and gives it
 * back in `stop()`, so no run - or two runs in two worktrees - can put more
 * than PUBMAX_PG_MAX_CLUSTERS live clusters on one machine.
 *
 * A skip is never a pass. `postgresSkipReason()` is non-null ONLY for the
 * deliberate PUBMAX_RLS_NO_PG=1 opt-out; an absent PostgreSQL nobody opted out
 * of makes `startPostgres` throw, so a green run means the proofs really ran.
 */
import { execFile, execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import {
  acquireClusterSlot,
  findPostgresBinary,
  HARNESS_CLUSTER_SETTINGS,
  missingPostgresReason,
  postgresSkipReason,
} from "../../scripts/rls/postgresHost.mjs";
import {
  registerHarnessCluster,
  stopHarnessCluster,
  unregisterHarnessCluster,
} from "../../scripts/rls/postgresShm.mjs";

const execFileAsync = promisify(execFile);

export {
  postgresSkipReason,
};

/* ------------------------------------------------------------------ */
/* The cluster                                                         */
/* ------------------------------------------------------------------ */

export type PostgresAttempt = { ok: boolean; said: string };

export type PostgresSession = {
  /** The resolved psql binary, for a caller that needs to shell out itself. */
  psql: string;
  port: number;
  /** The database every helper below connects to. */
  database: string;
  /** Host, port and user. No database and no ON_ERROR_STOP. */
  connectionArgs: string[];
  /** connectionArgs plus `-d <database> -v ON_ERROR_STOP=1`. */
  databaseArgs: string[];
  /** Raw psql with the session's own connection arguments. Throws on refusal. */
  run(args: string[]): string;
  /** One statement, tuples only, trimmed, with psql's own SET noise dropped. */
  sql(statement: string): string;
  /** `sql` off the event loop, for a proof that runs statements concurrently. */
  sqlAsync(statement: string): Promise<string>;
  /** Runs a statement and reports whether the database took it. Never throws. */
  attempt(statement: string): Promise<PostgresAttempt>;
  /** Runs statements at once, each on its own connection. Rejects on refusal. */
  concurrent(statements: readonly string[]): Promise<void>;
  /** `concurrent`, answering what each statement said. */
  concurrentResults(statements: readonly string[]): Promise<string[]>;
  /** Runs a statement that MUST be refused and answers what the database said. */
  expectRefusal(statement: string): string;
  /** Applies one .sql file. Throws on the first error in it. */
  applyFile(path: string): void;
  /** Applies one .sql file inside ONE transaction, so a refusal leaves nothing. */
  applyFileTransactional(path: string): void;
  stop(): Promise<void>;
};

export type StartPostgresOptions = {
  /** Names the temporary data directory, so a stray cluster says whose it is. */
  label?: string;
  /** Created and connected to. Defaults to the bootstrap `postgres` database. */
  database?: string;
  maxConnections?: number;
};

async function pickPort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

/** psql prints the five-character SQLSTATE only under verbose error reporting. */
const VERBOSE = ["-v", "VERBOSITY=verbose"] as const;

function tidy(output: string): string {
  return output
    .trim()
    .split("\n")
    .filter((line) => line.trim() !== "SET")
    .join("\n")
    .trim();
}

/**
 * Boots a throwaway PostgreSQL 16 cluster and hands back the runners every
 * effective proof needs. Refuses rather than guessing when the host has no
 * PostgreSQL: ask `missingPostgresReason()` first and skip on its answer.
 */
export async function startPostgres(
  options: StartPostgresOptions = {},
): Promise<PostgresSession> {
  const reason = missingPostgresReason();
  if (reason) throw new Error(reason);
  const initdb = findPostgresBinary("initdb");
  const postgres = findPostgresBinary("postgres");
  const psql = findPostgresBinary("psql");
  if (!initdb || !postgres || !psql) throw new Error("PostgreSQL binaries unavailable.");

  const label = options.label ?? "proof";
  const releaseSlotHold = await acquireClusterSlot(label);

  let dataDir: string | null = null;
  try {
    // The data directory holds the unix socket, and PostgreSQL refuses a
    // socket path over 103 bytes, so the label is trimmed here rather than
    // spelled out: it names the slot and every error message instead.
    dataDir = mkdtempSync(join(tmpdir(), `pubmax-pg-${label.slice(0, 12)}-`));
    const port = await pickPort();
    execFileSync(
      initdb,
      [
        "-D",
        dataDir,
        "--locale=C",
        "-E",
        "UTF8",
        "--username=postgres",
        "--auth=trust",
        // mmap keeps the parallel-worker segments off the SysV table; the tiny
        // postmaster interlock segment is the one this host budget counts.
        "-c",
        "shared_memory_type=mmap",
        "-c",
        "dynamic_shared_memory_type=mmap",
      ],
      { stdio: "pipe" },
    );
    writeFileSync(
      join(dataDir, "postgresql.auto.conf"),
      [
        "listen_addresses = '127.0.0.1'",
        `port = ${port}`,
        `max_connections = ${options.maxConnections ?? 24}`,
        "shared_buffers = 16MB",
        "shared_memory_type = mmap",
        "dynamic_shared_memory_type = mmap",
        "fsync = off",
        "full_page_writes = off",
        "synchronous_commit = off",
        ...HARNESS_CLUSTER_SETTINGS,
      ].join("\n") + "\n",
    );

    const server = spawn(
      postgres,
      ["-D", dataDir, "-k", dataDir, "-p", String(port), "-h", "127.0.0.1"],
      { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LC_ALL: "C" } },
    );
    let log = "";
    const keep = (chunk: Buffer | string): void => {
      log = (log + String(chunk)).slice(-8_000);
    };
    server.stdout?.on("data", keep);
    server.stderr?.on("data", keep);

    const connectionArgs = ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres"];
    let ready = false;
    for (let attempt = 0; attempt < 300; attempt += 1) {
      if (server.exitCode !== null) {
        throw new Error(
          `PostgreSQL exited with code ${server.exitCode} before accepting connections.\n${log.trim()}`,
        );
      }
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
    if (!ready) throw new Error(`PostgreSQL failed to start:\n${log.trim()}`);

    registerHarnessCluster(dataDir);

    const database = options.database ?? "postgres";
    if (database !== "postgres") {
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
    }
    const databaseArgs = [...connectionArgs, "-d", database, "-v", "ON_ERROR_STOP=1"];

    const run = (args: string[]): string =>
      tidy(
        execFileSync(psql, [...databaseArgs, ...args], {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        }),
      );

    const sql = (statement: string): string => run(["-q", "-t", "-A", "-c", statement]);

    const sqlAsync = async (statement: string): Promise<string> => {
      const { stdout } = await execFileAsync(
        psql,
        [...databaseArgs, "-q", "-t", "-A", "-c", statement],
        { encoding: "utf8" },
      );
      return tidy(stdout);
    };

    const attempt = async (statement: string): Promise<PostgresAttempt> => {
      try {
        await execFileAsync(
          psql,
          [...databaseArgs, ...VERBOSE, "-q", "-t", "-A", "-c", statement],
          { encoding: "utf8" },
        );
        return { ok: true, said: "" };
      } catch (error) {
        const said =
          typeof error === "object" && error !== null && "stderr" in error
            ? String((error as { stderr?: unknown }).stderr ?? "")
            : String(error);
        return { ok: false, said };
      }
    };

    const concurrentResults = (statements: readonly string[]): Promise<string[]> =>
      Promise.all(statements.map((statement) => sqlAsync(statement)));

    const concurrent = async (statements: readonly string[]): Promise<void> => {
      await concurrentResults(statements);
    };

    const expectRefusal = (statement: string): string => {
      try {
        run([...VERBOSE, "-q", "-t", "-A", "-c", statement]);
      } catch (error) {
        const shell = error as { stderr?: Buffer | string };
        return String(shell.stderr ?? error);
      }
      throw new Error(`PostgreSQL accepted a statement it had to refuse: ${statement}`);
    };

    const applyFile = (path: string): void => {
      run(["-f", path]);
    };

    const applyFileTransactional = (path: string): void => {
      run(["-1", "-f", path]);
    };

    const closedDataDir = dataDir;
    const stop = async (): Promise<void> => {
      try {
        stopHarnessCluster(closedDataDir);
        unregisterHarnessCluster(closedDataDir);
      } finally {
        // The slot is the host's budget, so it goes back even when the cluster
        // refused to die tidily.
        releaseSlotHold();
      }
    };

    return {
      psql,
      port,
      database,
      connectionArgs,
      databaseArgs,
      run,
      sql,
      sqlAsync,
      attempt,
      concurrent,
      concurrentResults,
      expectRefusal,
      applyFile,
      applyFileTransactional,
      stop,
    };
  } catch (error) {
    if (dataDir) {
      stopHarnessCluster(dataDir);
      unregisterHarnessCluster(dataDir);
    }
    releaseSlotHold();
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* The migrated cluster                                                */
/* ------------------------------------------------------------------ */

const SESSION_FIXTURE = join(process.cwd(), "scripts/rls/session-fixture.sql");
const MIGRATIONS = join(process.cwd(), "supabase/migrations");

/**
 * A cluster holding the Supabase stand-in (`scripts/rls/session-fixture.sql`)
 * and EVERY forward migration in production order, so a proof reads the
 * function bodies, grants and policies production holds today rather than a
 * hand-built shape.
 */
export async function startMigratedPostgres(
  options: StartPostgresOptions = {},
): Promise<PostgresSession> {
  const session = await startPostgres(options);
  try {
    session.applyFile(SESSION_FIXTURE);
    for (const name of readdirSync(MIGRATIONS)
      .filter((candidate) => candidate.endsWith(".sql"))
      .sort()) {
      session.applyFile(join(MIGRATIONS, name));
    }
    return session;
  } catch (error) {
    await session.stop();
    throw error;
  }
}

/**
 * One statement as `service_role`, the role the app's server client holds.
 * A proof's successful calls go through this rather than the harness
 * superuser, so a lost `service_role` grant fails the proof instead of
 * passing under a role production never uses.
 */
export function asServiceRole(statement: string): string {
  return `set role service_role; ${statement}`;
}

export type BrowserRole = "anon" | "authenticated";

/**
 * One statement as a browser role, the way PostgREST runs a call: the JWT
 * subject in `request.jwt.claim.sub` (null for anon) and the role switched
 * before the statement. Hand the result to `attempt` or `expectRefusal`.
 */
export function asBrowserRole(
  role: BrowserRole,
  sub: string | null,
  statement: string,
): string {
  const claim = (sub ?? "").replaceAll("'", "''");
  return `set request.jwt.claim.sub = '${claim}'; set role ${role}; ${statement}`;
}
