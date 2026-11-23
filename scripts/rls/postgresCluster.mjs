/**
 * The ONE way a throwaway PostgreSQL cluster boots. The TypeScript proofs
 * (`__tests__/helpers/postgres.ts`) and the plain-node RLS session harness
 * (`scripts/rls/session-harness.mjs`) both start here.
 *
 * A picked port is only free at the moment it is picked, and `initdb` runs
 * between the pick and the bind, so another worker's cluster can bind it
 * first. The postmaster that lost exits naming the address. Readiness is asked
 * on this cluster's own unix socket, so a cluster that holds the port can
 * never answer for this one: a probe over TCP once let a suite run on another
 * suite's cluster and lose its database when that suite stopped.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  acquireClusterSlot,
  findPostgresBinary,
  HARNESS_CLUSTER_SETTINGS,
  missingPostgresReason,
} from "./postgresHost.mjs";
import {
  registerHarnessCluster,
  stopHarnessCluster,
  unregisterHarnessCluster,
} from "./postgresShm.mjs";

const BOOT_ATTEMPTS = 5;
const LOG_TAIL_LINES = 30;

/** A port the kernel had free a moment ago. Another process may take it before you bind. */
export async function pickPort() {
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

function logTail(log) {
  return log.trim().split("\n").slice(-LOG_TAIL_LINES).join("\n");
}

/** Starts one postmaster on a fresh port, again on a new port if it loses the bind. */
async function bootPostmaster({ postgres, psql, dataDir, settings }) {
  for (let boot = 0; ; boot += 1) {
    const port = await pickPort();
    writeFileSync(
      join(dataDir, "postgresql.auto.conf"),
      [`port = ${port}`, ...settings].join("\n") + "\n",
    );
    const server = spawn(
      postgres,
      ["-D", dataDir, "-k", dataDir, "-p", String(port), "-h", "127.0.0.1"],
      { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LC_ALL: "C" } },
    );
    let log = "";
    const keep = (chunk) => {
      log = (log + String(chunk)).slice(-8_000);
    };
    server.stdout?.on("data", keep);
    server.stderr?.on("data", keep);
    // The exit code can land before the pipes hand over their last lines;
    // "close" waits for both, so the log is whole before it is read.
    const closed = new Promise((resolve) => server.once("close", () => resolve()));

    const probe = ["-h", dataDir, "-p", String(port), "-U", "postgres", "-d", "postgres", "-c", "select 1"];
    for (let attempt = 0; attempt < 300; attempt += 1) {
      if (server.exitCode !== null || server.signalCode !== null) break;
      try {
        execFileSync(psql, probe, { stdio: "pipe" });
        return { server, port, log: () => log, closed };
      } catch {
        await sleep(100);
      }
    }
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGKILL");
      await closed;
      throw new Error(`PostgreSQL failed to start:\n${log.trim()}`);
    }
    await Promise.race([closed, sleep(2_000)]);
    if (boot + 1 < BOOT_ATTEMPTS && /Address already in use/.test(log)) continue;
    throw new Error(
      `PostgreSQL exited with code ${server.exitCode ?? server.signalCode} before accepting connections.\n${log.trim()}`,
    );
  }
}

/**
 * Boots a throwaway PostgreSQL 16 cluster inside one of the host's cluster
 * slots. `stop()` tears it down and gives the slot back. If the server dies
 * before `stop()`, the tail of its log goes to stderr, so the failure names
 * its cause.
 */
export async function startHarnessCluster({ label = "proof", maxConnections = 24 } = {}) {
  const reason = missingPostgresReason();
  if (reason) throw new Error(reason);
  const initdb = findPostgresBinary("initdb");
  const postgres = findPostgresBinary("postgres");
  const psql = findPostgresBinary("psql");
  if (!initdb || !postgres || !psql) throw new Error("PostgreSQL binaries unavailable.");

  const releaseSlot = await acquireClusterSlot(label);
  let dataDir = null;
  try {
    // The data directory holds the unix socket, and PostgreSQL refuses a
    // socket path over 103 bytes, so the label is trimmed here.
    dataDir = mkdtempSync(join(tmpdir(), `pubmax-pg-${label.slice(0, 12)}-`));
    execFileSync(
      initdb,
      [
        "-D", dataDir, "--locale=C", "-E", "UTF8", "--username=postgres", "--auth=trust",
        // mmap keeps the parallel-worker segments off the SysV table; the tiny
        // postmaster interlock segment is the one the host budget counts.
        "-c", "shared_memory_type=mmap", "-c", "dynamic_shared_memory_type=mmap",
      ],
      { stdio: "pipe" },
    );
    const { server, port, log } = await bootPostmaster({
      postgres,
      psql,
      dataDir,
      settings: [
        "listen_addresses = '127.0.0.1'",
        `max_connections = ${maxConnections}`,
        "shared_buffers = 16MB",
        "shared_memory_type = mmap",
        "dynamic_shared_memory_type = mmap",
        "fsync = off",
        "full_page_writes = off",
        "synchronous_commit = off",
        ...HARNESS_CLUSTER_SETTINGS,
      ],
    });
    registerHarnessCluster(dataDir);

    let stopping = false;
    server.once("close", (code, signal) => {
      if (stopping) return;
      console.error(
        `PostgreSQL "${label}" on port ${port} stopped before its suite did ` +
          `(exit ${code ?? signal}). Last server log:\n${logTail(log())}`,
      );
    });

    const ownDataDir = dataDir;
    const stop = () => {
      stopping = true;
      try {
        stopHarnessCluster(ownDataDir);
        unregisterHarnessCluster(ownDataDir);
      } finally {
        // The slot is the host's budget, so it goes back even when the cluster
        // refused to die tidily.
        releaseSlot();
      }
    };
    return { psql, port, dataDir: ownDataDir, stop };
  } catch (error) {
    if (dataDir) {
      stopHarnessCluster(dataDir);
      unregisterHarnessCluster(dataDir);
    }
    releaseSlot();
    throw error;
  }
}
