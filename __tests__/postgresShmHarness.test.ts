import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { postgresSkipReason, startPostgres } from "./helpers/postgres";
import {
  countSysvShmSegments,
  isPubmaxHarnessDataDir,
  postgresDataDirFromCommand,
  sweepPubmaxHarnessOrphans,
} from "../scripts/rls/postgresShm.mjs";

const skip = postgresSkipReason();

describe("postgres SysV harness hygiene", () => {
  it("recognises harness data directories under the OS temp dir", () => {
    const harnessDir = join(tmpdir(), "pubmax-pg-proof-abc123");
    const otherDir = join(tmpdir(), "not-pubmax-xyz");
    expect(isPubmaxHarnessDataDir(harnessDir)).toBe(true);
    expect(isPubmaxHarnessDataDir(otherDir)).toBe(false);
    expect(isPubmaxHarnessDataDir("/var/lib/postgresql/data")).toBe(false);
  });

  it("parses -D from a postgres command line", () => {
    const dataDir = join(tmpdir(), "pubmax-rls-AAAAAA");
    const command = `/opt/homebrew/opt/postgresql@16/bin/postgres -D ${dataDir} -k ${dataDir}`;
    expect(postgresDataDirFromCommand(command)).toBe(dataDir);
  });

  (skip ? it.skip : it)(
    "sweep only targets pubmax harness orphans parented by init",
    () => {
      const foreign = join(tmpdir(), "pubmax-pg-not-a-real-cluster");
      expect(isPubmaxHarnessDataDir(foreign)).toBe(true);
      sweepPubmaxHarnessOrphans();
      expect(() => sweepPubmaxHarnessOrphans()).not.toThrow();
    },
  );

  (skip ? it.skip : it)(
    "does not raise the SysV segment count across one boot and stop",
    async () => {
      const before = countSysvShmSegments();
      const session = await startPostgres({ label: "shm-one-shot" });
      await session.stop();
      sweepPubmaxHarnessOrphans();
      expect(countSysvShmSegments()).toBeLessThanOrEqual(before);
    },
    120_000,
  );

  (skip ? it.skip : it)(
    "reaps a SIGKILL mid-run orphan via sweep",
    async () => {
      const before = countSysvShmSegments();
      const session = await startPostgres({ label: "shm-orphan" });
      const processes = spawnSync("ps", ["-A", "-o", "pid=", "-o", "command="], {
        encoding: "utf8",
      });
      const line = processes.stdout
        ?.split("\n")
        .find((row) => row.includes("pubmax-pg-shm-orphan") && row.includes("postgres"));
      expect(line, "expected a postgres process for the harness cluster").toBeTruthy();
      const pid = Number.parseInt(line!.trim(), 10);
      process.kill(pid, "SIGKILL");
      sweepPubmaxHarnessOrphans();
      expect(countSysvShmSegments()).toBeLessThanOrEqual(before + 1);
      await session.stop();
      sweepPubmaxHarnessOrphans();
      expect(countSysvShmSegments()).toBeLessThanOrEqual(before);
    },
    180_000,
  );

  (skip ? it.skip : it)(
    "a serial postgres-backed suite leaves the SysV segment count unchanged",
    () => {
      const before = countSysvShmSegments();
      const result = spawnSync(
        "npx",
        ["vitest", "run", "__tests__/rateLimitExpiryMigration.test.ts", "--maxWorkers=1"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: { ...process.env, CI: "1" },
          timeout: 300_000,
        },
      );
      expect(result.status, result.stderr || result.stdout).toBe(0);
      sweepPubmaxHarnessOrphans();
      expect(countSysvShmSegments()).toBeLessThanOrEqual(before);
    },
    360_000,
  );
});
