import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  installedTreeIsStale,
  NODE_MODULES_STALE_MESSAGE,
} from "../scripts/check_node_modules_fresh.mjs";

const REQUIRED = {
  lockfileVersion: 3,
  packages: {
    "": { name: "fixture" },
    "node_modules/left-pad": { version: "1.3.0" },
    "node_modules/fsevents": { version: "2.3.3", optional: true },
  },
};

function writeTree(dir: string, installed: unknown | null) {
  writeFileSync(join(dir, "package-lock.json"), `${JSON.stringify(REQUIRED)}\n`);
  if (installed === null) return;
  mkdirSync(join(dir, "node_modules"));
  writeFileSync(
    join(dir, "node_modules", ".package-lock.json"),
    `${JSON.stringify(installed)}\n`,
  );
}

function installedLock(packages: Record<string, unknown>) {
  return { lockfileVersion: 3, packages };
}

describe("node_modules freshness", () => {
  it("accepts an install that has every non-optional package at the lockfile version", () => {
    const dir = mkdtempSync(join(tmpdir(), "pubmax-nm-fresh-"));
    try {
      writeTree(
        dir,
        installedLock({
          "": { name: "fixture" },
          "node_modules/left-pad": { version: "1.3.0" },
          "node_modules/fsevents": { version: "2.3.3", optional: true },
        }),
      );
      expect(installedTreeIsStale(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts a missing optional package", () => {
    const dir = mkdtempSync(join(tmpdir(), "pubmax-nm-optional-"));
    try {
      writeTree(
        dir,
        installedLock({
          "": { name: "fixture" },
          "node_modules/left-pad": { version: "1.3.0" },
        }),
      );
      expect(installedTreeIsStale(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a non-optional package the install does not have", () => {
    const dir = mkdtempSync(join(tmpdir(), "pubmax-nm-missing-"));
    try {
      writeTree(dir, installedLock({ "": { name: "fixture" } }));
      expect(installedTreeIsStale(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a non-optional package at a different version", () => {
    const dir = mkdtempSync(join(tmpdir(), "pubmax-nm-version-"));
    try {
      writeTree(
        dir,
        installedLock({
          "": { name: "fixture" },
          "node_modules/left-pad": { version: "1.2.0" },
        }),
      );
      expect(installedTreeIsStale(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a tree with no installed lockfile", () => {
    const dir = mkdtempSync(join(tmpdir(), "pubmax-nm-absent-"));
    try {
      writeTree(dir, null);
      expect(installedTreeIsStale(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints the npm ci instruction and exits 1 when the tree is stale", () => {
    const dir = mkdtempSync(join(tmpdir(), "pubmax-nm-cli-"));
    try {
      writeTree(dir, null);
      let status = 0;
      let stderr = "";
      try {
        execFileSync(
          process.execPath,
          ["scripts/check_node_modules_fresh.mjs", "--root", dir],
          { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" },
        );
      } catch (error) {
        const failed = error as { status?: number; stderr?: string };
        status = failed.status ?? 1;
        stderr = failed.stderr ?? "";
      }
      expect(status).toBe(1);
      expect(stderr).toBe(`${NODE_MODULES_STALE_MESSAGE}\n`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
