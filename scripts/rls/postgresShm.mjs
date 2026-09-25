/**
 * SysV shared-memory hygiene for throwaway PubMaxxing PostgreSQL clusters.
 *
 * macOS defaults to `kern.sysv.shmmni = 32`. Every postmaster keeps one small
 * interlock segment even when `shared_memory_type=mmap`. Killed vitest workers
 * orphan `postgres -D .../T/pubmax-(pg|rls)-*` under PID 1 and leak segments
 * until `initdb` starts failing across the whole suite.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findPostgresBinary } from "./postgresHost.mjs";

const PUBMAX_DIR_MARKERS = ["/pubmax-pg-", "/pubmax-rls-"];

/**
 * True when a PostgreSQL data directory belongs to this harness (never a
 * developer or system cluster).
 */
export function isPubmaxHarnessDataDir(dataDir) {
  if (!dataDir || typeof dataDir !== "string") return false;
  const normalized = dataDir.replaceAll("\\", "/");
  if (!normalized.startsWith(tmpdir().replaceAll("\\", "/"))) return false;
  return PUBMAX_DIR_MARKERS.some((marker) => normalized.includes(marker));
}

/** Pulls `-D <path>` from a `ps` command line. */
export function postgresDataDirFromCommand(command) {
  const match = /\bpostgres\b[^]*?\s-D\s+(\S+)/.exec(command);
  return match?.[1] ?? null;
}

function listPostgresProcesses() {
  const result = spawnSync(
    "ps",
    ["-A", "-o", "pid=", "-o", "ppid=", "-o", "command="],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || !result.stdout) return [];
  const rows = [];
  for (const line of result.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.includes("postgres")) continue;
    const pid = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(pid)) continue;
    const rest = trimmed.slice(String(pid).length).trim();
    const ppid = Number.parseInt(rest, 10);
    if (!Number.isFinite(ppid)) continue;
    const command = rest.slice(String(ppid).length).trim();
    if (!command.includes("postgres")) continue;
    const dataDir = postgresDataDirFromCommand(command);
    if (!dataDir) continue;
    rows.push({ pid, ppid, dataDir, command });
  }
  return rows;
}

function killPid(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

function waitForPidExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    const waitUntil = Date.now() + 50;
    while (Date.now() < waitUntil) {
      /* spin */
    }
  }
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

/**
 * Stops one throwaway cluster and removes its data directory. Uses
 * `pg_ctl stop -m immediate` first so SysV segments detach cleanly.
 */
export function stopHarnessCluster(dataDir) {
  if (!isPubmaxHarnessDataDir(dataDir)) return;
  const postmasterPid = postmasterPidForDataDir(dataDir);
  const pgCtl = findPostgresBinary("pg_ctl");
  if (pgCtl && existsSync(join(dataDir, "postmaster.pid"))) {
    try {
      execFileSync(pgCtl, ["stop", "-D", dataDir, "-m", "immediate", "-w", "-t", "10"], {
        stdio: "pipe",
      });
    } catch {
      /* fall through to signal the postmaster directly */
    }
  }
  for (const proc of listPostgresProcesses()) {
    if (proc.dataDir === dataDir || proc.dataDir.startsWith(`${dataDir}/`)) {
      killPid(proc.pid, "SIGINT");
      waitForPidExit(proc.pid, 2_000);
      try {
        process.kill(proc.pid, 0);
        killPid(proc.pid, "SIGTERM");
        waitForPidExit(proc.pid, 2_000);
      } catch {
        /* already gone */
      }
      try {
        process.kill(proc.pid, 0);
        killPid(proc.pid, "SIGKILL");
        waitForPidExit(proc.pid, 5_000);
      } catch {
        /* already gone */
      }
    }
  }
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* another reaper may have removed it */
  }
  if (postmasterPid) {
    removeDetachedSegmentsForPids(new Set([postmasterPid]));
  }
}

function parseIpcsSegments() {
  let text;
  try {
    text = execFileSync("ipcs", ["-ma"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return [];
  }
  const segments = [];
  for (const line of text.split("\n")) {
    if (!/^\s*m\s+\d+/.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 12) continue;
    const id = parts[1];
    const nattch = Number.parseInt(parts[8], 10);
    const segsz = Number.parseInt(parts[9], 10);
    const cpid = Number.parseInt(parts[10], 10);
    if (!Number.isFinite(nattch) || !Number.isFinite(cpid)) continue;
    segments.push({ id, nattch, segsz, cpid });
  }
  return segments;
}

/** SysV segments whose creator pid is one of `pids` (macOS `ipcs -ma`). */
export function sysvSegmentsCreatedBy(pids) {
  const creators = new Set(pids);
  return parseIpcsSegments().filter((segment) => creators.has(segment.cpid));
}

function postmasterPidForDataDir(dataDir) {
  let firstLine;
  try {
    firstLine = readFileSync(join(dataDir, "postmaster.pid"), "utf8").split("\n")[0]?.trim() ?? "";
  } catch {
    return null;
  }
  const pid = Number.parseInt(firstLine, 10);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function removeDetachedSegmentsForPids(pids) {
  if (pids.size === 0) return;
  for (const segment of parseIpcsSegments()) {
    if (segment.nattch !== 0) continue;
    if (!pids.has(segment.cpid)) continue;
    try {
      execFileSync("ipcrm", ["-m", segment.id], { stdio: "pipe" });
    } catch {
      /* raced another reaper */
    }
  }
}

function stalePubmaxDataDirs() {
  const root = tmpdir();
  const dirs = [];
  try {
    for (const name of readdirSync(root)) {
      if (!name.startsWith("pubmax-pg-") && !name.startsWith("pubmax-rls-")) continue;
      dirs.push(join(root, name));
    }
  } catch {
    return [];
  }
  return dirs;
}

function harnessProcessUsesDataDir(dataDir) {
  const result = spawnSync("ps", ["-A", "-o", "command="], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) return false;
  return result.stdout.split("\n").some((line) => {
    if (!line.includes(dataDir)) return false;
    return /\b(initdb|postgres)\b/.test(line);
  });
}

/**
 * Kills harness orphans (postmaster parent is init), removes harness data
 * dirs whose recorded postmaster is dead and no initdb or postgres still
 * uses, and reaps their SysV segments. Never touches a cluster whose parent
 * is still alive.
 */
export function sweepPubmaxHarnessOrphans() {
  const killed = new Set();
  for (const proc of listPostgresProcesses()) {
    if (!isPubmaxHarnessDataDir(proc.dataDir)) continue;
    if (proc.ppid !== 1) continue;
    stopHarnessCluster(proc.dataDir);
    killed.add(proc.pid);
  }
  for (const dataDir of stalePubmaxDataDirs()) {
    const postmasterPid = postmasterPidForDataDir(dataDir);
    if (!postmasterPid || pidAlive(postmasterPid)) continue;
    if (harnessProcessUsesDataDir(dataDir)) continue;
    stopHarnessCluster(dataDir);
    killed.add(postmasterPid);
  }
  removeDetachedSegmentsForPids(killed);
}

/* ------------------------------------------------------------------ */
/* Process-lifetime teardown for clusters this Node process boots      */
/* ------------------------------------------------------------------ */

const activeDataDirs = new Set();
let shutdownHooksInstalled = false;

function stopActiveClusters() {
  for (const dataDir of activeDataDirs) stopHarnessCluster(dataDir);
  activeDataDirs.clear();
}

/**
 * A signal listener replaces Node's default termination, so once the clusters
 * are down the signal is raised again, unless another listener owns it, so
 * the default action still kills the process.
 */
function installShutdownHooks() {
  if (shutdownHooksInstalled) return;
  shutdownHooksInstalled = true;
  process.once("exit", stopActiveClusters);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.once(signal, () => {
      stopActiveClusters();
      if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
    });
  }
}

/** Registers a cluster directory for signal and exit teardown. */
export function registerHarnessCluster(dataDir) {
  if (!isPubmaxHarnessDataDir(dataDir)) return;
  installShutdownHooks();
  activeDataDirs.add(dataDir);
}

/** Drops a cluster from exit teardown after a tidy stop(). */
export function unregisterHarnessCluster(dataDir) {
  activeDataDirs.delete(dataDir);
}
