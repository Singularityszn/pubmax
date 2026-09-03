// Effective PostgreSQL proof for 0139 (#1292).
//
// The defect is not asserted here, it is REPRODUCED. On a real server holding
// migrations up to 0132, a stored 8 pound Community Price observed later than a
// 5 pound request makes public.create_one_tap_price_pair mint a Pint Drop
// reporting 8 pounds, while the 5 pound observation the drinker typed is never
// stored. 0139 then withdraws the function, and its rollback restores 0132's
// body faithfully, defect and all, which is what a rollback of a withdrawal has
// to mean.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20260903160000_0139_one_tap_price_pair_removal.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20260903160000_0139_one_tap_price_pair_removal_rollback.sql",
);
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

const SIGNATURE =
  "public.create_one_tap_price_pair(text,text,integer,text,text,timestamptz,uuid,text,text,text,text,text)";

const VENUE = "venue-one-tap-1292";
const ACTOR = "profile:00000000-0000-4000-8000-0000000000f1";
const HANDLE = "karan";
const EARLIER = "2026-09-03 18:00:00+00";
const LATER = "2026-09-03 20:00:00+00";
const STORED_PENNIES = 800;
const SUBMITTED_PENNIES = 500;

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
  if (process.env.PUBMAX_ONE_TAP_PAIR_NO_PG === "1") {
    return "PostgreSQL binaries were deliberately hidden by PUBMAX_ONE_TAP_PAIR_NO_PG=1.";
  }
  const missing = (["initdb", "postgres", "psql"] as const).filter(
    (name) => findPostgresBinary(name) === null,
  );
  return missing.length > 0
    ? `PostgreSQL 16 binaries unavailable for: ${missing.join(", ")}. Each binary must report major version 16 to run the 0139 withdrawal proof.`
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

  const dataDir = mkdtempSync(join(tmpdir(), "pubmax-one-tap-pair-0139-"));
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

    const database = "pubmax_one_tap_pair_0139";
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

// One drinker's own stored observation, made LATER than the request that
// follows it. This is the ordinary correction case the newer-wins upsert exists
// for, which is exactly why the pair function cannot tell it apart from a write.
function seedStoredNewerPrice(db: Session): void {
  db.sql(`
    truncate table public.pint_drops cascade;
    truncate table public.community_prices cascade;
    insert into public.community_prices
      (venue_id, drink_category, price_pennies, actor, contributor_handle, submitted_at)
    values
      ('${VENUE}', 'beer', ${STORED_PENNIES}, '${ACTOR}', '${HANDLE}', '${LATER}'::timestamptz);
  `);
}

// price_gbp is an unconstrained numeric, so read it at a fixed scale rather
// than comparing against whatever trailing zeros the server prints.
function dropPounds(db: Session, dropId: string): string {
  return db.sql(
    `select price_gbp::numeric(10,2)::text from public.pint_drops where id = '${dropId}'::uuid`,
  );
}

function callPair(db: Session, dropId: string): string {
  return db.sql(`select price_pennies from public.create_one_tap_price_pair(
    '${VENUE}',
    'beer',
    ${SUBMITTED_PENNIES},
    '${ACTOR}',
    '${HANDLE}',
    '${EARLIER}'::timestamptz,
    '${dropId}'::uuid,
    '${HANDLE}',
    'Pint',
    null,
    null,
    'authority-1292'
  )`);
}

beforeAll(async () => {
  skipReason = missingPostgresReason();
  if (skipReason) {
    console.error(
      [
        "",
        "0139 ONE-TAP PRICE PAIR WITHDRAWAL EFFECTIVE TESTS SKIPPED - THIS IS NOT A PASS",
        `Reason: ${skipReason}`,
        "The #1292 wrong-price reproduction, the withdrawal, and the rollback restore were all left unexercised.",
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

describe("0139 on PostgreSQL", () => {
  it("reproduces the #1292 drop at a price nobody submitted, then withdraws it", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();
    seedStoredNewerPrice(db);

    const dropId = "00000000-0000-4000-8000-0000000000e1";
    // The function answers with the KEPT row's pennies, not the request's.
    expect(callPair(db, dropId)).toBe(String(STORED_PENNIES));
    // The drinker's 5 pound observation reached no table.
    expect(
      db.sql(
        `select count(*)::text from public.community_prices where venue_id = '${VENUE}' and price_pennies = ${SUBMITTED_PENNIES}`,
      ),
    ).toBe("0");
    // And the Pint Drop reports 8 pounds, which nobody submitted, rather than
    // the 5 pounds that was sent. That is the defect, on a real server, before
    // anything of ours runs.
    expect(dropPounds(db, dropId)).toBe("8.00");
    expect(dropPounds(db, dropId)).not.toBe("5.00");

    db.applyFile(FORWARD);

    expect(db.sql(`select coalesce(to_regprocedure('${SIGNATURE}')::text, 'gone')`)).toBe(
      "gone",
    );
    expect(() => callPair(db, "00000000-0000-4000-8000-0000000000e2")).toThrow();
    // The withdrawal takes the function and nothing else: the drop already
    // written stays, because no column tells a pair-written row from a
    // two-phase one and removing a drinker's Pint Drop on a guess is worse.
    expect(db.sql(`select count(*)::text from public.pint_drops where venue_id = '${VENUE}'`)).toBe(
      "1",
    );
    expect(
      db.sql(
        `select price_pennies::text from public.community_prices where venue_id = '${VENUE}'`,
      ),
    ).toBe(String(STORED_PENNIES));
  }, 300_000);

  it("restores 0132's function, grants and defect on rollback", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();

    db.applyFile(ROLLBACK);

    expect(db.sql(`select coalesce(to_regprocedure('${SIGNATURE}')::text, 'gone')`)).not.toBe(
      "gone",
    );
    expect(
      db.sql(
        `select has_function_privilege('anon', '${SIGNATURE}', 'execute')::text || '|' || has_function_privilege('authenticated', '${SIGNATURE}', 'execute')::text || '|' || has_function_privilege('service_role', '${SIGNATURE}', 'execute')::text`,
      ),
    ).toBe("false|false|true");

    // Faithful means the old behaviour comes back with the old body. A rollback
    // that quietly shipped a repaired function would be a second live change
    // wearing a rollback's name.
    seedStoredNewerPrice(db);
    const dropId = "00000000-0000-4000-8000-0000000000e3";
    expect(callPair(db, dropId)).toBe(String(STORED_PENNIES));
    expect(dropPounds(db, dropId)).toBe("8.00");
  }, 300_000);
});
