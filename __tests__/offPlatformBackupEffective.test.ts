import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { startPostgres, type PostgresSession } from "./helpers/postgres";
import { findPostgresBinary } from "@/scripts/rls/postgresHost.mjs";
import { dumpFileName } from "@/scripts/lib/offPlatformBackup.mjs";

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
let storageObjects: { id: string; name: string; metadata: { size: number; eTag: string } }[];
let storageDownloads: Record<string, { status: number; body: string }>;
let storageDownloadHooks: Record<string, () => void>;
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
      response.end(JSON.stringify(storageObjects));
    } else if (request.url?.includes("/storage/v1/object/")) {
      const name = request.url.split("/").at(-1)!;
      const download = storageDownloads[name] ?? { status: storageDownloadStatus, body: "photo" };
      storageDownloadHooks[name]?.();
      if (download.status !== 200) {
        response.writeHead(download.status).end(JSON.stringify({ message: "fixture storage failure" }));
        return;
      }
      response.end(download.body);
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not listen.");
  baseUrl = `http://127.0.0.1:${address.port}`;
  const dataDir = pg.sql("show data_directory");
  const owned = {
    workerPid: process.pid,
    postgresPid: Number(readFileSync(path.join(dataDir, "postmaster.pid"), "utf8").split("\n")[0]),
    postgresPort: pg.port,
    postgresDataDir: dataDir,
    storagePort: address.port,
  };
  const receipt = process.env.PUBMAX_BACKUP_FIXTURE_RECEIPT;
  if (receipt) writeFileSync(`${receipt}.owned.json`, JSON.stringify(owned), { mode: 0o600 });
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
  storageObjects = [{ id: "fixture", name: "fixture.jpg", metadata: { size: 5, eTag: "v1" } }];
  storageDownloads = {};
  storageDownloadHooks = {};
  filesAtRenewal = [];
  versionsAtRenewal = {};
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

function expectExpiredArtifactsRemoved(fixture: ReturnType<typeof retentionFixture>) {
  for (const file of fixture.expired) expect(existsSync(file)).toBe(false);
  expect(existsSync(path.join(fixture.bucketRoot, "expired-account"))).toBe(false);
  expect(existsSync(path.join(fixture.bucketRoot, "empty-account"))).toBe(false);
  expect(filesAtRenewal.some((file) => file.includes("expired-account") || file.includes("200001") || file.includes("empty-account"))).toBe(false);
  expect(JSON.stringify(versionsAtRenewal)).not.toContain("expired-account");
}

function expectFallbackRetained(fixture: ReturnType<typeof retentionFixture>) {
  expect(readFileSync(fixture.fallbackDump, "utf8")).toBe("fixture-fallback-dump");
  expect(readFileSync(fixture.fallbackPhoto, "utf8")).toBe("fixture-fallback-photo");
  expect(JSON.parse(readFileSync(fixture.versionsFile, "utf8"))).toEqual({ "fallback-account/photo.jpg": "fallback-version" });
  expect(readdirSync(fixture.privateDir).filter((file) => file.endsWith(".dump"))).toEqual([path.basename(fixture.fallbackDump)]);
  expect(readdirSync(fixture.privateDir).some((file) => file.endsWith(".partial"))).toBe(false);
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

it("removes expired newest dumps, photos and identifiers before a refused renewal with no fallback", async () => {
  const fixture = retentionFixture();
  loginStatus = 403;
  const result = await backup();
  expect(result.status).toBe(1);
  expectExpiredArtifactsRemoved(fixture);
  expect(existsSync(fixture.versionsFile)).toBe(false);
  expect(readdirSync(fixture.privateDir)).toEqual(["bucket"]);
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

it("expires a fallback that reaches eight weeks while a failed renewal is in progress", async () => {
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
  expect(existsSync(fixture.fallbackDump)).toBe(false);
  expect(existsSync(fixture.fallbackPhoto)).toBe(false);
  expect(existsSync(fixture.versionsFile)).toBe(false);
  expect(readdirSync(fixture.bucketRoot)).toEqual([]);
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

it("preserves the previous complete generation when a later photo download fails", async () => {
  expect((await backup()).status).toBe(0);
  const privateDir = path.join(directory, "private");
  const dump = path.join(privateDir, readdirSync(privateDir).find((file) => file.endsWith(".dump"))!);
  const photo = path.join(privateDir, "bucket/pint-drops/fixture.jpg");
  const versions = path.join(privateDir, "bucket/pint-drops.versions.json");
  const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
  const original = { dump: hash(dump), photo: hash(photo), versions: hash(versions), photoMtime: statSync(photo).mtimeMs };
  const archiveList = execFileSync(findPostgresBinary("pg_restore")!, ["--list", dump], { encoding: "utf8" });
  for (const entry of ["public profiles", "auth users", "storage objects", "supabase_migrations schema_migrations"]) {
    expect(archiveList).toContain(`TABLE DATA ${entry}`);
  }
  storageObjects = [
    { id: "fixture", name: "fixture.jpg", metadata: { size: 17, eTag: "v2" } },
    { id: "later", name: "later.jpg", metadata: { size: 5, eTag: "later-v1" } },
  ];
  storageDownloads = {
    "fixture.jpg": { status: 200, body: "replacement-photo" },
    "later.jpg": { status: 503, body: "" },
  };

  const result = await backup();

  const actual = { dump: hash(dump), photo: hash(photo), versions: hash(versions), photoMtime: statSync(photo).mtimeMs };
  const metadata = {
    privateDir,
    cliStatus: result.status,
    successfulReplacementRequested: calls.filter((call) => call.url.endsWith("/fixture.jpg")).length === 2,
    laterFailureRequested: calls.some((call) => call.url.endsWith("/later.jpg")),
    archiveSchemaCount: 4,
    original,
    actual,
    completeDumps: readdirSync(privateDir).filter((file) => file.endsWith(".dump")).length,
    partialDumps: readdirSync(privateDir).filter((file) => file.endsWith(".partial")).length,
    stagingDirectories: readdirSync(privateDir).filter((file) => file.startsWith(".backup-stage-")).length,
  };
  const receipt = process.env.PUBMAX_BACKUP_FIXTURE_RECEIPT;
  if (receipt) writeFileSync(receipt, JSON.stringify(metadata), { mode: 0o600 });
  expect(result.status).toBe(1);
  expect(result.output).toContain("answered 503");
  expect(actual.dump).toBe(original.dump);
  expect(actual.versions).toBe(original.versions);
  expect(actual.photo, "The previous photo bytes must stay paired with the complete dump").toBe(original.photo);
  expect(actual.photoMtime).toBe(original.photoMtime);
  expect(readdirSync(privateDir).some((file) => file.endsWith(".partial"))).toBe(false);
  expect(readdirSync(privateDir).some((file) => file.startsWith(".backup-stage-"))).toBe(false);
});

it("publishes the new complete generation only after every photo download succeeds", async () => {
  expect((await backup()).status).toBe(0);
  const privateDir = path.join(directory, "private");
  const photo = path.join(privateDir, "bucket/pint-drops/fixture.jpg");
  const versions = path.join(privateDir, "bucket/pint-drops.versions.json");
  const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
  const original = { photo: hash(photo), versions: hash(versions) };
  let originalVisibleAtLastDownload = false;
  storageObjects = [
    { id: "fixture", name: "fixture.jpg", metadata: { size: 17, eTag: "v2" } },
    { id: "later", name: "later.jpg", metadata: { size: 5, eTag: "later-v1" } },
  ];
  storageDownloads = { "fixture.jpg": { status: 200, body: "replacement-photo" } };
  storageDownloadHooks["later.jpg"] = () => {
    originalVisibleAtLastDownload = hash(photo) === original.photo && hash(versions) === original.versions;
  };

  const result = await backup();

  expect(result.status, result.output).toBe(0);
  expect(originalVisibleAtLastDownload).toBe(true);
  expect(hash(photo)).toBe(createHash("sha256").update("replacement-photo").digest("hex"));
  expect(hash(versions)).not.toBe(original.versions);
  const later = path.join(privateDir, "bucket/pint-drops/later.jpg");
  expect(statSync(later).mode & 0o777).toBe(0o600);
  expect(statSync(photo).mode & 0o777).toBe(0o600);
  const dump = path.join(privateDir, readdirSync(privateDir).find((file) => file.endsWith(".dump"))!);
  expect(execFileSync(findPostgresBinary("pg_restore")!, ["--list", dump], { encoding: "utf8" })).toContain("TABLE DATA");
  expect(readdirSync(privateDir).some((file) => file.startsWith(".backup-stage-") || file.endsWith(".partial"))).toBe(false);
});

it("rolls back photos and version metadata when the final dump publication fails", async () => {
  expect((await backup()).status).toBe(0);
  const privateDir = path.join(directory, "private");
  const currentDump = path.join(privateDir, readdirSync(privateDir).find((file) => file.endsWith(".dump"))!);
  const dump = path.join(privateDir, dumpFileName(new Date(Date.now() - 24 * 60 * 60 * 1000)));
  renameSync(currentDump, dump);
  const photo = path.join(privateDir, "bucket/pint-drops/fixture.jpg");
  const versions = path.join(privateDir, "bucket/pint-drops.versions.json");
  const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
  const original = { dump: hash(dump), photo: hash(photo), versions: hash(versions), mtime: statSync(photo).mtimeMs };
  storageObjects = [
    { id: "fixture", name: "fixture.jpg", metadata: { size: 17, eTag: "v2" } },
    { id: "later", name: "later.jpg", metadata: { size: 5, eTag: "later-v1" } },
  ];
  storageDownloads = { "fixture.jpg": { status: 200, body: "replacement-photo" } };
  storageDownloadHooks["later.jpg"] = () => {
    const partial = readdirSync(privateDir).find((file) => file.endsWith(".dump.partial"))!;
    // A real filesystem refusal after photo and metadata promotion, not a mocked rename.
    mkdirSync(path.join(privateDir, partial.slice(0, -".partial".length)));
  };

  const result = await backup();

  expect(result.status).toBe(1);
  expect(result.output).toContain("publication failed");
  expect(hash(dump)).toBe(original.dump);
  expect(hash(photo)).toBe(original.photo);
  expect(statSync(photo).mtimeMs).toBe(original.mtime);
  expect(hash(versions)).toBe(original.versions);
  expect(existsSync(path.join(privateDir, "bucket/pint-drops/later.jpg"))).toBe(false);
  expect(execFileSync(findPostgresBinary("pg_restore")!, ["--list", dump], { encoding: "utf8" })).toContain("TABLE DATA");
  expect(readdirSync(privateDir).some((file) => file.startsWith(".backup-stage-") || file.endsWith(".partial"))).toBe(false);
});

it("preserves mapped original photos and metadata when photo restoration fails after index restoration", async () => {
  expect((await backup()).status).toBe(0);
  const privateDir = path.join(directory, "private");
  const currentDump = path.join(privateDir, readdirSync(privateDir).find((file) => file.endsWith(".dump"))!);
  const dump = path.join(privateDir, dumpFileName(new Date(Date.now() - 24 * 60 * 60 * 1000)));
  renameSync(currentDump, dump);
  const photo = path.join(privateDir, "bucket/pint-drops/fixture.jpg");
  const versions = path.join(privateDir, "bucket/pint-drops.versions.json");
  const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
  const original = { dump: hash(dump), photo: hash(photo), versions: hash(versions), mtime: statSync(photo).mtimeMs };
  storageObjects = [{ id: "fixture", name: "fixture.jpg", metadata: { size: 17, eTag: "v2" } }];
  storageDownloads = { "fixture.jpg": { status: 200, body: "replacement-photo" } };
  storageDownloadHooks["fixture.jpg"] = () => {
    const partial = readdirSync(privateDir).find((file) => file.endsWith(".dump.partial"))!;
    mkdirSync(path.join(privateDir, partial.slice(0, -".partial".length)));
  };
  const seamReceipt = path.join(directory, "restore-seam.json");
  const indexTimestamp = new Date(Math.floor(statSync(versions).mtimeMs));
  utimesSync(versions, indexTimestamp, indexTimestamp);
  const originalIndexMtime = statSync(versions).mtimeMs;
  const redirect = path.join(directory, "redirect.mjs");
  writeFileSync(redirect, `${readFileSync(redirect, "utf8")}
import fixtureFs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const fixtureRename = fixtureFs.renameSync;
let indexRestored = false;
fixtureFs.renameSync = (from, to) => {
  if (String(from).includes('/previous-') && to === ${JSON.stringify(photo)}) {
    if (!indexRestored) throw new Error('Fixture restoration order changed');
    fixtureFs.mkdirSync(to);
    fixtureFs.writeFileSync(${JSON.stringify(seamReceipt)}, JSON.stringify({ indexRestored, photoRestoreAttempted: true }), { mode: 0o600 });
  }
  const result = fixtureRename(from, to);
  if (String(from).includes('/previous-') && to === ${JSON.stringify(versions)}) indexRestored = true;
  return result;
};
syncBuiltinESMExports();
`);

  const result = await backup();

  expect(result.status).toBe(1);
  expect(result.output).toContain("rollback failed");
  expect(JSON.parse(readFileSync(seamReceipt, "utf8"))).toEqual({ indexRestored: true, photoRestoreAttempted: true });
  const stage = path.join(privateDir, readdirSync(privateDir).find((file) => file.startsWith(".backup-stage-"))!);
  const stagedPhoto = path.join(stage, "photos/fixture.jpg");
  const stagedVersions = path.join(stage, "versions.json");
  const files = readdirSync(stage, { recursive: true }).filter((name) => statSync(path.join(stage, name)).isFile());
  const metadata = {
    privateDir, cliStatus: result.status, seam: JSON.parse(readFileSync(seamReceipt, "utf8")), original,
    dumpHash: hash(dump), publishedIndexExists: existsSync(versions),
    publishedIndexHash: existsSync(versions) ? hash(versions) : null,
    stagedFiles: files.map((name) => ({ name, hash: hash(path.join(stage, name)), mtime: statSync(path.join(stage, name)).mtimeMs })),
    mappedPhotoExists: existsSync(stagedPhoto), originalIndexExists: existsSync(stagedVersions),
  };
  const receipt = process.env.PUBMAX_BACKUP_FIXTURE_RECEIPT;
  if (receipt) writeFileSync(receipt, JSON.stringify(metadata), { mode: 0o600 });
  expect(hash(dump)).toBe(original.dump);
  expect(existsSync(stagedVersions), "Original index must survive the finally pruning pass").toBe(true);
  expect(hash(stagedVersions)).toBe(original.versions);
  expect(JSON.parse(readFileSync(stagedVersions, "utf8"))).toEqual({ "fixture.jpg": "v1" });
  expect(existsSync(stagedPhoto), "Original photo must retain its object-path mapping").toBe(true);
  expect(hash(stagedPhoto)).toBe(original.photo);
  expect(statSync(stagedPhoto).mtimeMs).toBe(original.mtime);
  expect(statSync(stagedVersions).mtimeMs).toBe(originalIndexMtime);
  expect(statSync(stage).mode & 0o777).toBe(0o700);
  expect(statSync(stagedPhoto).mode & 0o777).toBe(0o600);
  expect(statSync(stagedVersions).mode & 0o777).toBe(0o600);
  expect(readdirSync(privateDir).some((file) => file.endsWith(".partial"))).toBe(false);

  // Remove only the injected dump obstruction before the next actual preflight.
  const blockedDump = readdirSync(privateDir).find((file) => file.endsWith(".dump") && statSync(path.join(privateDir, file)).isDirectory())!;
  rmSync(path.join(privateDir, blockedDump), { recursive: true });
  const expiry = Math.max(original.mtime, originalIndexMtime) + 56 * 24 * 60 * 60 * 1000;
  writeFileSync(redirect, `${readFileSync(redirect, "utf8")}\nDate.now = () => ${expiry};\n`);
  const expired = await backup({ SUPABASE_ACCESS_TOKEN: "" });
  expect(expired.status).toBe(1);
  expect(expired.output).toContain("SUPABASE_ACCESS_TOKEN is not set.");
  expect(existsSync(stagedPhoto)).toBe(false);
  expect(existsSync(stagedVersions)).toBe(false);
  expect(existsSync(stage)).toBe(false);
});

it("expires abandoned photo staging at eight weeks while retaining unexpired staged originals", async () => {
  const now = Date.now();
  const fixture = retentionFixture(true);
  const stage = path.join(fixture.privateDir, ".backup-stage-fixture");
  mkdirSync(stage, { mode: 0o700 });
  const expired = path.join(stage, "expired-original");
  const retained = path.join(stage, "unexpired-original");
  writeFileSync(expired, "expired-fixture", { mode: 0o600 });
  writeFileSync(retained, "retained-fixture", { mode: 0o600 });
  const cutoff = new Date(now - 56 * 24 * 60 * 60 * 1000);
  utimesSync(expired, cutoff, cutoff);
  const unexpired = new Date(now - 52 * 24 * 60 * 60 * 1000);
  utimesSync(retained, unexpired, unexpired);
  const redirect = path.join(directory, "redirect.mjs");
  writeFileSync(redirect, `${readFileSync(redirect, "utf8")}\nDate.now = () => ${now};\n`);

  const result = await backup({ SUPABASE_ACCESS_TOKEN: "" });

  expect(result.status).toBe(1);
  expect(calls).toHaveLength(0);
  expect(existsSync(expired)).toBe(false);
  expect(existsSync(retained)).toBe(true);
  expectFallbackRetained(fixture);
});

it("does not acquire credentials or create the destination during a dry run", async () => {
  const result = await backup({}, ["--dry-run"]);
  expect(result.status, result.output).toBe(0);
  expect(calls).toEqual([]);
  expect(existsSync(path.join(directory, "private"))).toBe(false);
});

const invalidScopedConfigurations: Partial<NodeJS.ProcessEnv>[] = [
  { PUBMAX_BACKUP_DB_AUTH: "password", PUBMAX_BACKUP_DB_URL: "" },
  { PUBMAX_BACKUP_DB_AUTH: "password", PUBMAX_BACKUP_DB_URL: PASSWORD },
  { PUBMAX_BACKUP_DB_AUTH: "password", SUPABASE_URL: "" },
  { PUBMAX_BACKUP_DB_AUTH: "password", SUPABASE_SERVICE_ROLE_KEY: "" },
  { PUBMAX_BACKUP_DB_AUTH: "", SUPABASE_SERVICE_ROLE_KEY: "" },
  { PUBMAX_BACKUP_DB_URL: "" },
  { SUPABASE_URL: "" },
  { SUPABASE_SERVICE_ROLE_KEY: "" },
  { SUPABASE_ACCESS_TOKEN: "" },
  { PUBMAX_BACKUP_DB_AUTH: "wrong-mode" },
  { PUBMAX_BACKUP_DB_URL: PASSWORD },
  { SUPABASE_URL: "https://unrelated.example" },
  { PUBMAX_BACKUP_DB_URL: `postgres://postgres@unrelated.example:5432/postgres` },
  { PUBMAX_BACKUP_DB_URL: `postgres://postgres.otherproject@aws-0-eu-west-2.pooler.supabase.com:5432/postgres` },
  { PUBMAX_BACKUP_DB_URL: `postgres://postgres.${REF}@aws-0-eu-west-2.pooler.supabase.com:6543/postgres` },
  { PUBMAX_BACKUP_DB_URL: `postgres://postgres:${PASSWORD}@db.${REF}.supabase.co:5432/postgres` },
  { PUBMAX_BACKUP_DB_URL: `postgres://postgres@db.${REF}.supabase.co:5432/postgres?options=unsafe` },
];

it.each(invalidScopedConfigurations)("refuses invalid scoped configuration before network or creating a destination: %j", async (overrides) => {
  const result = await backup(overrides);
  expect(result.status).toBe(1);
  expect(calls).toEqual([]);
  expect(existsSync(path.join(directory, "private"))).toBe(false);
  expect(result.output).not.toContain(TOKEN);
  expect(result.output).not.toContain(PASSWORD);
});

it.each(invalidScopedConfigurations.flatMap((overrides) => [false, true].map((withFallback) => ({ overrides, withFallback }))))(
  "prunes existing expired artifacts before credential preflight with fallback=$withFallback: $overrides",
  async ({ overrides, withFallback }) => {
    const fixture = retentionFixture(withFallback);

    const result = await backup(overrides);

    expect(result.status).toBe(1);
    expect(calls).toEqual([]);
    expectExpiredArtifactsRemoved(fixture);
    expect(existsSync(fixture.privateDir)).toBe(true);
    if (withFallback) expectFallbackRetained(fixture);
    else {
      expect(existsSync(fixture.versionsFile)).toBe(false);
      expect(readdirSync(fixture.privateDir)).toEqual(["bucket"]);
      expect(readdirSync(fixture.bucketRoot)).toEqual([]);
    }
    expect(result.output).not.toContain(TOKEN);
    expect(result.output).not.toContain(PASSWORD);
  },
);

it("prunes expired dumps before missing-token refusal when the existing destination has no photo directory", async () => {
  const fixture = retentionFixture();
  rmSync(fixture.bucketRoot, { recursive: true });

  const result = await backup({ SUPABASE_ACCESS_TOKEN: "" });

  expect(result.status).toBe(1);
  expect(result.output).toContain("SUPABASE_ACCESS_TOKEN is not set.");
  expect(calls).toEqual([]);
  expectExpiredArtifactsRemoved(fixture);
  expect(existsSync(fixture.versionsFile)).toBe(false);
  expect(existsSync(fixture.privateDir)).toBe(true);
});

it("leaves existing expired artifacts and the fallback unchanged during a dry run", async () => {
  const fixture = retentionFixture(true);
  const files = [...fixture.expired, fixture.versionsFile, fixture.fallbackDump, fixture.fallbackPhoto];
  const before = files.map((file) => ({ file, bytes: readFileSync(file), stat: statSync(file) }));

  const result = await backup({}, ["--dry-run"]);

  expect(result.status, result.output).toBe(0);
  expect(calls).toEqual([]);
  before.forEach(({ file, bytes, stat }) => {
    expect(readFileSync(file)).toEqual(bytes);
    expect(statSync(file).mtimeMs).toBe(stat.mtimeMs);
    expect(statSync(file).mode).toBe(stat.mode);
  });
  expect(existsSync(path.join(fixture.bucketRoot, "empty-account"))).toBe(true);
});

it("refuses an existing repository destination before pruning or credential preflight", async () => {
  const fixture = retentionFixture(true);
  execFileSync("git", ["init", fixture.privateDir], { stdio: "ignore" });

  const result = await backup({ SUPABASE_ACCESS_TOKEN: "" });

  expect(result.status).toBe(1);
  expect(result.output).toContain("PUBMAX_BACKUP_DIR is inside a git checkout.");
  expect(calls).toEqual([]);
  for (const file of fixture.expired) expect(existsSync(file)).toBe(true);
  expect(readFileSync(fixture.fallbackDump, "utf8")).toBe("fixture-fallback-dump");
  expect(readFileSync(fixture.fallbackPhoto, "utf8")).toBe("fixture-fallback-photo");
  expect(JSON.parse(readFileSync(fixture.versionsFile, "utf8"))).toEqual({
    "expired-account/photo.jpg": "expired-version",
    "fallback-account/photo.jpg": "fallback-version",
  });
});
