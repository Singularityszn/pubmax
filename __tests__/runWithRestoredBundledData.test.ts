import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { COMMITTED_BUNDLED_DATA_PATHS } from "../scripts/lib/committedBundledDataPaths.mjs";

const bundledWrapper = resolve(process.cwd(), "scripts/run-with-restored-bundled-data.mjs");
const nextEnvWrapper = resolve(process.cwd(), "scripts/run-with-restored-next-env.mjs");

function initialiseGit(cwd: string): void {
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "gate0@example.test"], { cwd });
  execFileSync("git", ["config", "user.name", "Gate Zero"], { cwd });
  mkdirSync(join(cwd, "public", "data"), { recursive: true });
  writeFileSync(join(cwd, "public/data/baseline.json"), "{}\n", "utf8");
  execFileSync("git", ["add", "."], { cwd });
  execFileSync("git", ["commit", "-qm", "baseline"], { cwd });
}

describe("committed bundled data restore", () => {
  it("names the trees the captain forbids in pipeline churn", () => {
    expect(COMMITTED_BUNDLED_DATA_PATHS).toEqual(["public/data"]);
  });

  it("restores public/data after the wrapped command succeeds", () => {
    const cwd = join(tmpdir(), `pubmax-bundled-restore-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    initialiseGit(cwd);
    execFileSync(process.execPath, [bundledWrapper, process.execPath, "-e", "require('fs').appendFileSync('public/data/baseline.json','dirty\\n')"], { cwd });
    expect(readFileSync(join(cwd, "public/data/baseline.json"), "utf8")).toBe("{}\n");
    expect(execFileSync("git", ["status", "--short", "public/data"], { cwd, encoding: "utf8" })).toBe("");
  });

  it("restores public/data after the wrapped command fails", () => {
    const cwd = join(tmpdir(), `pubmax-bundled-restore-fail-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    initialiseGit(cwd);
    const result = spawnSync(
      process.execPath,
      [bundledWrapper, process.execPath, "-e", "require('fs').appendFileSync('public/data/baseline.json','dirty\\n'); process.exit(9)"],
      { cwd },
    );
    expect(result.status).toBe(9);
    expect(readFileSync(join(cwd, "public/data/baseline.json"), "utf8")).toBe("{}\n");
  });

  it("restores public/data after a browser build wrapper when CI allowlists it", () => {
    const cwd = join(tmpdir(), `pubmax-next-env-restore-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, "tsconfig.json"), "{}\n", "utf8");
    initialiseGit(cwd);
    execFileSync(
      process.execPath,
      [nextEnvWrapper, process.execPath, "-e", "require('fs').appendFileSync('public/data/baseline.json','dirty\\n')"],
      { cwd, env: { ...process.env, PUBMAX_TRACKED_OUTPUTS: "public/data" } },
    );
    expect(execFileSync("git", ["status", "--short", "public/data"], { cwd, encoding: "utf8" })).toBe("");
  });
});

describe("no-mistakes verify wrapper regression", () => {
  it("restores committed bundled data after real validate-data in a disposable checkout", () => {
    const sourceRoot = process.cwd();
    const cwd = mkdtempSync(join(tmpdir(), "pubmax-validate-data-checkout-"));
    try {
      execFileSync(
        "git",
        ["clone", "--shared", "--no-hardlinks", "--quiet", sourceRoot, cwd],
      );
      const nodeModules = join(sourceRoot, "node_modules");
      expect(existsSync(nodeModules)).toBe(true);
      symlinkSync(nodeModules, join(cwd, "node_modules"), "dir");

      const manifest = join(cwd, "public/data/cities/bath/venues_slim.manifest.json");
      expect(existsSync(manifest)).toBe(true);
      const before = readFileSync(manifest);
      writeFileSync(manifest, Buffer.concat([before, Buffer.from("\n")]));
      execFileSync(
        process.execPath,
        [
          join(cwd, "scripts/run-with-restored-bundled-data.mjs"),
          "npm",
          "run",
          "validate-data",
        ],
        {
          cwd,
          env: {
            ...process.env,
            DEPLOYMENT_VERSION: "local",
            PUBMAX_VERIFY_COMMITTED_DATA: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      expect(readFileSync(manifest)).toEqual(before);
      expect(
        execFileSync("git", ["status", "--short", "public/data"], {
          cwd,
          encoding: "utf8",
        }),
      ).toBe("");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
