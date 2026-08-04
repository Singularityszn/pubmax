/**
 * Throwaway local Postgres and PostgREST for effective RLS session tests.
 * Starts an ephemeral cluster, applies fixture + wave-2 migrations, and
 * exposes SQL and HTTP runners. Never touches a live Supabase project.
 */
import { spawn, execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase/migrations");

const WAVE2 = [
  "20260803200000_0065_rls_wave2_helpers.sql",
  "20260803201000_0066_rls_wave2_priority_policies.sql",
  "20260803202000_0067_rls_wave2_owner_policies.sql",
  "20260803203000_0068_rls_wave2_service_role_only.sql",
  "20260803204000_0069_rls_wave2_rpc_hardening.sql",
];

function findPgBin(name) {
  const candidates = [
    `/opt/homebrew/opt/postgresql@16/bin/${name}`,
    `/opt/homebrew/opt/postgresql@17/bin/${name}`,
    `/usr/local/opt/postgresql@16/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    // Debian/Ubuntu packages (CI: apt install postgresql-16)
    `/usr/lib/postgresql/16/bin/${name}`,
    `/usr/lib/postgresql/17/bin/${name}`,
    `/usr/bin/${name}`,
    name,
  ];
  for (const c of candidates) {
    try {
      if (c === name) {
        execFileSync("which", [name], { stdio: "pipe" });
        return name;
      }
      if (existsSync(c)) return c;
    } catch {
      /* try next */
    }
  }
  return null;
}

function findPostgrestBin() {
  const candidates = [
    process.env.POSTGREST_BIN,
    "/opt/homebrew/bin/postgrest",
    "/usr/local/bin/postgrest",
    "/usr/bin/postgrest",
    "postgrest",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (candidate === "postgrest") {
        execFileSync("which", [candidate], { stdio: "pipe" });
        return candidate;
      }
      if (existsSync(candidate)) return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}

function jwt(secret, sub) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    role: "authenticated",
    sub,
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

/**
 * When Postgres binaries are missing, return a loud skip reason.
 * Callers must SKIP (not pass, not fail) effective RLS tests when this is set.
 * A skipped RLS test must never read as a passed one.
 */
export function missingPostgresReason() {
  // Escape hatch to prove the loud-skip path without uninstalling Postgres
  // (Vercel and other hosts without a DB hit the real probe below).
  if (process.env.PUBMAX_RLS_NO_PG === "1") {
    return (
      "PostgreSQL 16+ binaries not found (initdb/postgres/psql). " +
      "Install postgresql@16 to run effective RLS tests. " +
      "CI job rls-session installs Postgres 16 and runs them for real. " +
      "(PUBMAX_RLS_NO_PG=1 forced this skip.)"
    );
  }
  const initdb = findPgBin("initdb");
  const postgres = findPgBin("postgres");
  const psql = findPgBin("psql");
  if (!initdb || !postgres || !psql) {
    return (
      "PostgreSQL 16+ binaries not found (initdb/postgres/psql). " +
      "Install postgresql@16 to run effective RLS tests. " +
      "CI job rls-session installs Postgres 16 and runs them for real."
    );
  }
  return null;
}

async function pickPort() {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

export async function startRlsSession() {
  const missing = missingPostgresReason();
  if (missing) {
    throw new Error(missing);
  }
  const initdb = findPgBin("initdb");
  const postgres = findPgBin("postgres");
  const psql = findPgBin("psql");

  const dataDir = mkdtempSync(join(tmpdir(), "pubmax-rls-"));
  const port = await pickPort();
  execFileSync(
    initdb,
    ["-D", dataDir, "--locale=C", "-E", "UTF8", "--username=postgres", "--auth=trust"],
    { stdio: "pipe" },
  );

  // Keep the cluster tiny and local-only.
  writeFileSync(
    join(dataDir, "postgresql.auto.conf"),
    [
      "listen_addresses = '127.0.0.1'",
      `port = ${port}`,
      "max_connections = 20",
      "shared_buffers = 16MB",
      "fsync = off",
      "full_page_writes = off",
      "synchronous_commit = off",
    ].join("\n") + "\n",
  );

  const proc = spawn(
    postgres,
    ["-D", dataDir, "-k", dataDir, "-p", String(port), "-h", "127.0.0.1"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, LC_ALL: "C" },
    },
  );
  const logChunks = [];
  proc.stdout?.on("data", (b) => logChunks.push(b.toString()));
  proc.stderr?.on("data", (b) => logChunks.push(b.toString()));

  // Wait until accepting connections.
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      execFileSync(
        psql,
        ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres", "-c", "select 1"],
        { stdio: "pipe" },
      );
      ready = true;
      break;
    } catch {
      await sleep(100);
    }
  }
  if (!ready) {
    proc.kill("SIGKILL");
    throw new Error(`Postgres failed to start:\n${logChunks.join("")}`);
  }

  const dbName = "pubmax_rls";
  execFileSync(
    psql,
    ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres", "-c", `create database ${dbName}`],
    { stdio: "pipe" },
  );

  function sql(statement, { asRole = null, sub = null } = {}) {
    // Single connection: set JWT claim + role, run statement, reset.
    // Tag the result so SET/RESET noise does not pollute parsing.
    const claim = sub ? sub.replace(/'/g, "''") : "";
    const full = [
      `select set_config('request.jwt.claim.sub', '${claim}', false);`,
      asRole ? `set role ${asRole};` : "set role none;",
      // Wrap scalar SELECTs so the only RESULT: line is the answer we parse.
      // Writes must execute as writes: wrapping DELETE in SELECT both errors and
      // can make a row-survival test pass without exercising its policy.
      statement.trimStart().toLowerCase().startsWith("select ") &&
      !statement.includes(";\n")
        ? `select 'RESULT:' || coalesce((${statement.replace(/;\s*$/, "")})::text, '');`
        : `${statement.replace(/;\s*$/, "")};`,
      "reset role;",
      "select set_config('request.jwt.claim.sub', '', false);",
    ].join("\n");
    try {
      const out = execFileSync(
        psql,
        [
          "-h", "127.0.0.1",
          "-p", String(port),
          "-U", "postgres",
          "-d", dbName,
          "-v", "ON_ERROR_STOP=1",
          "-t",
          "-A",
          "-c", full,
        ],
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
      );
      const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
      const resultLine = [...lines].reverse().find((l) => l.startsWith("RESULT:"));
      return {
        ok: true,
        out: resultLine ? resultLine.slice("RESULT:".length) : out.trim(),
        raw: out.trim(),
        err: "",
      };
    } catch (e) {
      const err = (e.stderr?.toString?.() || e.message || String(e)).trim();
      return { ok: false, out: (e.stdout?.toString?.() || "").trim(), err };
    }
  }

  function sqlFile(path) {
    execFileSync(
      psql,
      [
        "-h", "127.0.0.1",
        "-p", String(port),
        "-U", "postgres",
        "-d", dbName,
        "-v", "ON_ERROR_STOP=1",
        "-f", path,
      ],
      { stdio: "pipe" },
    );
  }

  // Apply fixture + wave-2 migrations. 0067/0068 touch tables not in the
  // fixture (notifications, night_*, etc.) — wrap those in a tolerant runner
  // that skips missing-table errors by applying a reduced policy set for the
  // tables we actually test.
  sqlFile(join(__dirname, "session-fixture.sql"));
  sqlFile(join(MIGRATIONS_DIR, WAVE2[0])); // helpers always apply
  sqlFile(join(MIGRATIONS_DIR, WAVE2[1])); // priority policies

  // 0067 has many tables; apply only the sections we need via a reduced file.
  sqlFile(join(__dirname, "session-owner-policies.sql"));

  // 0068 service-role-only for rounds* (and the drop of public reads)
  sqlFile(join(__dirname, "session-service-role.sql"));

  const postgrest = findPostgrestBin();
  if (!postgrest) {
    proc.kill("SIGKILL");
    rmSync(dataDir, { recursive: true, force: true });
    throw new Error(
      "PostgreSQL is available but PostgREST is not. Install PostgREST 14 or set POSTGREST_BIN; HTTP-boundary RLS proofs may not be skipped.",
    );
  }

  const restPort = await pickPort();
  const jwtSecret = "pubmax-rls-session-only-secret-32-bytes-minimum";
  const restLogs = [];
  const restProc = spawn(postgrest, [], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      // Homebrew PostgREST links libpq from its standalone formula. Test hosts
      // may only have versioned PostgreSQL, whose compatible libpq lives here.
      DYLD_LIBRARY_PATH:
        process.env.DYLD_LIBRARY_PATH || join(dirname(dirname(initdb)), "lib"),
      PGRST_DB_URI: `postgres://postgres@127.0.0.1:${port}/${dbName}`,
      PGRST_DB_SCHEMAS: "public",
      PGRST_DB_ANON_ROLE: "anon",
      PGRST_JWT_SECRET: jwtSecret,
      PGRST_SERVER_HOST: "127.0.0.1",
      PGRST_SERVER_PORT: String(restPort),
      PGRST_DB_CHANNEL_ENABLED: "false",
    },
  });
  restProc.stdout?.on("data", (chunk) => restLogs.push(chunk.toString()));
  restProc.stderr?.on("data", (chunk) => restLogs.push(chunk.toString()));

  const restBaseUrl = `http://127.0.0.1:${restPort}`;
  let restReady = false;
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(restBaseUrl);
      if (response.ok) {
        restReady = true;
        break;
      }
    } catch {
      /* wait for listener and schema cache */
    }
    await sleep(100);
  }
  if (!restReady) {
    restProc.kill("SIGKILL");
    proc.kill("SIGKILL");
    rmSync(dataDir, { recursive: true, force: true });
    throw new Error(`PostgREST failed to start:\n${restLogs.join("")}`);
  }

  async function rest(path, { method = "GET", sub = null, headers = {} } = {}) {
    const upstreamPath = path.replace(/^\/rest\/v1/, "") || "/";
    const requestHeaders = { ...headers };
    if (sub) requestHeaders.Authorization = `Bearer ${jwt(jwtSecret, sub)}`;
    const response = await fetch(`${restBaseUrl}${upstreamPath}`, {
      method,
      headers: requestHeaders,
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { status: response.status, body, text };
  }

  async function stop() {
    try {
      restProc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    try {
      proc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    await sleep(200);
    try {
      restProc.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    try {
      proc.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  return {
    port,
    dataDir,
    sql,
    sqlFile,
    rest,
    stop,
    rollbackPath: join(MIGRATIONS_DIR, "rollback/20260803200000_rls_wave2_rollback.sql"),
  };
}
