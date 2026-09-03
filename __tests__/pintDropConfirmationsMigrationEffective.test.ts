// Effective PostgreSQL proof for 0140 (#1354).
//
// The claim under test is not "the SQL parses". It is that a real server holding
// every migration before this one CANNOT record a confirmation at all, that
// 0140 makes one recordable, that a HALF-WRITTEN confirmation is refused rather
// than stored as evidence nobody can look up, and that the rollback takes the
// columns while leaving every drinker's Pint Drop where it was.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20260903170000_0140_pint_drop_confirmations.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20260903170000_0140_pint_drop_confirmations_rollback.sql",
);
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

type Session = {
  sql: (statement: string) => string;
  applyFile: (path: string) => void;
  stop: () => Promise<void>;
};

async function waitForExit(
  processHandle: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<void> {
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
  if (process.env.PUBMAX_PINT_DROP_CONFIRMATION_NO_PG === "1") {
    return "PostgreSQL binaries were deliberately hidden by PUBMAX_PINT_DROP_CONFIRMATION_NO_PG=1.";
  }
  const missing = (["initdb", "postgres", "psql"] as const).filter(
    (name) => findPostgresBinary(name) === null,
  );
  return missing.length > 0
    ? `PostgreSQL 16 binaries unavailable for: ${missing.join(", ")}. Each binary must report major version 16 to run the 0140 confirmation proof.`
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

  const dataDir = mkdtempSync(join(tmpdir(), "pubmax-confirm-0140-"));
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

    const database = "pubmax_pint_drop_confirmation_0140";
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

const VENUE = "venue-confirm-1354";
const DROP_A = "00000000-0000-4000-8000-0000000000c1";
const DROP_B = "00000000-0000-4000-8000-0000000000c2";
const CONFIRMATION = "00000000-0000-4000-8000-0000000000cf";

function seedPair(db: Session): void {
  db.sql(`
    delete from public.pint_drops where venue_id = '${VENUE}';
    insert into public.pint_drops
      (id, venue_id, handle, drink, price_gbp, passed_down_note, era, provenance, status, created_at)
    values
      ('${DROP_A}'::uuid, '${VENUE}', 'karan', 'Pint', 4.20, '', '', 'contributor', 'visible', now()),
      ('${DROP_B}'::uuid, '${VENUE}', 'sam', 'Pint', 4.50, '', '', 'contributor', 'visible', now());
  `);
}

function confirmPair(db: Session, basis: string, peer: string | null): void {
  db.sql(`
    update public.pint_drops
       set confirmation_id = '${CONFIRMATION}'::uuid,
           confirmed_at = now(),
           confirmation_basis = '${basis}',
           confirming_drop_id = ${peer === null ? "null" : `'${peer}'::uuid`}
     where id in ('${DROP_A}'::uuid, '${DROP_B}'::uuid);
  `);
}

beforeAll(async () => {
  skipReason = missingPostgresReason();
  if (skipReason) {
    console.error(
      [
        "",
        "0140 PINT DROP CONFIRMATION EFFECTIVE TESTS SKIPPED - THIS IS NOT A PASS",
        `Reason: ${skipReason}`,
        "Nothing proved that a confirmation is recordable, that a half-written one is refused, or that the rollback keeps the drops.",
        "",
      ].join("\n"),
    );
    return;
  }
  try {
    database = await startPostgres();
    database.applyFile(SESSION_FIXTURE);
    for (const path of PREREQUISITES) database.applyFile(path);
  } catch (error) {
    if (database) await database.stop();
    database = null;
    throw error;
  }
}, 600_000);

afterAll(async () => {
  if (database) await database.stop();
  database = null;
});

describe("0140 on PostgreSQL", () => {
  it("cannot record a confirmation before the migration, and can after it", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();
    seedPair(db);

    // The gap the London scout reported, on a real server: there is nowhere to
    // put a confirmation, so green is unreachable however the app is written.
    expect(
      db.sql(
        "select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'pint_drops' and column_name = 'confirmation_id'",
      ),
    ).toBe("0");
    expect(() => confirmPair(db, "second_reporter", DROP_B)).toThrow();

    db.applyFile(FORWARD);

    confirmPair(db, "second_reporter", DROP_B);
    // ONE agreement between two reporters is ONE event, so both rows answer the
    // same citation.
    expect(
      db.sql(
        `select count(distinct confirmation_id)::text from public.pint_drops where venue_id = '${VENUE}' and confirmation_id is not null`,
      ),
    ).toBe("1");
    expect(
      db.sql(
        `select count(*)::text from public.pint_drops where venue_id = '${VENUE}' and confirmation_id is not null`,
      ),
    ).toBe("2");
    // The read the trust standing and the Index producer both make.
    expect(
      db.sql(
        "select count(*)::text from pg_indexes where schemaname = 'public' and indexname = 'pint_drops_confirmed_venue_idx'",
      ),
    ).toBe("1");
  }, 300_000);

  it("refuses a confirmation that could not answer the citation it invites", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();
    seedPair(db);

    // An id with no date and no basis is not evidence: the Index cites the id
    // and then has nothing to say about when, or on what grounds.
    expect(() =>
      db.sql(
        `update public.pint_drops set confirmation_id = '${CONFIRMATION}'::uuid where id = '${DROP_A}'::uuid`,
      ),
    ).toThrow();
    // A basis nobody defined is the same problem wearing a word.
    expect(() => confirmPair(db, "vibes", DROP_B)).toThrow();
    // A moderator confirmation is one person's decision and names no peer, so a
    // peer id on that basis would be a claim nobody made.
    expect(() => confirmPair(db, "moderator", DROP_B)).toThrow();
    confirmPair(db, "moderator", null);
    expect(
      db.sql(
        `select count(*)::text from public.pint_drops where venue_id = '${VENUE}' and confirmation_basis = 'moderator' and confirming_drop_id is null`,
      ),
    ).toBe("2");
  }, 300_000);

  it("takes the confirmation and no drinker's Pint Drop on rollback", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();
    seedPair(db);
    confirmPair(db, "second_reporter", DROP_B);

    db.applyFile(ROLLBACK);

    expect(
      db.sql(
        "select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'pint_drops' and column_name in ('confirmation_id','confirmed_at','confirmation_basis','confirming_drop_id')",
      ),
    ).toBe("0");
    expect(
      db.sql(
        "select count(*)::text from pg_indexes where schemaname = 'public' and indexname = 'pint_drops_confirmed_venue_idx'",
      ),
    ).toBe("0");
    // Every price, date and author survives. A confirmation is evidence we
    // derived; a Pint Drop is a drinker's own account, and a rollback of ours
    // may not cost them one.
    expect(
      db.sql(
        `select string_agg(price_gbp::numeric(10,2)::text, ',' order by handle) from public.pint_drops where venue_id = '${VENUE}'`,
      ),
    ).toBe("4.20,4.50");
  }, 300_000);
});
