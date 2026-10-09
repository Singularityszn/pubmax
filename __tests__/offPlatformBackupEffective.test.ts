import { execFile, execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { startPostgres, type PostgresSession } from "./helpers/postgres";
import { findPostgresBinary } from "@/scripts/rls/postgresHost.mjs";

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
      response.writeHead(loginStatus).end(JSON.stringify(loginBody));
    } else if (request.url?.includes("/object/list/")) {
      response.end(JSON.stringify([{ id: "fixture", name: "fixture.jpg", metadata: { size: 5, eTag: "v1" } }]));
    } else if (request.url?.endsWith("/fixture.jpg")) {
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
  pg.sql(`alter role cli_login_fixture password '${PASSWORD}' valid until 'infinity'`);
  const bin = path.join(directory, "bin");
  mkdirSync(bin);
  // These wrappers use real PostgreSQL clients against the disposable cluster.
  // Only the network endpoint and fixture TLS setting change, never dump arguments.
  for (const command of ["pg_dump", "pg_restore"] as const) {
    writeFileSync(path.join(bin, command), `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
if (process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PUBMAX_BACKUP_DB_URL) process.exit(90);
const result = spawnSync(${JSON.stringify(findPostgresBinary(command))}, process.argv.slice(2), {
  env: { ...process.env, PGHOST: '127.0.0.1', PGPORT: '${pg.port}', PGDATABASE: '${pg.database}', PGSSLMODE: 'disable' },
  stdio: 'inherit'
});
process.exit(result.status ?? 91);
`, { mode: 0o700 });
  }
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

it("renews a read-only login and backs up all four schemas and private Storage through the executable", async () => {
  const result = await backup();
  expect(result.status, result.output).toBe(0);
  expect(calls[0]).toEqual({ url: `/v1/projects/${REF}/cli/login-role`, body: '{"read_only":true}', authorization: `Bearer ${TOKEN}` });
  const privateDir = path.join(directory, "private");
  const dump = readdirSync(privateDir).find((file) => file.endsWith(".dump"))!;
  const dumpPath = path.join(privateDir, dump);
  // No restore occurs. Decode the fixture archive into memory for coverage proof.
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

it("preserves the newest backup and prunes older expired copies even when credential renewal fails", async () => {
  const privateDir = path.join(directory, "private");
  mkdirSync(path.join(privateDir, "bucket/pint-drops"), { recursive: true });
  const old = path.join(privateDir, "pubmax-20000101T000000Z.dump");
  const newest = path.join(privateDir, "pubmax-20000102T000000Z.dump");
  writeFileSync(old, "fixture-old-dump");
  writeFileSync(newest, "fixture-newest-dump");
  loginStatus = 403;
  const result = await backup();
  expect(result.status).toBe(1);
  expect(existsSync(old)).toBe(false);
  expect(readFileSync(newest, "utf8")).toBe("fixture-newest-dump");
  expect(calls).toHaveLength(1);
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
