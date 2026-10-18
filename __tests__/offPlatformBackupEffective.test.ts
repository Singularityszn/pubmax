import { execFile, execFileSync, spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { startPostgres, type PostgresSession } from "./helpers/postgres";
import { findPostgresBinary } from "@/scripts/rls/postgresHost.mjs";
import { DUMP_SCHEMAS, dumpFileName } from "@/scripts/lib/offPlatformBackup.mjs";

const runFile = promisify(execFile);
const ROOT = path.resolve(__dirname, "..");
const REF = "abcdefghijklmnopqrst";
const TOKEN = "fixture-management-secret";
const PASSWORD = "fixture-login-secret";
let pg: PostgresSession;
let server: Server;
let baseUrl: string;
let directory: string;
let calls: { url: string; body: string; authorization?: string }[];
let loginStatus = 201;
let loginBody: unknown;
let storageListStatus: number;
let storageDownloadStatus: number;
let filesAtRenewal: string[];
let versionsAtRenewal: unknown;

beforeAll(async () => {
  pg = await startPostgres({ label: "backup", database: "backup_fixture" });
  pg.sql(`
    create role supabase_read_only_user bypassrls;
    grant pg_read_all_data to supabase_read_only_user;
    create role cli_login_fixture login noinherit password '${PASSWORD}';
    grant supabase_read_only_user to cli_login_fixture;
    create role "cli_login_fixture.${REF}" login noinherit password '${PASSWORD}';
    grant supabase_read_only_user to "cli_login_fixture.${REF}";
    create schema auth; create schema storage; create schema supabase_migrations;
    create table public.profiles (id int, marker text);
    alter table public.profiles enable row level security;
    alter table public.profiles force row level security;
    insert into public.profiles values (1, 'fixture-profile');
    create table auth.users (id int, marker text);
    insert into auth.users values (2, 'fixture-auth');
    create table storage.objects (id int, marker text);
    insert into storage.objects values (3, 'fixture-storage');
    create table supabase_migrations.schema_migrations (id int, marker text);
    insert into supabase_migrations.schema_migrations values (4, 'fixture-migration');
  `);
  const hba = pg.sql("show hba_file");
  writeFileSync(hba, `host all cli_login_fixture,cli_login_fixture.${REF} 127.0.0.1/32 scram-sha-256\n${readFileSync(hba, "utf8")}`);
  pg.sql("select pg_reload_conf()");
  server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    calls.push({ url: request.url!, body, authorization: request.headers.authorization });
    response.setHeader("content-type", "application/json");
    if (request.url?.endsWith("/cli/login-role")) {
      const privateDir = path.join(directory, "private");
      filesAtRenewal = readdirSync(privateDir, { recursive: true }) as string[];
      const versionsFile = path.join(privateDir, "bucket/pint-drops.versions.json");
      versionsAtRenewal = existsSync(versionsFile) ? JSON.parse(readFileSync(versionsFile, "utf8")) : {};
      response.writeHead(loginStatus).end(JSON.stringify(loginBody));
    } else if (request.url?.includes("/object/list/")) {
      if (storageListStatus !== 200) {
        response.writeHead(storageListStatus).end(JSON.stringify({ message: "fixture storage failure" }));
        return;
      }
      response.end(JSON.stringify([{ id: "fixture", name: "fixture.jpg", metadata: { size: 5, eTag: "v1" } }]));
    } else if (request.url?.endsWith("/fixture.jpg")) {
      if (storageDownloadStatus !== 200) {
        response.writeHead(storageDownloadStatus).end(JSON.stringify({ message: "fixture storage failure" }));
        return;
      }
      response.end("photo");
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not listen.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pg?.stop();
});

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), "backup-effective-"));
  calls = [];
  loginStatus = 201;
  loginBody = { role: "cli_login_fixture", password: PASSWORD, ttl_seconds: 300 };
  storageListStatus = 200;
  storageDownloadStatus = 200;
  filesAtRenewal = [];
  versionsAtRenewal = {};
  pg.sql(`alter role cli_login_fixture password '${PASSWORD}' valid until 'infinity'`);
  mkdirSync(path.join(directory, "bin"));
  writeClientWrappers(pg.database);
  writeFileSync(path.join(directory, "redirect.mjs"), `
const realFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(input);
  if (!['api.supabase.com', '${REF}.supabase.co'].includes(url.hostname)) throw new Error('Unexpected fixture request');
  return realFetch(${JSON.stringify(baseUrl)} + url.pathname, options);
};
`);
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

// These wrappers use real PostgreSQL clients against the disposable cluster.
// Only the network endpoint, the database and the fixture TLS setting change,
// never dump arguments.
function writeClientWrappers(database: string) {
  for (const command of ["pg_dump", "pg_restore"] as const) {
    writeFileSync(path.join(directory, "bin", command), `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
if (process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PUBMAX_BACKUP_DB_URL) process.exit(90);
const result = spawnSync(${JSON.stringify(findPostgresBinary(command))}, process.argv.slice(2), {
  env: { ...process.env, PGHOST: '127.0.0.1', PGPORT: '${pg.port}', PGDATABASE: '${database}', PGSSLMODE: 'disable' },
  stdio: 'inherit'
});
process.exit(result.status ?? 91);
`, { mode: 0o700 });
  }
}

async function backup(overrides: Partial<NodeJS.ProcessEnv> = {}, args: string[] = []) {
  try {
    const result = await runFile(process.execPath, ["--import", path.join(directory, "redirect.mjs"), "scripts/backup-offplatform.mjs", ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        PATH: `${path.join(directory, "bin")}:${process.env.PATH}`,
        PUBMAX_BACKUP_DIR: path.join(directory, "private"),
        PUBMAX_BACKUP_DB_AUTH: "cli-read-only",
        PUBMAX_BACKUP_DB_URL: `postgres://postgres@db.${REF}.supabase.co:5432/postgres`,
        SUPABASE_URL: `https://${REF}.supabase.co`,
        SUPABASE_ACCESS_TOKEN: TOKEN,
        SUPABASE_SERVICE_ROLE_KEY: "fixture-storage-secret",
        PUBMAX_ALERT_WEBHOOK_URL: "",
        ...overrides,
      },
      timeout: 20_000,
    });
    return { status: 0, output: result.stdout + result.stderr };
  } catch (error) {
    const result = error as { code: number; stdout: string; stderr: string };
    return { status: result.code, output: result.stdout + result.stderr };
  }
}

function retentionFixture(withFallback = false, now = Date.now()) {
  const privateDir = path.join(directory, "private");
  const bucketRoot = path.join(privateDir, "bucket/pint-drops");
  mkdirSync(path.join(bucketRoot, "expired-account"), { recursive: true });
  const expired = [
    path.join(privateDir, "pubmax-20000101T000000Z.dump"),
    path.join(privateDir, "pubmax-20000102T000000Z.dump"),
    path.join(privateDir, "pubmax-20000101T000000Z.dump.partial"),
    path.join(bucketRoot, "expired-account/photo.jpg"),
    path.join(bucketRoot, "expired-account/photo.jpg.incoming"),
  ];
  for (const file of expired) {
    writeFileSync(file, "fixture-expired-artifact");
    utimesSync(file, new Date("2000-01-01"), new Date("2000-01-01"));
  }
  mkdirSync(path.join(bucketRoot, "empty-account"));
  const versionsFile = path.join(privateDir, "bucket/pint-drops.versions.json");
  const versions: Record<string, string> = { "expired-account/photo.jpg": "expired-version" };
  // This fallback is older than seven weeks, but has not reached eight weeks.
  const fallbackDate = new Date(now - 52 * 24 * 60 * 60 * 1000);
  const fallbackDump = path.join(privateDir, dumpFileName(fallbackDate));
  const fallbackPhoto = path.join(bucketRoot, "fallback-account/photo.jpg");
  if (withFallback) {
    mkdirSync(path.dirname(fallbackPhoto));
    writeFileSync(fallbackDump, "fixture-fallback-dump", { mode: 0o600 });
    writeFileSync(fallbackPhoto, "fixture-fallback-photo", { mode: 0o600 });
    utimesSync(fallbackPhoto, fallbackDate, fallbackDate);
    versions["fallback-account/photo.jpg"] = "fallback-version";
  }
  writeFileSync(versionsFile, JSON.stringify(versions), { mode: 0o600 });
  return { privateDir, bucketRoot, expired, versionsFile, fallbackDump, fallbackPhoto };
}

// With no newer complete dump, the 2 January 2000 dump is the last good backup
// and is never deleted (owner decision, 16 October 2026).
const LAST_GOOD_2000 = "pubmax-20000102T000000Z.dump";

function expectExpiredArtifactsRemoved(fixture: ReturnType<typeof retentionFixture>, { lastGoodKept = false } = {}) {
  for (const file of fixture.expired) {
    expect(existsSync(file)).toBe(lastGoodKept && path.basename(file) === LAST_GOOD_2000);
  }
  expect(existsSync(path.join(fixture.bucketRoot, "expired-account"))).toBe(false);
  expect(existsSync(path.join(fixture.bucketRoot, "empty-account"))).toBe(false);
  expect(filesAtRenewal.some((file) =>
    file.includes("expired-account") || file.includes("empty-account") ||
    (file.includes("200001") && !(lastGoodKept && file === LAST_GOOD_2000)),
  )).toBe(false);
  expect(JSON.stringify(versionsAtRenewal)).not.toContain("expired-account");
}

function expectFallbackRetained(fixture: ReturnType<typeof retentionFixture>) {
  expect(readFileSync(fixture.fallbackDump, "utf8")).toBe("fixture-fallback-dump");
  expect(readFileSync(fixture.fallbackPhoto, "utf8")).toBe("fixture-fallback-photo");
  expect(JSON.parse(readFileSync(fixture.versionsFile, "utf8"))).toEqual({ "fallback-account/photo.jpg": "fallback-version" });
  expect(readdirSync(fixture.privateDir).filter((file) => file.endsWith(".dump"))).toEqual([path.basename(fixture.fallbackDump)]);
  expect(readdirSync(fixture.privateDir).some((file) => file.endsWith(".partial"))).toBe(false);
}

it("renews a read-only login and backs up all five schemas and private Storage through the executable", async () => {
  const result = await backup();
  expect(result.status, result.output).toBe(0);
  expect(calls[0]).toEqual({ url: `/v1/projects/${REF}/cli/login-role`, body: '{"read_only":true}', authorization: `Bearer ${TOKEN}` });
  const privateDir = path.join(directory, "private");
  const dump = readdirSync(privateDir).find((file) => file.endsWith(".dump"))!;
  const dumpPath = path.join(privateDir, dump);
  // Decode the fixture archive into memory for coverage proof. The restore
  // itself is proved by the next test.
  const sql = execFileSync(findPostgresBinary("pg_restore")!, ["--file=-", dumpPath], { encoding: "utf8" });
  for (const marker of ["fixture-profile", "fixture-auth", "fixture-storage", "fixture-migration"]) expect(sql).toContain(marker);
  for (const table of ["public.profiles", "auth.users", "storage.objects", "supabase_migrations.schema_migrations"]) {
    expect(sql).toContain(`CREATE TABLE ${table}`);
    expect(sql).toContain(`COPY ${table}`);
  }
  expect(statSync(privateDir).mode & 0o777).toBe(0o700);
  expect(statSync(dumpPath).mode & 0o777).toBe(0o600);
  const photo = path.join(privateDir, "bucket/pint-drops/fixture.jpg");
  expect(readFileSync(photo, "utf8")).toBe("photo");
  expect(statSync(photo).mode & 0o777).toBe(0o600);
  expect(result.output).not.toContain(TOKEN);
  expect(result.output).not.toContain(PASSWORD);
  expect(readdirSync(privateDir).some((file) => file.endsWith(".partial"))).toBe(false);
});

// THE RESTORE PROOF. A dump nobody has restored is a hope, so this one is
// restored. A second database in the backup cluster holds the real schema:
// the Supabase stand-in plus every forward migration (as startMigratedPostgres
// builds it), a Supabase CLI migration ledger and seeded rows. The backup
// executable dumps it exactly as it dumps production, and the archive is then
// restored into a FRESH cluster with the documented command. This is the floor.
// The quarterly drill in docs/DR_RUNBOOK.md, against a real Supabase project,
// is the proof.
const RESTORE_SOURCE = "restore_source";
const SESSION_FIXTURE = path.join(ROOT, "scripts/rls/session-fixture.sql");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const USER_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE_ID = "00000000-0000-4000-8000-000000000002";

// Schemas Supabase owns and a fresh project already holds, so the backup
// leaves them out on purpose. Every OTHER schema the migrations create must
// come back from the dump with its tables, rows, policies and triggers.
const PLATFORM_ONLY_SCHEMAS = [
  "extensions", // pgcrypto and friends. Installed by Supabase, not by us.
  "realtime", // Realtime's channel table. Its messages are transient.
];

// The restore runs without --exit-on-error, as docs/DR_RUNBOOK.md section 2
// says, so it reports every statement that failed. A fresh Supabase project
// (here the stand-in in scripts/rls/session-fixture.sql) already holds the
// public, auth and storage schemas, auth.users, auth.uid() and storage.objects.
// The dump creates each of them again, and these are the ONLY failures a
// complete restore may print. Anything else, such as a policy whose helper
// schema is missing or a COPY that does not fit, means data or protection did
// not come back.
const EXPECTED_RESTORE_ERRORS = [
  { message: 'schema "public" already exists', command: "CREATE SCHEMA public;" },
  { message: 'schema "auth" already exists', command: "CREATE SCHEMA auth;" },
  { message: 'schema "storage" already exists', command: "CREATE SCHEMA storage;" },
  { message: 'relation "users" already exists', command: "CREATE TABLE auth.users (" },
  { message: 'relation "objects" already exists', command: "CREATE TABLE storage.objects (" },
  { message: 'function "uid" already exists with same argument types', command: "CREATE FUNCTION auth.uid() RETURNS uuid" },
  // The existing table keeps its own primary key, so adding the dump's fails.
  { message: 'multiple primary keys for table "users" are not allowed', command: "ALTER TABLE ONLY auth.users" },
  { message: 'multiple primary keys for table "objects" are not allowed', command: "ALTER TABLE ONLY storage.objects" },
];

type Psql = { psql: string; connectionArgs: string[] };

function psqlOn(target: Psql, database: string, args: string[]) {
  return execFileSync(target.psql, [...target.connectionArgs, "-d", database, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function rows(target: Psql, database: string, query: string) {
  return psqlOn(target, database, ["-c", query]).split("\n").filter(Boolean);
}

function prepareRestoreSource() {
  pg.sql(`create database ${RESTORE_SOURCE}`);
  psqlOn(pg, RESTORE_SOURCE, ["-f", SESSION_FIXTURE]);
  const migrations = readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort();
  for (const name of migrations) psqlOn(pg, RESTORE_SOURCE, ["-f", path.join(MIGRATIONS, name)]);
  // The Supabase CLI writes this ledger on the first push. The stand-in has none.
  const ledger = migrations.map((name) => {
    const [version, ...rest] = name.replace(/\.sql$/, "").split("_");
    return `('${version}', '${rest.join("_")}')`;
  });
  psqlOn(pg, RESTORE_SOURCE, ["-c", `
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
    insert into supabase_migrations.schema_migrations (version, name) values ${ledger.join(", ")};
    insert into auth.users (id, encrypted_password) values ('${USER_ID}', 'fixture-hash');
    insert into pubmax_private.account_password_set (user_id) values ('${USER_ID}');
    insert into public.profiles (id, user_id, handle) values ('${PROFILE_ID}', '${USER_ID}', 'fixture_restore');
    insert into storage.objects (bucket_id, name, owner_id) values ('pint-drops', '${USER_ID}/fixture.jpg', '${USER_ID}');
  `]);
  return migrations.length;
}

/** What a restore must bring back: every application table with its row count, every policy and every trigger. */
function databaseShape(target: Psql, database: string) {
  const skip = ["pg_catalog", "information_schema", ...PLATFORM_ONLY_SCHEMAS].map((schema) => `'${schema}'`).join(", ");
  const where = (column: string) => `${column} not in (${skip}) and ${column} not like 'pg\\_%'`;
  const schemas = rows(target, database, `select nspname from pg_namespace where ${where("nspname")} order by 1`);
  const tables = rows(target, database, `
    select format('%I.%I', n.nspname, c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and ${where("n.nspname")} order by 1`);
  const counts = tables.length === 0 ? [] : rows(target, database, tables.map((table) => `select '${table}', count(*) from ${table}`).join(" union all "));
  return {
    schemas,
    tables: Object.fromEntries(counts.map((line) => {
      const [table, count] = line.split("|");
      return [table, Number(count)];
    })),
    policies: rows(target, database, `select format('%I.%I.%I', schemaname, tablename, policyname) from pg_policies where ${where("schemaname")} order by 1`),
    triggers: rows(target, database, `
      select format('%I.%I.%I', n.nspname, c.relname, t.tgname) from pg_trigger t
      join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal and ${where("n.nspname")} order by 1`),
  };
}

it("restores the dump into a fresh cluster, failing only where a fresh Supabase project already holds the object", async () => {
  const migrationCount = prepareRestoreSource();
  let target: PostgresSession | undefined;
  try {
    writeClientWrappers(RESTORE_SOURCE);
    const result = await backup();
    expect(result.status, result.output).toBe(0);
    const privateDir = path.join(directory, "private");
    const dumpPath = path.join(privateDir, readdirSync(privateDir).find((file) => file.endsWith(".dump"))!);
    const source = databaseShape(pg, RESTORE_SOURCE);
    // Every schema the migrations create is one the backup dumps. A schema
    // left out loses its tables, and every policy or trigger that calls into it.
    expect(source.schemas).toEqual([...DUMP_SCHEMAS].sort());

    target = await startPostgres({ label: "restore" });
    target.applyFile(SESSION_FIXTURE);
    // The documented command, docs/DR_RUNBOOK.md section 2 step 4.
    const restore = spawnSync(findPostgresBinary("pg_restore")!, [
      ...target.connectionArgs, "--no-owner", "--no-privileges", "--dbname", "postgres", dumpPath,
    ], { encoding: "utf8" });
    const errors = [...restore.stderr.matchAll(/ERROR: {2}(.*)\n(?:.*\n)*?Command was: (.*)/g)]
      .map(([, message, command]) => ({ message: String(message), command: String(command) }));
    const unexpected = errors.filter((error) => !EXPECTED_RESTORE_ERRORS.some((allowed) => allowed.message === error.message && allowed.command === error.command));
    expect(unexpected).toEqual([]);
    const sortKey = (error: { message: string; command: string }) => `${error.message}|${error.command}`;
    expect(errors.map(sortKey).sort()).toEqual(EXPECTED_RESTORE_ERRORS.map(sortKey).sort());
    // Every error pg_restore counted is one the list above names.
    expect(restore.stderr.match(/^pg_restore: error:/gm)).toHaveLength(EXPECTED_RESTORE_ERRORS.length);
    expect(restore.stderr).toContain(`errors ignored on restore: ${EXPECTED_RESTORE_ERRORS.length}`);
    expect(restore.status).toBe(1);

    const restored = databaseShape(target, "postgres");
    // The key tables hold the seeded rows and the ledger, so the comparison below covers them.
    expect(source.tables).toMatchObject({
      "auth.users": 1,
      "public.profiles": 1,
      "storage.objects": 1,
      "pubmax_private.account_password_set": 1,
      "supabase_migrations.schema_migrations": migrationCount,
    });
    expect(source.policies.length).toBeGreaterThan(0);
    expect(source.triggers.length).toBeGreaterThan(0);
    // Every application table, row count, policy and trigger, nothing more or less.
    expect(restored).toEqual(source);
  } finally {
    await target?.stop();
    pg.sql(`drop database ${RESTORE_SOURCE}`);
  }
}, 180_000);

it("acquires a fresh password on each run instead of reusing the expired prior credential", async () => {
  expect((await backup()).status).toBe(0);
  const nextPassword = `${PASSWORD}-next`;
  pg.sql(`alter role cli_login_fixture password '${nextPassword}'`);
  loginBody = { role: "cli_login_fixture", password: nextPassword, ttl_seconds: 300 };
  const result = await backup();
  expect(result.status, result.output).toBe(0);
  expect(calls.filter((call) => call.url.endsWith("/cli/login-role"))).toHaveLength(2);
  expect(result.output).not.toContain(nextPassword);
});

it.each([
  [403, { message: TOKEN }, "answered 403"],
  [201, { role: "cli_login_fixture", password: PASSWORD, ttl_seconds: 0 }, "expired credentials"],
  [201, { role: "postgres", password: PASSWORD, ttl_seconds: 300 }, "invalid or expired"],
])("fails closed on login status %s and invalid credentials without copying data or printing secrets", async (status, body, message) => {
  loginStatus = status;
  loginBody = body;
  const result = await backup();
  expect(result.status).toBe(1);
  expect(result.output).toContain(message);
  expect(result.output).not.toContain(TOKEN);
  expect(result.output).not.toContain(PASSWORD);
  expect(calls).toHaveLength(1);
  expect(readdirSync(path.join(directory, "private"))).toEqual(["bucket"]);
});

it("rejects a server-expired login and leaves no published or partial dump", async () => {
  pg.sql("alter role cli_login_fixture valid until '2000-01-01'");
  const result = await backup();
  expect(result.status).toBe(1);
  expect(result.output).toContain("pg_dump exited 1");
  expect(result.output).not.toContain(PASSWORD);
  expect(calls).toHaveLength(1);
  expect(readdirSync(path.join(directory, "private"))).toEqual(["bucket"]);
});

it("refuses insufficient schema access instead of publishing a partial backup", async () => {
  pg.sql("revoke pg_read_all_data from supabase_read_only_user");
  try {
    const result = await backup();
    expect(result.status).toBe(1);
    expect(result.output).toContain("pg_dump exited 1");
    expect(calls).toHaveLength(1);
    expect(readdirSync(path.join(directory, "private"))).toEqual(["bucket"]);
  } finally {
    pg.sql("grant pg_read_all_data to supabase_read_only_user");
  }
});

it("keeps the password mode and performs no management request", async () => {
  const result = await backup({ PUBMAX_BACKUP_DB_AUTH: "password", PUBMAX_BACKUP_DB_URL: `postgres://postgres:fixture-original@db.${REF}.supabase.co:5432/postgres` });
  expect(result.status, result.output).toBe(0);
  expect(calls.every((call) => call.url.startsWith("/storage/"))).toBe(true);
});

it("uses the returned login with the project suffix through a session pooler", async () => {
  const result = await backup({ PUBMAX_BACKUP_DB_URL: `postgres://postgres.${REF}@aws-0-eu-west-2.pooler.supabase.com:5432/postgres` });
  expect(result.status, result.output).toBe(0);
  expect(calls[0]?.url).toBe(`/v1/projects/${REF}/cli/login-role`);
});

it("keeps only the last good dump, and removes older dumps, photos and identifiers before a refused renewal", async () => {
  const fixture = retentionFixture();
  loginStatus = 403;
  const result = await backup();
  expect(result.status).toBe(1);
  expectExpiredArtifactsRemoved(fixture, { lastGoodKept: true });
  expect(existsSync(fixture.versionsFile)).toBe(false);
  expect(readdirSync(fixture.privateDir).sort()).toEqual(["bucket", LAST_GOOD_2000]);
  expect(result.output).toContain("past the 8-week maximum");
  expect(readdirSync(fixture.bucketRoot)).toEqual([]);
  expect(calls).toHaveLength(1);
  expect(result.output).not.toContain(TOKEN);
  expect(result.output).not.toContain(PASSWORD);
});

it.each([
  [403, { message: TOKEN }],
  [201, { role: "postgres", password: PASSWORD, ttl_seconds: 300 }],
  [201, { role: "cli_login_fixture", password: PASSWORD, ttl_seconds: 0 }],
])("preserves an unexpired fallback while expiring old data on refused or invalid renewal %s", async (status, body) => {
  const fixture = retentionFixture(true);
  loginStatus = status;
  loginBody = body;

  const result = await backup();

  expect(result.status).toBe(1);
  expectExpiredArtifactsRemoved(fixture);
  expectFallbackRetained(fixture);
  expect(calls).toHaveLength(1);
  expect(result.output).not.toContain(TOKEN);
  expect(result.output).not.toContain(PASSWORD);
});

it("keeps the last good fallback that reaches eight weeks while a failed renewal is in progress, and says so", async () => {
  const now = Date.now();
  const fixture = retentionFixture(true, now);
  const redirect = path.join(directory, "redirect.mjs");
  writeFileSync(redirect, `${readFileSync(redirect, "utf8")}
const fixtureFetch = globalThis.fetch;
Date.now = () => ${now};
globalThis.fetch = async (...args) => {
  const response = await fixtureFetch(...args);
  Date.now = () => ${now + 5 * 24 * 60 * 60 * 1000};
  return response;
};
`);
  loginStatus = 403;

  const result = await backup();

  expect(result.status).toBe(1);
  expect(filesAtRenewal).toContain(path.basename(fixture.fallbackDump));
  expectFallbackRetained(fixture);
  expect(result.output).toContain("past the 8-week maximum");
});

it("keeps the unexpired fallback and removes partial output when the actual dump fails", async () => {
  const fixture = retentionFixture(true);
  pg.sql("revoke pg_read_all_data from supabase_read_only_user");
  try {
    const result = await backup();
    expect(result.status).toBe(1);
    expect(result.output).toContain("pg_dump exited 1");
    expectExpiredArtifactsRemoved(fixture);
    expectFallbackRetained(fixture);
    expect(calls).toHaveLength(1);
  } finally {
    pg.sql("grant pg_read_all_data to supabase_read_only_user");
  }
});

it.each(["listing", "download"])("keeps the unexpired complete fallback when Storage %s fails on repeated runs", async (failure) => {
  const fixture = retentionFixture(true);
  if (failure === "listing") storageListStatus = 503;
  else storageDownloadStatus = 503;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await backup();
    expect(result.status).toBe(1);
    expect(result.output).toContain("answered 503");
    expectExpiredArtifactsRemoved(fixture);
    expectFallbackRetained(fixture);
    expect(result.output).not.toContain(TOKEN);
    expect(result.output).not.toContain(PASSWORD);
  }
});

it("does not acquire credentials or create the destination during a dry run", async () => {
  const result = await backup({}, ["--dry-run"]);
  expect(result.status, result.output).toBe(0);
  expect(calls).toEqual([]);
  expect(existsSync(path.join(directory, "private"))).toBe(false);
});

it.each([
  { SUPABASE_ACCESS_TOKEN: "" },
  { PUBMAX_BACKUP_DB_AUTH: "wrong-mode" },
  { PUBMAX_BACKUP_DB_URL: PASSWORD },
  { PUBMAX_BACKUP_DB_URL: `postgres://postgres@unrelated.example:5432/postgres` },
  { PUBMAX_BACKUP_DB_URL: `postgres://postgres.otherproject@aws-0-eu-west-2.pooler.supabase.com:5432/postgres` },
  { PUBMAX_BACKUP_DB_URL: `postgres://postgres.${REF}@aws-0-eu-west-2.pooler.supabase.com:6543/postgres` },
  { PUBMAX_BACKUP_DB_URL: `postgres://postgres:${PASSWORD}@db.${REF}.supabase.co:5432/postgres` },
  { PUBMAX_BACKUP_DB_URL: `postgres://postgres@db.${REF}.supabase.co:5432/postgres?options=unsafe` },
])("refuses invalid scoped configuration before network or destination changes: %j", async (overrides) => {
  const result = await backup(overrides);
  expect(result.status).toBe(1);
  expect(calls).toEqual([]);
  expect(existsSync(path.join(directory, "private"))).toBe(false);
  expect(result.output).not.toContain(TOKEN);
  expect(result.output).not.toContain(PASSWORD);
});
