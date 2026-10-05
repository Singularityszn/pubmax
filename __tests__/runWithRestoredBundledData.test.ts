import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

  it("removes a shard file the wrapped command added and keeps one that was already there", () => {
    const cwd = join(tmpdir(), `pubmax-bundled-restore-untracked-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    initialiseGit(cwd);
    writeFileSync(join(cwd, "public/data/draft.json"), "{}\n", "utf8");
    execFileSync(
      process.execPath,
      [bundledWrapper, process.execPath, "-e", "const fs=require('fs'); fs.mkdirSync('public/data/cities/new',{recursive:true}); fs.writeFileSync('public/data/cities/new/venues_slim.core.json','{}')"],
      { cwd },
    );
    expect(existsSync(join(cwd, "public/data/cities/new/venues_slim.core.json"))).toBe(false);
    expect(existsSync(join(cwd, "public/data/draft.json"))).toBe(true);
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
  it("restores invalid fixture data after validation without erasing caller work", () => {
    const root = process.cwd();
    const callerDiff = execFileSync("git", ["diff", "--binary", "HEAD", "--", "public/data"], { cwd: root });
    const scratch = mkdtempSync(join(tmpdir(), "pubmax-validator-restore-"));
    const cwd = join(scratch, "validation");
    try {
      initialiseGit(scratch);
      const callerData = join(scratch, "public/data/baseline.json");
      writeFileSync(callerData, '{"sampleSize":947}\n', "utf8");
      mkdirSync(join(cwd, "scripts"), { recursive: true });
      initialiseGit(cwd);
      // The real validator resolves datasets relative to its module, not cwd.
      // Only its read-only dependency modules are shared with the checkout.
      copyFileSync(join(root, "scripts/validate-data.mjs"), join(cwd, "scripts/validate-data.mjs"));
      symlinkSync(join(root, "scripts/lib"), join(cwd, "scripts/lib"), "dir");
      symlinkSync(join(root, "lib"), join(cwd, "lib"), "dir");
      const pois = join(cwd, "public/data/london_pois.json");
      writeFileSync(pois, "[]\n", "utf8");
      execFileSync("git", ["add", "public/data"], { cwd });
      execFileSync("git", ["commit", "-qm", "fixture dataset"], { cwd });
      writeFileSync(pois, "invalid JSON\n", "utf8");
      const result = spawnSync(process.execPath, [bundledWrapper, process.execPath, "scripts/validate-data.mjs"], {
        cwd,
        env: { PATH: process.env.PATH, DEPLOYMENT_VERSION: "local", PUBMAX_VERIFY_COMMITTED_DATA: "1" },
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("FAIL public/data/london_pois.json: could not read/parse");
      expect(readFileSync(pois, "utf8")).toBe("[]\n");
      expect(execFileSync("git", ["status", "--short", "public/data"], { cwd, encoding: "utf8" })).toBe("");
      expect(readFileSync(callerData, "utf8")).toBe('{"sampleSize":947}\n');
      expect(execFileSync("git", ["diff", "--binary", "HEAD", "--", "public/data"], { cwd: root })).toEqual(callerDiff);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
