// Effective PostgreSQL proof for 0147 (contribution battle test D04).
//
// The claim under test is not "the SQL parses". It is that a real server
// holding every migration before this one CANNOT TELL a half from a pint, that
// 0147 applies cleanly over the exact rows the finding left behind, that its
// backfill FLAGS those rows and SCALES NOTHING, that the closed set and the
// label rule are enforced by the table rather than only by the app, and that
// the rollback gives the columns back without touching a drinker's price.
//
// The fixture is the report's own row: Arnos Arms, "Half of lager" at £2.60,
// confirmed by a second reporter and therefore feeding pin colour, the
// cheapest-pint buckets and the Pint Index at a pub whose pint is £5.50.
//
// Every timestamp is a literal, for the reason 0141's proof gives: a test that
// leaned on the wall clock would be a different test at 00:30 than at noon.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NON_PINT_MEASURE_PATTERNS } from "@/lib/drinkMeasure";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20260905170000_0147_pint_drop_measure.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20260905170000_0147_pint_drop_measure_rollback.sql",
);
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

type Session = {
  sql: (statement: string) => string;
  attempt: (statement: string) => { ok: boolean; said: string };
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
  if (process.env.PUBMAX_PINT_DROP_MEASURE_NO_PG === "1") {
    return "PostgreSQL binaries were deliberately hidden by PUBMAX_PINT_DROP_MEASURE_NO_PG=1.";
  }
  const missing = (["initdb", "postgres", "psql"] as const).filter(
    (name) => findPostgresBinary(name) === null,
  );
  return missing.length > 0
    ? `PostgreSQL 16 binaries unavailable for: ${missing.join(", ")}. Each binary must report major version 16 to run the 0147 measure proof.`
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

  const dataDir = mkdtempSync(join(tmpdir(), "pubmax-measure-0147-"));
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

    const database = "pubmax_pint_drop_measure_0147";
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

    // An outcome instead of a throw, so a REFUSAL can be asserted on by name.
    const attempt = (statement: string): { ok: boolean; said: string } => {
      try {
        execFileSync(psql, [...databaseArgs, "-v", "VERBOSITY=verbose", "-c", statement], {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        return { ok: true, said: "" };
      } catch (error) {
        const said =
          typeof error === "object" && error !== null && "stderr" in error
            ? String((error as { stderr?: unknown }).stderr ?? "")
            : String(error);
        return { ok: false, said };
      }
    };

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

    return { sql, attempt, applyFile, stop };
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

// The report's own rows. Two accounts at one pub, agreeing on £2.60 for a HALF,
// which is what minted the confirmation the Index would have cited.
const VENUE = "venue-xjf3n0";
const CONFIRMATION = "1d334c69-0000-4000-8000-000000000001";
const AT = "2026-09-05 14:05:57+01";

function dropId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

/** One priced drop, every column named, so each fixture row reads the same. */
function insertPriced(options: {
  id: string;
  handle: string;
  drink: string;
  price: string;
  authority: string;
  confirmed?: boolean;
}): string {
  const columns = [
    "id",
    "venue_id",
    "handle",
    "drink",
    "price_gbp",
    "passed_down_note",
    "era",
    "provenance",
    "status",
    "authority_key",
    "created_at",
    ...(options.confirmed
      ? ["confirmation_id", "confirmed_at", "confirmation_basis"]
      : []),
  ];
  const values = [
    `'${options.id}'::uuid`,
    `'${VENUE}'`,
    `'${options.handle}'`,
    `'${options.drink}'`,
    options.price,
    "''",
    "''",
    "'contributor'",
    "'visible'",
    `'${options.authority}'`,
    `timestamptz '${AT}'`,
    ...(options.confirmed
      ? [`'${CONFIRMATION}'::uuid`, `timestamptz '${AT}'`, "'second_reporter'"]
      : []),
  ];
  return `insert into public.pint_drops (${columns.join(", ")}) values (${values.join(", ")});`;
}

beforeAll(async () => {
  skipReason = missingPostgresReason();
  if (skipReason) {
    console.error(
      [
        "",
        "0147 PINT DROP MEASURE EFFECTIVE TESTS SKIPPED - THIS IS NOT A PASS",
        `Reason: ${skipReason}`,
        "Nothing proved that the column applies over the rows the finding left, that the backfill flags without scaling, or that the rollback keeps every price.",
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

describe("0147 on PostgreSQL", () => {
  it("cannot tell a half from a pint before the migration", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();

    expect(
      db.sql(
        "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'pint_drops' and column_name in ('measure', 'measure_label')",
      ),
    ).toBe("0");

    // The report's pair, written exactly as the preview stored it: alice says
    // "Half of lager", bob's confirming row carries no drink text at all, and
    // both share one confirmation id.
    db.sql(
      insertPriced({
        id: dropId(1),
        handle: "alicepent",
        drink: "Half of lager",
        price: "2.60",
        authority: "pubmax:xjf3n0:alice",
        confirmed: true,
      }),
    );
    db.sql(
      insertPriced({
        id: dropId(2),
        handle: "bobpent",
        drink: "",
        price: "2.60",
        authority: "pubmax:xjf3n0:bob",
        confirmed: true,
      }),
    );
    // A real pint at the same pub, so the backfill has something it must LEAVE.
    db.sql(
      insertPriced({
        id: dropId(3),
        handle: "carolpent",
        drink: "Pint of Guinness",
        price: "5.50",
        authority: "pubmax:xjf3n0:carol",
      }),
    );
    // The word-boundary case, which a naive LIKE '%half%' would flag wrongly.
    db.sql(
      insertPriced({
        id: dropId(4),
        handle: "davepent",
        drink: "Halfway House Pale",
        price: "5.20",
        authority: "pubmax:xjf3n0:dave",
      }),
    );

    // Nothing on the table separates them: four priced rows, one lane.
    expect(db.sql(`select count(*) from public.pint_drops where venue_id = '${VENUE}'`)).toBe(
      "4",
    );
  });

  it("applies over those rows and flags the half without scaling it", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();

    db.applyFile(FORWARD);

    expect(
      db.sql(`select measure from public.pint_drops where id = '${dropId(1)}'::uuid`),
    ).toBe("half");

    // THE POINT OF THE WHOLE MIGRATION: the figure is untouched. A flag is not
    // a correction, and £2.60 stays £2.60 rather than becoming £5.20.
    expect(
      db.sql(`select price_gbp from public.pint_drops where id = '${dropId(1)}'::uuid`),
    ).toBe("2.60");

    // The row keeps its confirmation, its author and its night. It stops
    // answering the pint lane; nothing about it is erased.
    expect(
      db.sql(
        `select confirmation_id is not null and confirmation_basis = 'second_reporter' from public.pint_drops where id = '${dropId(1)}'::uuid`,
      ),
    ).toBe("t");

    // The confirming row said nothing about a measure, so it stays a pint here.
    // That is honest and it is also harmless: lib/pintDropConfirmation.ts needs
    // BOTH sides of a pair to be pints, so the pair confirms nothing either way.
    expect(
      db.sql(`select measure from public.pint_drops where id = '${dropId(2)}'::uuid`),
    ).toBe("pint");

    // A real pint is left alone, and so is the word-boundary case.
    expect(
      db.sql(`select measure from public.pint_drops where id = '${dropId(3)}'::uuid`),
    ).toBe("pint");
    expect(
      db.sql(`select measure from public.pint_drops where id = '${dropId(4)}'::uuid`),
    ).toBe("pint");
  });

  it("flags every other non-pint word the owner module names", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();

    // The SQL backfill is a COPY of NON_PINT_MEASURE_PATTERNS. Rather than
    // restate the list here, drive it from the owner and re-run the same two
    // statements the migration runs, so a word added to the module without
    // being added to the SQL fails on the word itself.
    let index = 100;
    for (const entry of NON_PINT_MEASURE_PATTERNS) {
      index += 1;
      db.sql(
        insertPriced({
          id: dropId(index),
          handle: `word${index}`,
          drink: `${entry.word} of lager`,
          price: "3.10",
          authority: `pubmax:xjf3n0:word${index}`,
        }),
      );
    }

    db.sql(
      "update public.pint_drops set measure = 'half' where measure = 'pint' and drink is not null and (drink ~* '\\mhalf\\M' or drink ~* '\\mhalves\\M' or drink ~* '(^|\\s)1/2(\\s|$)' or drink ~* '(^|\\s)½(\\s|$)')",
    );
    db.sql(
      "update public.pint_drops set measure = 'other' where measure = 'pint' and drink is not null and (drink ~* '\\msmall\\M' or drink ~* '\\mschooner\\M' or drink ~* '\\mthird\\M' or drink ~* '\\mthirds\\M' or drink ~* '(^|\\s)1/3(\\s|$)' or drink ~* '(^|\\s)⅓(\\s|$)' or drink ~* '(^|\\s)2/3(\\s|$)' or drink ~* '(^|\\s)⅔(\\s|$)')",
    );

    let checked = 100;
    for (const entry of NON_PINT_MEASURE_PATTERNS) {
      checked += 1;
      expect(
        db.sql(`select measure from public.pint_drops where id = '${dropId(checked)}'::uuid`),
        `"${entry.word} of lager" must be flagged as ${entry.measure}`,
      ).toBe(entry.measure);
    }
  });

  it("refuses a measure outside the closed set, and a label beside a pint", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();

    const unknown = db.attempt(
      `update public.pint_drops set measure = 'yard' where id = '${dropId(3)}'::uuid`,
    );
    expect(unknown.ok).toBe(false);
    expect(unknown.said).toContain("pint_drops_measure_known");

    const strayLabel = db.attempt(
      `update public.pint_drops set measure_label = 'schooner' where id = '${dropId(3)}'::uuid`,
    );
    expect(strayLabel.ok).toBe(false);
    expect(strayLabel.said).toContain("pint_drops_measure_label_only_on_other");

    // The label is welcome where it belongs.
    expect(
      db.attempt(
        `update public.pint_drops set measure = 'other', measure_label = 'schooner' where id = '${dropId(3)}'::uuid`,
      ).ok,
    ).toBe(true);
    db.sql(
      `update public.pint_drops set measure = 'pint', measure_label = null where id = '${dropId(3)}'::uuid`,
    );
  });

  it("gives the columns back on rollback and keeps every drinker's price", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();

    const before = db.sql(
      `select count(*) || ':' || coalesce(sum(price_gbp)::text, '0') from public.pint_drops where venue_id = '${VENUE}'`,
    );

    db.applyFile(ROLLBACK);

    expect(
      db.sql(
        "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'pint_drops' and column_name in ('measure', 'measure_label')",
      ),
    ).toBe("0");

    // Every row, and every figure on it, survives the rollback untouched.
    expect(
      db.sql(
        `select count(*) || ':' || coalesce(sum(price_gbp)::text, '0') from public.pint_drops where venue_id = '${VENUE}'`,
      ),
    ).toBe(before);

    // And the migration is re-appliable over the rolled-back table, which is
    // what makes the rollback a real escape hatch rather than a one-way door.
    db.applyFile(FORWARD);
    expect(
      db.sql(`select measure from public.pint_drops where id = '${dropId(1)}'::uuid`),
    ).toBe("half");
  });
});
