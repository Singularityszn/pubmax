import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  postgresSkipReason,
  startPostgres,
  type PostgresSession,
} from "./helpers/postgres";

const skipReason = postgresSkipReason();

let database: PostgresSession | null = null;

function spawnPsql(db: PostgresSession, sql: string): ChildProcess {
  return spawn(
    db.psql,
    [...db.databaseArgs, "-v", "ON_ERROR_STOP=1", "-c", sql],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
}

async function waitForSleep(db: PostgresSession, needle: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const row = await db.sqlAsync(
      `select coalesce(wait_event, '') from pg_stat_activity
       where query like '%${needle}%' and pid <> pg_backend_pid()`,
    );
    if (row.includes("PgSleep")) return;
    await sleep(50);
  }
  throw new Error(`the holder never reached pg_sleep (${needle})`);
}

beforeAll(async () => {
  if (skipReason) return;
  database = await startPostgres({ label: "pg-timeouts" });
  database.sql(`
    create table public.hang_probe(id int primary key, n int);
    insert into public.hang_probe(id, n) values (1, 0);
  `);
});

afterAll(async () => {
  await database?.stop();
});

describe.skipIf(skipReason !== null)("postgres harness fail-fast ceilings", () => {
  it("sets lock, statement, and idle-in-transaction ceilings", () => {
    const db = database!;
    // current_setting pretty-prints 60s as 1min. pg_settings keeps the raw milliseconds.
    expect(db.sql(`select string_agg(name || '=' || setting || unit, '|' order by name)
      from pg_settings
      where name in (
        'idle_in_transaction_session_timeout',
        'lock_timeout',
        'statement_timeout'
      )`))
      .toBe("idle_in_transaction_session_timeout=15000ms|lock_timeout=15000ms|statement_timeout=60000ms");
  });

  it("cancels an UPDATE waiting on an open transaction", async () => {
    const db = database!;
    const holder = spawnPsql(
      db,
      "begin; update public.hang_probe set n = 1 where id = 1; select pg_sleep(45); commit;",
    );
    try {
      await waitForSleep(db, "pg_sleep(45)");
      const started = Date.now();
      const attempt = await db.attempt("update public.hang_probe set n = 2 where id = 1");
      const elapsed = Date.now() - started;
      expect(attempt.ok).toBe(false);
      expect(attempt.said).toMatch(/lock timeout/i);
      expect(elapsed).toBeGreaterThan(10_000);
      expect(elapsed).toBeLessThan(25_000);
    } finally {
      if (holder.exitCode === null) holder.kill("SIGTERM");
    }
  });

  it("ends a session left idle in a transaction", async () => {
    const db = database!;
    const holder = spawn(
      db.psql,
      [...db.databaseArgs, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    holder.stdout!.setEncoding("utf8");
    holder.stdout!.on("data", (chunk: string) => { output += chunk; });
    holder.stdin!.write("begin;\nselect 'HARNESS_IDLE_HELD';\n");
    const started = Date.now();
    while (!output.includes("HARNESS_IDLE_HELD")) {
      if (Date.now() - started > 5_000) throw new Error("idle holder did not start");
      await sleep(20);
    }
    let gone = false;
    try {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const count = await db.sqlAsync(
          `select count(*) from pg_stat_activity
           where query like '%HARNESS_IDLE_HELD%' and pid <> pg_backend_pid()`,
        );
        if (count === "0") {
          gone = true;
          break;
        }
        await sleep(500);
      }
      expect(gone).toBe(true);
      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThan(10_000);
      expect(elapsed).toBeLessThan(25_000);
    } finally {
      if (holder.exitCode === null) holder.kill("SIGTERM");
    }
  });
});
