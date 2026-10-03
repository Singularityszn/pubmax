#!/usr/bin/env node
// Generate types/database.ts from a throwaway PostgreSQL 16 cluster.
//
// The cluster is the RLS harness shape: session fixture, then every migration
// scripts/qa/migration-apply-list.mjs lists, read back with psql. No PostgREST.
// `--check` regenerates in memory and fails when the committed file differs.

import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import { listMigrations } from "../qa/migration-apply-list.mjs";
import {
  acquireClusterSlot,
  findPostgresBinary,
  HARNESS_CLUSTER_SETTINGS,
  missingPostgresReason,
} from "../rls/postgresHost.mjs";
import {
  registerHarnessCluster,
  stopHarnessCluster,
  unregisterHarnessCluster,
} from "../rls/postgresShm.mjs";
import { renderDatabaseTypes } from "./renderDatabaseTypes.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUTPUT = join(REPO_ROOT, "types/database.ts");
const FIXTURE = join(REPO_ROOT, "scripts/rls/session-fixture.sql");
const MIGRATIONS = join(REPO_ROOT, "supabase/migrations");
const INTROSPECT = join(REPO_ROOT, "scripts/db/introspect-public-schema.sql");
const MAX_BUFFER = 64 * 1024 * 1024;

function psqlBase(port, database) {
  return [
    "-h", "127.0.0.1",
    "-p", String(port),
    "-U", "postgres",
    "-d", database,
    "-v", "ON_ERROR_STOP=1",
    "-q",
  ];
}

function runPsql(psql, args) {
  return execFileSync(psql, args, {
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      LC_ALL: "C",
      PAGER: "cat",
      // NOTICE lines are expected while migrations re-apply guards. They are
      // not drift, and a verify log full of them hides a real failure.
      PGOPTIONS: "-c client_min_messages=warning",
    },
  });
}

function applyFile(psql, port, database, file) {
  try {
    runPsql(psql, [...psqlBase(port, database), "-f", file]);
  } catch (error) {
    const stderr = error.stderr?.toString?.() ?? "";
    const stdout = error.stdout?.toString?.() ?? "";
    throw new Error(`psql failed on ${file}:\n${stderr || stdout || error.message}`);
  }
}

async function pickPort() {
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

async function startCluster() {
  const missing = missingPostgresReason();
  if (missing) throw new Error(missing);

  const initdb = findPostgresBinary("initdb");
  const postgres = findPostgresBinary("postgres");
  const psql = findPostgresBinary("psql");
  const releaseClusterSlot = await acquireClusterSlot("db-types");
  const dataDir = mkdtempSync(join(tmpdir(), "pubmax-pg-types-"));
  const port = await pickPort();

  const stop = () => {
    stopHarnessCluster(dataDir);
    unregisterHarnessCluster(dataDir);
    releaseClusterSlot();
  };

  try {
    execFileSync(
      initdb,
      [
        "-D", dataDir,
        "--locale=C",
        "-E", "UTF8",
        "--username=postgres",
        "--auth=trust",
        "-c", "shared_memory_type=mmap",
        "-c", "dynamic_shared_memory_type=mmap",
      ],
      { stdio: "pipe" },
    );
  } catch (error) {
    stop();
    throw error;
  }

  writeFileSync(
    join(dataDir, "postgresql.auto.conf"),
    [
      "listen_addresses = '127.0.0.1'",
      `port = ${port}`,
      "max_connections = 20",
      "shared_buffers = 16MB",
      "shared_memory_type = mmap",
      "dynamic_shared_memory_type = mmap",
      "fsync = off",
      "full_page_writes = off",
      "synchronous_commit = off",
      // The fixture creates supabase_realtime. logical is what that publication
      // expects; the default warns and still creates it.
      "wal_level = logical",
      ...HARNESS_CLUSTER_SETTINGS,
    ].join("\n") + "\n",
  );

  const proc = spawn(
    postgres,
    ["-D", dataDir, "-k", dataDir, "-p", String(port), "-h", "127.0.0.1"],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LC_ALL: "C" } },
  );
  const logs = [];
  proc.stdout?.on("data", (chunk) => logs.push(chunk.toString()));
  proc.stderr?.on("data", (chunk) => logs.push(chunk.toString()));

  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      runPsql(psql, [
        "-h", "127.0.0.1",
        "-p", String(port),
        "-U", "postgres",
        "-d", "postgres",
        "-c", "select 1",
      ]);
      ready = true;
      break;
    } catch {
      await sleep(100);
    }
  }
  if (!ready) {
    stop();
    throw new Error(`Postgres failed to start:\n${logs.join("")}`);
  }

  registerHarnessCluster(dataDir);
  runPsql(psql, [
    "-h", "127.0.0.1",
    "-p", String(port),
    "-U", "postgres",
    "-d", "postgres",
    "-c", "create database pubmax_types",
  ]);

  return { psql, port, stop };
}

function readCatalog(psql, port) {
  let text;
  try {
    text = runPsql(psql, [
      ...psqlBase(port, "pubmax_types"),
      "-t",
      "-A",
      "-f", INTROSPECT,
    ]);
  } catch (error) {
    const stderr = error.stderr?.toString?.() ?? "";
    const stdout = error.stdout?.toString?.() ?? "";
    throw new Error(`catalog introspection failed:\n${stderr || stdout || error.message}`);
  }
  const line = text.trim().split("\n").filter((row) => row.trim().startsWith("{")).at(-1);
  if (!line) throw new Error(`catalog introspection returned no JSON:\n${text.slice(0, 500)}`);
  return JSON.parse(line);
}

export async function generateDatabaseTypes() {
  const cluster = await startCluster();
  try {
    applyFile(cluster.psql, cluster.port, "pubmax_types", FIXTURE);
    const migrations = listMigrations();
    process.stderr.write(`applying ${migrations.length} migrations\n`);
    for (const name of migrations) {
      applyFile(cluster.psql, cluster.port, "pubmax_types", join(MIGRATIONS, name));
    }
    const catalog = readCatalog(cluster.psql, cluster.port);
    return renderDatabaseTypes(catalog);
  } finally {
    cluster.stop();
  }
}

async function main() {
  const check = process.argv.includes("--check");
  const missing = missingPostgresReason();
  if (missing) {
    console.error(missing);
    process.exitCode = 1;
    return;
  }
  const generated = await generateDatabaseTypes();
  if (check) {
    let committed = "";
    try {
      committed = readFileSync(OUTPUT, "utf8");
    } catch {
      committed = "";
    }
    if (committed !== generated) {
      console.error("types/database.ts has drifted from the migrated schema. Run npm run db:types.");
      process.exitCode = 1;
      return;
    }
    console.log("types/database.ts matches the migrated schema.");
    return;
  }
  writeFileSync(OUTPUT, generated);
  console.log(`Wrote ${OUTPUT}`);
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
