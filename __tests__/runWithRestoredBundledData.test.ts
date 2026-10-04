import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  it("leaves committed bundled data clean after validate-data on this tree", () => {
    const manifest = join(process.cwd(), "public/data/cities/bath/venues_slim.manifest.json");
    if (!existsSync(manifest)) return;
    const before = readFileSync(manifest, "utf8");
    writeFileSync(manifest, `${before.trimEnd()}\n`, "utf8");
    try {
      execFileSync(
        process.execPath,
        [bundledWrapper, "npm", "run", "validate-data"],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            DEPLOYMENT_VERSION: "local",
            PUBMAX_VERIFY_COMMITTED_DATA: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      expect(execFileSync("git", ["status", "--short", "public/data"], { encoding: "utf8" })).toBe("");
    } finally {
      execFileSync("git", ["restore", "--worktree", "--source=HEAD", "--", "public/data"], {
        cwd: process.cwd(),
      });
    }
  });
});
