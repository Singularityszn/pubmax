// Effective PostgreSQL proof for 0141 (pentest F-1).
//
// The claim under test is not "the SQL parses". It is that a real server holding
// every migration before this one LETS A CONCURRENT BURST WALK THROUGH the
// "one price per pub per day" cap, that 0141 applies cleanly OVER the rows such
// a burst already left behind, that the same burst afterwards lands exactly one
// price and refuses the rest, that the guard is the app's rule and no wider,
// and that the rollback takes the guard while leaving every drinker's Pint Drop
// where it was.
//
// Every timestamp here is a literal. The cap is a LONDON day, so a test that
// leaned on the wall clock would be a different test at 00:30 than at noon, and
// the one bug this file exists to keep out is a day bucket that disagrees with
// itself. 2026-09-04 is inside BST (UTC+1), which is also what makes the
// boundary case below worth writing down.

import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

/** psql prints the five-character SQLSTATE only under verbose error reporting. */
const VERBOSE = ["-v", "VERBOSITY=verbose"] as const;

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20260904100000_0141_pint_drop_daily_price_cap.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20260904100000_0141_pint_drop_daily_price_cap_rollback.sql",
);
const SESSION_FIXTURE = join(ROOT, "scripts/rls/session-fixture.sql");
const PREREQUISITES = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith(".sql") && name < FORWARD_NAME)
  .sort()
  .map((name) => join(MIGRATIONS, name));

type Attempt = { ok: boolean; said: string };

type Session = {
  sql: (statement: string) => string;
  attempt: (statement: string) => Promise<Attempt>;
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
  if (process.env.PUBMAX_PINT_DROP_DAILY_CAP_NO_PG === "1") {
    return "PostgreSQL binaries were deliberately hidden by PUBMAX_PINT_DROP_DAILY_CAP_NO_PG=1.";
  }
  const missing = (["initdb", "postgres", "psql"] as const).filter(
    (name) => findPostgresBinary(name) === null,
  );
  return missing.length > 0
    ? `PostgreSQL 16 binaries unavailable for: ${missing.join(", ")}. Each binary must report major version 16 to run the 0141 daily-cap proof.`
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

  const dataDir = mkdtempSync(join(tmpdir(), "pubmax-daily-cap-0141-"));
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
        // The burst below opens one connection per racing writer, so this has
        // to clear BURST_SIZE with room for the synchronous session beside it.
        "max_connections = 24",
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

    const database = "pubmax_pint_drop_daily_cap_0141";
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

    // One statement, its OWN connection, and an outcome instead of a throw:
    // this is what lets several writers be in flight at once. Verbose, because
    // psql prints the SQLSTATE only when asked, and a refusal that cannot be
    // named by code is a refusal this test cannot tell from any other.
    const attempt = async (statement: string): Promise<Attempt> => {
      try {
        await execFileAsync(psql, [...databaseArgs, ...VERBOSE, "-c", statement], {
          encoding: "utf8",
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

// The account that walked through the cap in the report, and the two pubs: one
// for the burst BEFORE the guard, one for the burst AFTER it.
const HANDLE = "alicepent";
const VENUE_BEFORE = "venue-cap-before";
const VENUE_AFTER = "venue-cap-after";
// The report's bounded-impact claim in one value: every row of a burst carries
// ONE authority key, which is why six drops still corroborate nothing.
const AUTHORITY = "pubmax:venue-cap:alicepent";
const BURST_SIZE = 8;
// A London day inside BST, so the boundary case below has something to say.
const LONDON_DAY = "2026-09-04";
const NOON_BST = "2026-09-04 12:00:00+01";

function dropId(tag: string, index: number): string {
  return `00000000-0000-4000-8000-${tag}${String(index).padStart(10, "0")}`;
}

/** One priced drop, every column named, so a burst row and a plain row agree. */
function insertPriced(options: {
  id: string;
  venueId: string;
  handle: string;
  price: string;
  createdAt: string;
  priceDay: string | null;
  status?: string;
  withPriceDay: boolean;
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
    ...(options.withPriceDay ? ["price_day"] : []),
  ];
  const values = [
    `'${options.id}'::uuid`,
    `'${options.venueId}'`,
    `'${options.handle}'`,
    "'Pint'",
    options.price,
    "''",
    "''",
    "'contributor'",
    `'${options.status ?? "visible"}'`,
    `'${AUTHORITY}'`,
    `timestamptz '${options.createdAt}'`,
    ...(options.withPriceDay
      ? [options.priceDay === null ? "null" : `date '${options.priceDay}'`]
      : []),
  ];
  return `insert into public.pint_drops (${columns.join(", ")}) values (${values.join(", ")});`;
}

/**
 * BURST_SIZE writers, all released at ONE wall-clock instant. Each holds its own
 * connection and waits on pg_sleep_until, so they are past connect and parse
 * before any of them reaches the insert: this is the concurrent window the
 * check-then-insert could not see, not a loop dressed up as one.
 */
async function burst(db: Session, statements: readonly string[]): Promise<Attempt[]> {
  const fireAt = new Date(Date.now() + 3_000).toISOString();
  return Promise.all(
    statements.map((statement) =>
      db.attempt(`select pg_sleep_until(timestamptz '${fireAt}'); ${statement}`),
    ),
  );
}

function pricedBurst(venueId: string, tag: string, withPriceDay: boolean): string[] {
  return Array.from({ length: BURST_SIZE }, (_unused, index) =>
    insertPriced({
      id: dropId(tag, index),
      venueId,
      handle: HANDLE,
      // Distinct prices, so a row that lands can be named. All well inside the
      // table's own £1..£20 floor and ceiling.
      price: (4.05 + index * 0.01).toFixed(2),
      // Distinct, ordered instants inside ONE London day, so "the earliest row
      // in the bucket" is a fact rather than a tie.
      createdAt: `2026-09-04 ${12 + index}:00:00+01`,
      priceDay: LONDON_DAY,
      withPriceDay,
    }),
  );
}

beforeAll(async () => {
  skipReason = missingPostgresReason();
  if (skipReason) {
    console.error(
      [
        "",
        "0141 DAILY PRICE CAP EFFECTIVE TESTS SKIPPED - THIS IS NOT A PASS",
        `Reason: ${skipReason}`,
        "Nothing proved that the concurrent burst is refused, that the migration applies over the rows the finding left, or that the rollback keeps the drops.",
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

describe("0141 on PostgreSQL", () => {
  it("lets a concurrent burst walk through the daily cap before the migration", async (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();

    // Nothing underneath the rule: the primary key is the table's only
    // uniqueness, which is exactly why the check-then-insert was the whole
    // enforcement.
    expect(
      db.sql(
        "select count(*)::text from pg_indexes where schemaname = 'public' and indexname = 'pint_drops_priced_day_unique_idx'",
      ),
    ).toBe("0");

    const results = await burst(db, pricedBurst(VENUE_BEFORE, "b0", false));
    expect(results.filter((result) => !result.ok)).toEqual([]);

    // The finding, on a real server: one account, one pub, one London day,
    // eight priced observations.
    expect(
      db.sql(
        `select count(*)::text from public.pint_drops where venue_id = '${VENUE_BEFORE}' and handle = '${HANDLE}' and price_gbp is not null`,
      ),
    ).toBe(String(BURST_SIZE));
    // And why the report called the impact bounded: all eight carry ONE
    // authority key, and corroboration needs two distinct ones.
    expect(
      db.sql(
        `select count(distinct authority_key)::text from public.pint_drops where venue_id = '${VENUE_BEFORE}'`,
      ),
    ).toBe("1");
  }, 300_000);

  it("applies over the rows that burst left, claiming the first of each bucket", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();

    // The migration has to survive the very rows the finding is about. A naive
    // backfill would make the unique index fail to build over these eight and
    // take the whole migration down with it.
    db.applyFile(FORWARD);

    expect(
      db.sql(
        "select count(*)::text from pg_indexes where schemaname = 'public' and indexname = 'pint_drops_priced_day_unique_idx'",
      ),
    ).toBe("1");
    // Exactly one row per bucket is claimed, and it is the earliest: the
    // observation the cap always meant to keep.
    expect(
      db.sql(
        `select count(*)::text from public.pint_drops where venue_id = '${VENUE_BEFORE}' and price_day is not null`,
      ),
    ).toBe("1");
    expect(
      db.sql(
        `select price_gbp::numeric(10,2)::text from public.pint_drops where venue_id = '${VENUE_BEFORE}' and price_day is not null`,
      ),
    ).toBe("4.05");
    // The backfill reads the London day the WRITER stamps. If those two ever
    // drift, the guard is enforcing a different rule from the pre-check.
    expect(
      db.sql(
        `select price_day::text from public.pint_drops where venue_id = '${VENUE_BEFORE}' and price_day is not null`,
      ),
    ).toBe(LONDON_DAY);
    // Nobody's Pint Drop was deleted to make the index buildable.
    expect(
      db.sql(`select count(*)::text from public.pint_drops where venue_id = '${VENUE_BEFORE}'`),
    ).toBe(String(BURST_SIZE));
  }, 300_000);

  it("lands exactly one price when the same burst arrives after the migration", async (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();

    const results = await burst(db, pricedBurst(VENUE_AFTER, "a0", true));
    const landed = results.filter((result) => result.ok);
    const refused = results.filter((result) => !result.ok);

    expect(landed).toHaveLength(1);
    expect(refused).toHaveLength(BURST_SIZE - 1);
    // Refused by THIS rule, named, rather than by any other collision.
    for (const result of refused) {
      expect(result.said).toContain("23505");
      expect(result.said).toContain("pint_drops_priced_day_unique_idx");
    }
    expect(
      db.sql(
        `select count(*)::text from public.pint_drops where venue_id = '${VENUE_AFTER}' and handle = '${HANDLE}' and price_gbp is not null`,
      ),
    ).toBe("1");
  }, 300_000);

  it("guards the app's rule and no more of it", async (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();

    // Another drinker at the same pub on the same day is a SECOND opinion, and
    // the second opinion is the whole point of the price model.
    expect(
      (
        await db.attempt(
          insertPriced({
            id: dropId("c0", 1),
            venueId: VENUE_AFTER,
            handle: "bobpent",
            price: "4.60",
            createdAt: NOON_BST,
            priceDay: LONDON_DAY,
            withPriceDay: true,
          }),
        )
      ).ok,
    ).toBe(true);

    // The same drinker at a different pub, and at the same pub on another day.
    expect(
      (
        await db.attempt(
          insertPriced({
            id: dropId("c0", 2),
            venueId: "venue-cap-elsewhere",
            handle: HANDLE,
            price: "4.70",
            createdAt: NOON_BST,
            priceDay: LONDON_DAY,
            withPriceDay: true,
          }),
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await db.attempt(
          insertPriced({
            id: dropId("c0", 3),
            venueId: VENUE_AFTER,
            handle: HANDLE,
            price: "4.80",
            createdAt: "2026-09-05 12:00:00+01",
            priceDay: "2026-09-05",
            withPriceDay: true,
          }),
        )
      ).ok,
    ).toBe(true);

    // A note-only memory is not a price observation and is not capped, however
    // many of them one drinker leaves.
    for (const index of [4, 5]) {
      db.sql(
        `insert into public.pint_drops (id, venue_id, handle, drink, price_gbp, passed_down_note, era, provenance, status, created_at) values ('${dropId("c0", index)}'::uuid, '${VENUE_AFTER}', '${HANDLE}', '', null, 'Granddad drank here', '1970s', 'contributor', 'visible', timestamptz '${NOON_BST}')`,
      );
    }
    expect(
      db.sql(
        `select count(*)::text from public.pint_drops where venue_id = '${VENUE_AFTER}' and handle = '${HANDLE}' and price_gbp is null`,
      ),
    ).toBe("2");

    // A moderator hiding a drop takes it off every price surface, and
    // hasPricedDropToday stops counting it, so the drinker may log again. The
    // index has to read the rule the same way.
    db.sql(
      `update public.pint_drops set status = 'hidden' where venue_id = '${VENUE_AFTER}' and handle = '${HANDLE}' and price_gbp is not null and price_day = date '${LONDON_DAY}'`,
    );
    expect(
      (
        await db.attempt(
          insertPriced({
            id: dropId("c0", 6),
            venueId: VENUE_AFTER,
            handle: HANDLE,
            price: "4.90",
            createdAt: NOON_BST,
            priceDay: LONDON_DAY,
            withPriceDay: true,
          }),
        )
      ).ok,
    ).toBe(true);
  }, 300_000);

  it("buckets by the London day, which is why it is not the UTC one", async (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();

    // 22:30 and 23:30 UTC on 2026-09-04 are ONE UTC day and TWO London days,
    // because BST is UTC+1. A UTC-day index would have refused the second of
    // these, which is a legitimate drop on a new London night.
    const boundary = [
      { index: 1, at: "2026-09-04 22:30:00+00", day: "2026-09-04" },
      { index: 2, at: "2026-09-04 23:30:00+00", day: "2026-09-05" },
    ];
    for (const row of boundary) {
      expect(
        (
          await db.attempt(
            insertPriced({
              id: dropId("d0", row.index),
              venueId: "venue-cap-boundary",
              handle: HANDLE,
              price: "5.10",
              createdAt: row.at,
              priceDay: row.day,
              withPriceDay: true,
            }),
          )
        ).ok,
      ).toBe(true);
    }
    // The day each row claims is the day Postgres reads out of its own
    // timestamp, so the writer's stamp and the server agree.
    expect(
      db.sql(
        "select string_agg(price_day::text, ',' order by created_at) from public.pint_drops where venue_id = 'venue-cap-boundary'",
      ),
    ).toBe("2026-09-04,2026-09-05");
    expect(
      db.sql(
        "select string_agg(((created_at at time zone 'Europe/London')::date)::text, ',' order by created_at) from public.pint_drops where venue_id = 'venue-cap-boundary'",
      ),
    ).toBe("2026-09-04,2026-09-05");
  }, 300_000);

  it("takes the guard and no drinker's Pint Drop on rollback", (context) => {
    if (skipReason) context.skip(true, skipReason);
    const db = requireDatabase();
    const before = db.sql("select count(*)::text from public.pint_drops");

    db.applyFile(ROLLBACK);

    expect(
      db.sql(
        "select count(*)::text from pg_indexes where schemaname = 'public' and indexname = 'pint_drops_priced_day_unique_idx'",
      ),
    ).toBe("0");
    expect(
      db.sql(
        "select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'pint_drops' and column_name = 'price_day'",
      ),
    ).toBe("0");
    // The stamp is derived; a drinker's price, day and author are not.
    expect(db.sql("select count(*)::text from public.pint_drops")).toBe(before);
    expect(
      db.sql(
        `select string_agg(price_gbp::numeric(10,2)::text, ',' order by created_at) from public.pint_drops where venue_id = '${VENUE_BEFORE}'`,
      ),
    ).toBe("4.05,4.06,4.07,4.08,4.09,4.10,4.11,4.12");
  }, 300_000);
});
