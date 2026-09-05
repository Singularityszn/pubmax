// Effective PostgreSQL proof for 0149 (adversarial review F-25).
//
// THE CLAIM UNDER TEST is that one send attempt can only ever be one row. A
// connection reset after the row committed used to answer the browser as a
// failure, so the drinker sent the line again and the conversation held it
// twice. The browser now mints one uuid per attempt; this index is what makes
// the second arrival a conflict rather than a second message.
//
// The proof is the SERVER's, not the store's: it runs the two inserts against a
// real PostgreSQL 16 that holds every migration, so the guarantee is the table's
// and does not depend on the application winning a race with itself.
//
// Every timestamp is a literal, for the reason 0141's proof gives.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase/migrations");
const FORWARD_NAME = "20260905190000_0149_message_client_idempotency.sql";
const FORWARD = join(MIGRATIONS, FORWARD_NAME);
const ROLLBACK = join(
  MIGRATIONS,
  "rollback/20260905190000_0149_message_client_idempotency_rollback.sql",
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
  if (process.env.PUBMAX_MESSAGE_IDEMPOTENCY_NO_PG === "1") {
    return "PostgreSQL binaries were deliberately hidden by PUBMAX_MESSAGE_IDEMPOTENCY_NO_PG=1.";
  }
  const missing = (["initdb", "postgres", "psql"] as const).filter(
    (name) => findPostgresBinary(name) === null,
  );
  return missing.length > 0
    ? `PostgreSQL 16 binaries unavailable for: ${missing.join(", ")}. Each binary must report major version 16 to run the 0149 message idempotency proof.`
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

  const dataDir = mkdtempSync(join(tmpdir(), "pubmax-msg-idem-0149-"));
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

    const database = "pubmax_message_idempotency_0149";
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

const CONVERSATION = "22222222-0000-4000-8000-000000000001";
const OTHER_CONVERSATION = "22222222-0000-4000-8000-000000000002";
const KEY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const AT = "2026-09-05 22:40:00+01";

function insertMessage(options: {
  conversationId: string;
  body: string;
  clientMessageId?: string | null;
}): { ok: boolean; said: string } {
  const columns = ["conversation_id", "sender_handle", "body", "created_at"];
  const values = [
    `'${options.conversationId}'::uuid`,
    "'ken'",
    `'${options.body}'`,
    `'${AT}'`,
  ];
  if (options.clientMessageId !== undefined) {
    columns.push("client_message_id");
    values.push(options.clientMessageId === null ? "null" : `'${options.clientMessageId}'::uuid`);
  }
  return requireDatabase().attempt(
    `insert into public.messages (${columns.join(", ")}) values (${values.join(", ")});`,
  );
}

function messageCount(conversationId: string): string {
  return requireDatabase().sql(
    `select count(*)::int from public.messages where conversation_id = '${conversationId}'::uuid;`,
  );
}

beforeAll(async () => {
  skipReason = missingPostgresReason();
  if (skipReason) {
    console.error(
      [
        "",
        "0149 MESSAGE IDEMPOTENCY PROOF SKIPPED - THIS IS NOT A PASS",
        `Reason: ${skipReason}`,
        "Nothing proved that a repeated send attempt is refused by the table rather than by the application.",
        "",
      ].join("\n"),
    );
    return;
  }
  database = await startPostgres();
  const session = requireDatabase();
  session.applyFile(SESSION_FIXTURE);
  for (const path of PREREQUISITES) session.applyFile(path);
  session.sql(
    [
      `insert into public.conversations (id, handle_a, handle_b, created_at, last_message_at)`,
      `  values ('${CONVERSATION}'::uuid, 'ken', 'sam', '${AT}', '${AT}'),`,
      `         ('${OTHER_CONVERSATION}'::uuid, 'jen', 'ken', '${AT}', '${AT}');`,
    ].join("\n"),
  );
}, 180_000);

afterAll(async () => {
  await database?.stop();
  database = null;
});

describe.skipIf(skipReason !== null || process.env.PUBMAX_MESSAGE_IDEMPOTENCY_NO_PG === "1")(
  "0149 message send idempotency",
  () => {
    it("BEFORE the migration the column is not there, and a repeat is a second message", () => {
      const session = requireDatabase();
      expect(
        session.sql(
          "select count(*)::int from information_schema.columns " +
            "where table_schema = 'public' and table_name = 'messages' and column_name = 'client_message_id';",
        ),
      ).toBe("0");
      expect(insertMessage({ conversationId: CONVERSATION, body: "twice over" }).ok).toBe(true);
      expect(insertMessage({ conversationId: CONVERSATION, body: "twice over" }).ok).toBe(true);
      expect(messageCount(CONVERSATION)).toBe("2");
    });

    it("applies over the rows already there, leaving every one of them alone", () => {
      const session = requireDatabase();
      session.applyFile(FORWARD);

      expect(messageCount(CONVERSATION)).toBe("2");
      // Every pre-0149 row carries NULL, which the partial index never matches.
      expect(
        session.sql(
          "select count(*)::int from public.messages where client_message_id is null;",
        ),
      ).toBe("2");
      expect(
        session.sql(
          "select indexdef from pg_indexes " +
            "where indexname = 'messages_conversation_client_message_id_idx';",
        ),
      ).toContain("WHERE (client_message_id IS NOT NULL)");
    });

    it("is idempotent, so a re-run of the apply list changes nothing", () => {
      const session = requireDatabase();
      session.applyFile(FORWARD);
      expect(
        session.sql(
          "select count(*)::int from pg_indexes " +
            "where indexname = 'messages_conversation_client_message_id_idx';",
        ),
      ).toBe("1");
    });

    // ── THE FINDING ─────────────────────────────────────────────────────────
    it("REFUSES the same attempt arriving twice, at the table", () => {
      expect(insertMessage({ conversationId: CONVERSATION, body: "one round", clientMessageId: KEY }).ok).toBe(true);
      const replay = insertMessage({
        conversationId: CONVERSATION,
        body: "one round",
        clientMessageId: KEY,
      });

      expect(replay.ok).toBe(false);
      expect(replay.said).toContain("messages_conversation_client_message_id_idx");
      expect(replay.said).toContain("23505");
      expect(messageCount(CONVERSATION)).toBe("3");
    });

    it("still takes TWO deliberate sends, because each carries its own key", () => {
      const second = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
      expect(insertMessage({ conversationId: CONVERSATION, body: "and another", clientMessageId: second }).ok).toBe(true);
      expect(messageCount(CONVERSATION)).toBe("4");
    });

    it("scopes the key to ONE conversation, so two threads may reuse a client's id", () => {
      expect(insertMessage({ conversationId: OTHER_CONVERSATION, body: "elsewhere", clientMessageId: KEY }).ok).toBe(true);
      expect(messageCount(OTHER_CONVERSATION)).toBe("1");
    });

    it("never treats two UNKEYED rows as one, so a legacy lane is untouched", () => {
      expect(insertMessage({ conversationId: OTHER_CONVERSATION, body: "plain", clientMessageId: null }).ok).toBe(true);
      expect(insertMessage({ conversationId: OTHER_CONVERSATION, body: "plain", clientMessageId: null }).ok).toBe(true);
      expect(messageCount(OTHER_CONVERSATION)).toBe("3");
    });

    it("the ROLLBACK gives the column back and keeps every message", () => {
      const session = requireDatabase();
      const before = messageCount(CONVERSATION);
      session.applyFile(ROLLBACK);

      expect(
        session.sql(
          "select count(*)::int from information_schema.columns " +
            "where table_schema = 'public' and table_name = 'messages' and column_name = 'client_message_id';",
        ),
      ).toBe("0");
      expect(
        session.sql(
          "select count(*)::int from pg_indexes " +
            "where indexname = 'messages_conversation_client_message_id_idx';",
        ),
      ).toBe("0");
      expect(messageCount(CONVERSATION)).toBe(before);
    });
  },
);
