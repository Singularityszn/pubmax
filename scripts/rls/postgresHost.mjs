/**
 * The ONE answer to "can this host run an effective proof, and may it start
 * another cluster right now".
 *
 * It is plain ESM with a `.d.mts` sidecar, the `lib/buildInfo.mjs` idiom, for
 * one reason: `scripts/rls/run-session-tests.mjs` and
 * `scripts/rls/session-harness.mjs` are run by plain `node` and cannot import
 * TypeScript, while every proof under `__tests__` reads the same answers
 * through `__tests__/helpers/postgres.ts`. Two copies of this file is how the
 * tree ended up with sixteen skip predicates that disagreed.
 *
 * THE CLUSTER BUDGET is the second half. macOS ships `kern.sysv.shmmni = 32`
 * and every running cluster claims one SysV segment for the postmaster
 * interlock whatever `shared_memory_type` says, so a wide parallel run used to
 * fail a healthy migration with
 *
 *   FATAL:  could not create shared memory segment: No space left on device
 *
 * A slot is a directory, because `mkdir` is the atomic primitive every
 * filesystem already has, and it records the pid that owns it so a killed run
 * frees its budget at once rather than after a timeout.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { sweepPubmaxHarnessOrphans } from "./postgresShm.mjs";

/** Every migration in this tree is proved against PostgreSQL 16. */
export const REQUIRED_POSTGRES_MAJOR = 16;

const BINARY_DIRECTORIES = [
  "/opt/homebrew/opt/postgresql@16/bin",
  "/usr/local/opt/postgresql@16/bin",
  "/usr/lib/postgresql/16/bin",
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
];

const resolvedBinaries = new Map();

function reportsRequiredMajor(candidate) {
  try {
    const version = execFileSync(candidate, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return new RegExp(
      `\\bPostgreSQL\\)?\\s+${REQUIRED_POSTGRES_MAJOR}(?:\\.|\\s|$)`,
      "i",
    ).test(version);
  } catch {
    return false;
  }
}

/** The one place a PostgreSQL binary is looked for. Answers null when absent. */
export function findPostgresBinary(name) {
  if (resolvedBinaries.has(name)) return resolvedBinaries.get(name);
  let answer = null;
  for (const directory of BINARY_DIRECTORIES) {
    const candidate = join(directory, name);
    if (existsSync(candidate) && reportsRequiredMajor(candidate)) {
      answer = candidate;
      break;
    }
  }
  if (answer === null) {
    try {
      const candidate = execFileSync("which", [name], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      if (candidate !== "" && reportsRequiredMajor(candidate)) answer = candidate;
    } catch {
      /* the binary is not on PATH either */
    }
  }
  resolvedBinaries.set(name, answer);
  return answer;
}

/**
 * The ONE reason an effective proof cannot run here, or null when it can.
 *
 * PUBMAX_RLS_NO_PG=1 forces the answer, so the loud-skip path can be proved on
 * a host that does have PostgreSQL installed.
 */
export function missingPostgresReason() {
  if (process.env.PUBMAX_RLS_NO_PG === "1") {
    return (
      `PostgreSQL ${REQUIRED_POSTGRES_MAJOR} binaries not found (initdb/postgres/psql). ` +
      `Install postgresql@${REQUIRED_POSTGRES_MAJOR} to run effective proofs. ` +
      "(PUBMAX_RLS_NO_PG=1 forced this skip.)"
    );
  }
  const missing = ["initdb", "postgres", "psql"].filter(
    (name) => findPostgresBinary(name) === null,
  );
  return missing.length > 0
    ? `PostgreSQL ${REQUIRED_POSTGRES_MAJOR} binaries not found (${missing.join(", ")}). ` +
        `Each binary must report major version ${REQUIRED_POSTGRES_MAJOR}. ` +
        `Install postgresql@${REQUIRED_POSTGRES_MAJOR} to run effective proofs.`
    : null;
}

/**
 * The reason a proof may SKIP rather than fail, or null.
 *
 * There is exactly one such reason: PUBMAX_RLS_NO_PG=1, the deliberate opt-out
 * a host without PostgreSQL sets for itself. An ABSENT PostgreSQL nobody opted
 * out of is NOT a skip: the cluster start throws its diagnosis, the suite goes
 * red, and a green run therefore means the proofs really ran.
 */
export function postgresSkipReason() {
  return process.env.PUBMAX_RLS_NO_PG === "1" ? missingPostgresReason() : null;
}

/* ------------------------------------------------------------------ */
/* The host-wide cluster budget                                        */
/* ------------------------------------------------------------------ */

export const POSTGRES_SLOT_ROOT = join(tmpdir(), "pubmax-postgres-slots");
/**
 * Six live clusters against a macOS default of 32 SysV segments leaves room for
 * everything else on the machine. Raise it only with `ipcs -m` in front of you.
 */
const DEFAULT_MAX_CLUSTERS = 6;
const SLOT_POLL_MS = 120;
const SLOT_WAIT_CEILING_MS = 150_000;

export function maxPostgresClusters() {
  const stated = Number.parseInt(process.env.PUBMAX_PG_MAX_CLUSTERS ?? "", 10);
  return Number.isFinite(stated) && stated > 0 ? stated : DEFAULT_MAX_CLUSTERS;
}

function ownerIsAlive(slot) {
  try {
    const pid = Number.parseInt(readFileSync(join(slot, "owner"), "utf8").trim(), 10);
    if (!Number.isFinite(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function releaseSlotDirectory(slot) {
  try {
    rmSync(slot, { recursive: true, force: true });
  } catch {
    /* another reaper got there first */
  }
}

function reapDeadSlots() {
  let entries = [];
  try {
    entries = readdirSync(POSTGRES_SLOT_ROOT);
  } catch {
    return;
  }
  for (const entry of entries) {
    const slot = join(POSTGRES_SLOT_ROOT, entry);
    if (!ownerIsAlive(slot)) releaseSlotDirectory(slot);
  }
}

function claimSlot() {
  mkdirSync(POSTGRES_SLOT_ROOT, { recursive: true });
  const budget = maxPostgresClusters();
  for (let index = 0; index < budget; index += 1) {
    const slot = join(POSTGRES_SLOT_ROOT, `slot-${index}`);
    try {
      mkdirSync(slot); // atomic: the winner is whoever creates the directory
    } catch {
      continue;
    }
    writeFileSync(join(slot, "owner"), String(process.pid));
    return slot;
  }
  return null;
}

let harnessOrphansSwept = false;

function ensureHarnessOrphansSwept() {
  if (harnessOrphansSwept) return;
  harnessOrphansSwept = true;
  sweepPubmaxHarnessOrphans();
}

/**
 * Takes one of the host's cluster slots and answers how to give it back.
 * Every caller that runs `initdb` must hold one first.
 */
export async function acquireClusterSlot(label = "proof") {
  ensureHarnessOrphansSwept();
  const deadline = Date.now() + SLOT_WAIT_CEILING_MS;
  for (;;) {
    const slot = claimSlot();
    if (slot) {
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        process.off("exit", release);
        releaseSlotDirectory(slot);
      };
      process.once("exit", release);
      return release;
    }
    reapDeadSlots();
    if (Date.now() > deadline) {
      throw new Error(
        `Waited ${Math.round(SLOT_WAIT_CEILING_MS / 1000)}s for one of ` +
          `${maxPostgresClusters()} PostgreSQL cluster slots and none came free ` +
          `(starting "${label}"). Live slots are directories under ` +
          `${POSTGRES_SLOT_ROOT}; each holds the pid that owns it.`,
      );
    }
    await sleep(SLOT_POLL_MS);
  }
}
