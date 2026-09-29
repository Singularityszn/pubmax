import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";
import { findPostgresBinary } from "../scripts/rls/postgresHost.mjs";
import {
  isPubmaxHarnessDataDir,
  postgresDataDirFromCommand,
  stopHarnessCluster,
  sweepPubmaxHarnessOrphans,
  sysvSegmentsCreatedBy,
} from "../scripts/rls/postgresShm.mjs";

const skip = postgresSkipReason();
const serialShmHarness = process.env.PUBMAX_SERIAL_SHM_HARNESS === "1";
const hostTempDir = tmpdir();
let outerTempDir: string;

type PostgresProcess = { pid: number; ppid: number };

/** `ipcs -ma` names a creator pid only in the macOS layout the harness parses. */
const readsSysvCreators = process.platform === "darwin";

function postmasterPidOf(session: PostgresSession): number {
  return Number(session.sql("select split_part(pg_read_file('postmaster.pid'), E'\\n', 1)"));
}

function expectHoldsSegment(pid: number): void {
  if (readsSysvCreators) expect(sysvSegmentsCreatedBy([pid])).not.toEqual([]);
}

function postmasterFor(dataDir: string): PostgresProcess | null {
  const listing = spawnSync("ps", ["-A", "-o", "pid=", "-o", "ppid=", "-o", "command="], {
    encoding: "utf8",
  });
  for (const row of listing.stdout.split("\n")) {
    const [pid, ppid, ...command] = row.trim().split(/\s+/);
    if (postgresDataDirFromCommand(command.join(" ")) !== dataDir) continue;
    return { pid: Number(pid), ppid: Number(ppid) };
  }
  return null;
}

async function waitForPidExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await sleep(100);
  }
  throw new Error(`pid ${pid} outlived its SIGKILL`);
}

function harnessDataDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `pubmax-pg-${label}-`));
}

/**
 * Boots a cluster in a harness data dir through `pg_ctl start`, which
 * daemonizes the postmaster and exits, so the postmaster is parented by init
 * exactly like the cluster of a vitest worker that was killed mid-run.
 */
function startInitParentedCluster(dataDir: string): PostgresProcess {
  const pgCtl = findPostgresBinary("pg_ctl");
  if (!pgCtl) throw new Error("pg_ctl unavailable");
  const options = { stdio: "pipe", env: { ...process.env, LC_ALL: "C" } } as const;
  execFileSync(
    pgCtl,
    [
      "init",
      "-D",
      dataDir,
      "-s",
      "-o",
      "--locale=C -E UTF8 --username=postgres --auth=trust -c shared_memory_type=mmap -c dynamic_shared_memory_type=mmap",
    ],
    options,
  );
  writeFileSync(
    join(dataDir, "postgresql.auto.conf"),
    ["listen_addresses = ''", `unix_socket_directories = '${dataDir}'`].join("\n") + "\n",
  );
  execFileSync(
    pgCtl,
    ["start", "-D", dataDir, "-w", "-s", "-l", join(dataDir, "server.log")],
    options,
  );
  // Another worker can sweep between pg_ctl reporting ready and our first assertion.
  const shm = pathToFileURL(join(process.cwd(), "scripts/rls/postgresShm.mjs")).href;
  execFileSync(
    process.execPath,
    ["--input-type=module", "-e",
      `import { sweepPubmaxHarnessOrphans } from ${JSON.stringify(shm)}; sweepPubmaxHarnessOrphans();`,
    ],
    { ...options, env: { ...options.env, TMPDIR: outerTempDir } },
  );
  const postmaster = postmasterFor(dataDir);
  if (!postmaster) throw new Error(`no postmaster for ${dataDir}`);
  return postmaster;
}

describe("postgres SysV harness hygiene", () => {
  beforeAll(() => {
    // Keep socket paths short, and isolate intentional orphans from other runs.
    outerTempDir = mkdtempSync(join(hostTempDir, "s-"));
    const testTempDir = join(outerTempDir, "t");
    mkdirSync(testTempDir);
    vi.stubEnv("TMPDIR", testTempDir);
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(outerTempDir, { recursive: true, force: true });
  });

  it("recognises harness data directories under the OS temp dir", () => {
    const harnessDir = join(tmpdir(), "pubmax-pg-proof-abc123");
    const otherDir = join(tmpdir(), "not-pubmax-xyz");
    expect(isPubmaxHarnessDataDir(harnessDir)).toBe(true);
    expect(isPubmaxHarnessDataDir(join(tmpdir(), "pubmax-rls-proof-abc123"))).toBe(true);
    expect(isPubmaxHarnessDataDir(join(tmpdir(), "private", "pubmax-pg-proof-abc123"))).toBe(false);
    expect(isPubmaxHarnessDataDir(join(`${tmpdir()}-other`, "pubmax-pg-proof-abc123"))).toBe(false);
    expect(isPubmaxHarnessDataDir(otherDir)).toBe(false);
    expect(isPubmaxHarnessDataDir("/var/lib/postgresql/data")).toBe(false);
  });

  it("parses -D from a postgres command line", () => {
    const dataDir = join(tmpdir(), "pubmax-rls-AAAAAA");
    const command = `/opt/homebrew/opt/postgresql@16/bin/postgres -D ${dataDir} -k ${dataDir}`;
    expect(postgresDataDirFromCommand(command)).toBe(dataDir);
  });

  it.each(["SIGINT", "SIGTERM", "SIGHUP"] as const)(
    "tears down a registered cluster on %s and still lets the signal kill the process",
    async (signal) => {
      const shm = pathToFileURL(join(process.cwd(), "scripts/rls/postgresShm.mjs")).href;
      const script = [
        'import { mkdtempSync } from "node:fs";',
        'import { tmpdir } from "node:os";',
        'import { join } from "node:path";',
        `import { registerHarnessCluster } from ${JSON.stringify(shm)};`,
        'const dataDir = mkdtempSync(join(tmpdir(), "pubmax-pg-signal-"));',
        "registerHarnessCluster(dataDir);",
        'process.stdout.write(dataDir + "\\n");',
        "setInterval(() => {}, 1_000);",
      ].join("\n");
      const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
        stdio: ["ignore", "pipe", "inherit"],
      });
      const exited = new Promise<NodeJS.Signals | null>((resolve) => {
        child.once("exit", (_code, killedBy) => resolve(killedBy));
      });
      const dataDir = await new Promise<string>((resolve) => {
        let out = "";
        child.stdout.on("data", (chunk: Buffer) => {
          out += String(chunk);
          if (out.includes("\n")) resolve(out.trim());
        });
      });
      expect(existsSync(dataDir)).toBe(true);
      child.kill(signal);
      const outcome = await Promise.race([exited, sleep(10_000).then(() => "still running")]);
      if (outcome === "still running") child.kill("SIGKILL");
      expect(outcome).toBe(signal);
      expect(existsSync(dataDir)).toBe(false);
    },
    30_000,
  );

  (skip || !serialShmHarness ? it.skip : it)(
    "sweep reaps an init-parented harness orphan and leaves a live parented cluster alone",
    async () => {
      const live = await startPostgres({ label: "shm-live" });
      const livePid = postmasterPidOf(live);
      const orphanDir = harnessDataDir("shm-orphan");
      try {
        const orphan = startInitParentedCluster(orphanDir);
        expect(orphan.ppid).toBe(1);
        expectHoldsSegment(orphan.pid);

        sweepPubmaxHarnessOrphans();

        expect(postmasterFor(orphanDir)).toBeNull();
        expect(existsSync(orphanDir)).toBe(false);
        expect(sysvSegmentsCreatedBy([orphan.pid])).toEqual([]);
        expect(live.sql("select 1")).toBe("1");
        expectHoldsSegment(livePid);
      } finally {
        stopHarnessCluster(orphanDir);
        await live.stop();
      }
    },
    180_000,
  );

  (skip || !serialShmHarness ? it.skip : it)(
    "leaves no SysV segment behind across one boot and stop",
    async () => {
      const session = await startPostgres({ label: "shm-once" });
      const pid = postmasterPidOf(session);
      expectHoldsSegment(pid);
      await session.stop();
      sweepPubmaxHarnessOrphans();
      expect(sysvSegmentsCreatedBy([pid])).toEqual([]);
    },
    120_000,
  );

  (skip || !serialShmHarness ? it.skip : it)(
    "sweep reclaims the data dir and segment a SIGKILLed cluster left behind",
    async () => {
      const dataDir = harnessDataDir("shm-stale");
      try {
        const postmaster = startInitParentedCluster(dataDir);
        // pg_ctl makes the postmaster a process-group leader, so this kills
        // the backends with it and leaves its segment detached.
        process.kill(-postmaster.pid, "SIGKILL");
        await waitForPidExit(postmaster.pid);
        expect(existsSync(join(dataDir, "postmaster.pid"))).toBe(true);
        expectHoldsSegment(postmaster.pid);

        sweepPubmaxHarnessOrphans();

        expect(existsSync(dataDir)).toBe(false);
        expect(sysvSegmentsCreatedBy([postmaster.pid])).toEqual([]);
      } finally {
        stopHarnessCluster(dataDir);
      }
    },
    180_000,
  );

  (skip || !serialShmHarness ? it.skip : it)(
    "three boot-stop cycles leave no SysV segment behind",
    async () => {
      const pids: number[] = [];
      for (let cycle = 0; cycle < 3; cycle += 1) {
        const session = await startPostgres({ label: `shm-cycle-${cycle}` });
        pids.push(postmasterPidOf(session));
        await session.stop();
        sweepPubmaxHarnessOrphans();
      }
      expect(sysvSegmentsCreatedBy(pids)).toEqual([]);
    },
    360_000,
  );
});
